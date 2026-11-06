-- ============================================================
-- 3.1F-I1 — Fundação INATIVA do ledger de comissão e folha de funcionários
-- ============================================================
-- Destino: aplicar manualmente (Supabase SQL editor) SOMENTE em sprint de
-- release autorizada. Esta sprint NÃO aplica remotamente.
--
-- Escopo (aditivo, transacional, reaplicável):
--   1. helpers (jsonb sanitizado, ator financeiro, competência)
--   2. sales_opportunity_attributions: extensão aditiva (idempotency_key, source)
--   3. finance_audit_events (append-only)
--   4. employee_commission_rules (somente draft nesta sprint)
--   5. employee_commission_entitlements (tabela existe; criação bloqueada)
--   6. employee_compensation_profiles (somente draft)
--   7. payroll_competences (sem close/pay nesta sprint)
--   8. employee_worked_days
--   9. payroll_competence_lines (append-only)
--  10. RPCs internas mínimas (sem ativação, sem avaliação ERP, sem pagamento)
--
-- NÃO faz: alterar rewards/wallet/withdrawals/Collections; inserir regras
-- default; criar entitlements/competências/linhas; backfill; retroatividade;
-- remoção em cascata de dado financeiro; ativar qualquer regra.
--
-- Dinheiro: numeric(10,2) BRL, arredondamento explícito round(x, 2).
-- Tempo: timestamptz em UTC; competência em America/Sao_Paulo; date para dias.

begin;

-- ============================================================
-- 1. Helpers
-- ============================================================

-- Chaves proibidas em jsonb financeiro sanitizado (PII, segredos, payload ERP,
-- identificadores ERP).
create or replace function public.finance_jsonb_is_sanitized(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is not null
    and jsonb_typeof(p) = 'object'
    and not (p ?| array[
      'token','access_token','refresh_token','cookie','password','secret',
      'erp_payload','payload','raw','raw_payload','response','body',
      'cpf','cnpj','document','documento','rg','phone','telefone','celular',
      'name','nome','full_name','email','address','endereco',
      'contract_pk','invoice_pk','client_pk'
    ]);
$$;

-- Todas as chaves de p pertencem à allowlist.
create or replace function public.finance_jsonb_keys_allowed(p jsonb, p_allowed text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is not null
    and jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k where not (k = any(p_allowed)));
$$;

-- Competência (primeiro dia do mês) de um instante, no calendário America/Sao_Paulo.
create or replace function public.payroll_competence_month_for(p_at timestamptz)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select date_trunc('month', (p_at at time zone 'America/Sao_Paulo'))::date;
$$;

-- Último dia da competência (fevereiro bissexto/não bissexto, dez->jan).
create or replace function public.payroll_competence_period_end(p_month date)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select (date_trunc('month', p_month::timestamp) + interval '1 month' - interval '1 day')::date;
$$;

-- Prévia pura (não persiste): benefício diário x dias elegíveis.
create or replace function public.payroll_daily_benefit_preview(p_daily_amount numeric, p_eligible_days integer)
returns numeric(10,2)
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_daily_amount is null or p_eligible_days is null or p_daily_amount < 0 or p_eligible_days < 0 then null
    else round(p_daily_amount::numeric * p_eligible_days, 2)::numeric(10,2)
  end;
$$;

-- Ator financeiro: somente admin_master / admin_financeiro ativos.
create or replace function public.finance_admin_actor_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role::text
  from public.profiles p
  where p.id = auth.uid()
    and coalesce(p.is_active, true)
    and p.role in ('admin_master', 'admin_financeiro');
$$;

revoke all on function public.finance_jsonb_is_sanitized(jsonb) from public, anon, authenticated;
revoke all on function public.finance_jsonb_keys_allowed(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.payroll_competence_month_for(timestamptz) from public, anon, authenticated;
revoke all on function public.payroll_competence_period_end(date) from public, anon, authenticated;
revoke all on function public.payroll_daily_benefit_preview(numeric, integer) from public, anon, authenticated;
revoke all on function public.finance_admin_actor_role() from public, anon, authenticated, service_role;

-- ============================================================
-- 2. sales_opportunity_attributions — extensão ADITIVA
-- ============================================================
-- Tabela criada em 3.1F-H1. Mantida a chave única existente
-- sales_opportunity_attributions_role_uq UNIQUE (opportunity_id, attribution_role):
-- um funcionário por papel por oportunidade (impede dois técnicos e, por
-- consequência, o mesmo funcionário duas vezes no mesmo papel).
-- "Responsável interno" mantém o nome comprovado internal_sales_responsible.
alter table public.sales_opportunity_attributions
  add column if not exists idempotency_key text;

alter table public.sales_opportunity_attributions
  drop constraint if exists sales_opportunity_attributions_idem_format_chk;
alter table public.sales_opportunity_attributions
  add constraint sales_opportunity_attributions_idem_format_chk
  check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$');

create unique index if not exists sales_opportunity_attributions_idem_uidx
  on public.sales_opportunity_attributions (idempotency_key)
  where idempotency_key is not null;

alter table public.sales_opportunity_attributions
  drop constraint if exists sales_opportunity_attributions_source_chk;
alter table public.sales_opportunity_attributions
  add constraint sales_opportunity_attributions_source_chk
  check (source in ('employee_opportunity_rpc', 'attribution_rpc'));

alter table public.sales_opportunity_attributions enable row level security;

-- ============================================================
-- 3. finance_audit_events — append-only
-- ============================================================
create table if not exists public.finance_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  reason text,
  operation_id text,
  idempotency_key text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint finance_audit_events_action_chk check (action in (
    'attribution_created',
    'commission_rule_draft_created',
    'commission_rule_draft_versioned',
    'compensation_draft_configured',
    'worked_day_recorded',
    'worked_day_changed',
    'payroll_competence_draft_opened',
    'payroll_adjustment_added',
    -- reservados para sprints futuras (exigem reason):
    'approve', 'adjust', 'reverse', 'reopen', 'pay'
  )),
  constraint finance_audit_events_entity_chk check (entity_type in (
    'sales_opportunity_attribution',
    'employee_commission_rule',
    'employee_commission_entitlement',
    'employee_compensation_profile',
    'employee_worked_day',
    'payroll_competence',
    'payroll_competence_line'
  )),
  constraint finance_audit_events_reason_required_chk check (
    action not in ('approve', 'adjust', 'reverse', 'reopen', 'pay', 'payroll_adjustment_added')
    or char_length(btrim(coalesce(reason, ''))) >= 3
  ),
  constraint finance_audit_events_before_safe_chk check (public.finance_jsonb_is_sanitized(before_state)),
  constraint finance_audit_events_after_safe_chk check (public.finance_jsonb_is_sanitized(after_state)),
  constraint finance_audit_events_actor_role_chk check (
    actor_role is null or actor_role in ('admin_master', 'admin_financeiro', 'system')
  )
);

create unique index if not exists finance_audit_events_idem_uidx
  on public.finance_audit_events (idempotency_key) where idempotency_key is not null;
create index if not exists finance_audit_events_entity_idx
  on public.finance_audit_events (entity_type, entity_id, created_at);

create or replace function public.trg_finance_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '%_append_only', TG_TABLE_NAME using errcode = 'P0001';
end;
$$;
revoke all on function public.trg_finance_append_only() from public, anon, authenticated;

drop trigger if exists trg_finance_audit_events_append_only on public.finance_audit_events;
create trigger trg_finance_audit_events_append_only
before update or delete on public.finance_audit_events
for each row execute function public.trg_finance_append_only();

drop trigger if exists trg_finance_audit_events_no_truncate on public.finance_audit_events;
create trigger trg_finance_audit_events_no_truncate
before truncate on public.finance_audit_events
for each statement execute function public.trg_finance_append_only();

create or replace function public.finance_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_operation_id text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.finance_audit_events (
    actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, reason, operation_id
  )
  values (
    auth.uid(), public.finance_admin_actor_role(), p_action, p_entity_type, p_entity_id,
    coalesce(p_before, '{}'::jsonb), coalesce(p_after, '{}'::jsonb), p_reason, p_operation_id
  );
$$;
revoke all on function public.finance_audit_log(text, text, uuid, jsonb, jsonb, text, text) from public, anon, authenticated, service_role;

-- ============================================================
-- 4. employee_commission_rules
-- ============================================================
create table if not exists public.employee_commission_rules (
  id uuid primary key default gen_random_uuid(),
  rule_family_id uuid not null,
  version integer not null default 1,
  previous_version_id uuid references public.employee_commission_rules(id) on delete restrict,
  sector_id uuid references public.sectors(id) on delete restrict,
  attribution_role text,
  method text not null,
  trigger_kind text not null,
  fixed_amount numeric(10,2),
  -- Fração: 0.02 = 2%. O limite 1.00 (=100%) é LIMITE TÉCNICO de completude,
  -- NÃO um teto de negócio. Nenhum teto de negócio foi definido.
  percentage_rate numeric(7,6),
  -- Base ERP NÃO comprovada: texto nullable enquanto draft. Sem enum de campos
  -- ERP supostos (não escolher monthly_plan/primeira fatura/contrato).
  percentage_base text,
  currency text not null default 'BRL',
  effective_from date not null,
  effective_until date,
  status text not null default 'draft',
  active boolean not null default false,
  retroactive boolean not null default false,
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_commission_rules_family_version_uq unique (rule_family_id, version),
  constraint employee_commission_rules_idem_uq unique (idempotency_key),
  constraint employee_commission_rules_version_chk check (version >= 1),
  constraint employee_commission_rules_scope_chk check (sector_id is not null or attribution_role is not null),
  constraint employee_commission_rules_role_chk check (
    attribution_role is null or attribution_role in (
      'technician_originator', 'external_sales_originator', 'internal_sales_responsible'
    )
  ),
  constraint employee_commission_rules_method_chk check (
    method in ('fixed_amount', 'percentage', 'first_invoice_value')
  ),
  constraint employee_commission_rules_trigger_kind_chk check (
    trigger_kind in ('first_valid_invoice_generated', 'first_valid_invoice_fully_paid')
  ),
  constraint employee_commission_rules_method_values_chk check (
    (method = 'fixed_amount' and fixed_amount is not null and fixed_amount > 0
       and percentage_rate is null and percentage_base is null)
    or (method = 'percentage' and fixed_amount is null and percentage_rate is not null
       and percentage_rate > 0 and percentage_rate <= 1.00)
    or (method = 'first_invoice_value' and fixed_amount is null
       and percentage_rate is null and percentage_base is null)
  ),
  constraint employee_commission_rules_method_trigger_chk check (
    (method in ('fixed_amount', 'percentage') and trigger_kind = 'first_valid_invoice_generated')
    or (method = 'first_invoice_value' and trigger_kind = 'first_valid_invoice_fully_paid')
  ),
  constraint employee_commission_rules_period_chk check (
    effective_until is null or effective_until >= effective_from
  ),
  constraint employee_commission_rules_currency_chk check (currency = 'BRL'),
  constraint employee_commission_rules_status_chk check (
    status in ('draft', 'active', 'inactive', 'superseded')
  ),
  constraint employee_commission_rules_active_status_consistent_chk check (
    active = (status = 'active')
  ),
  -- Pronto para o futuro: ativar exige regra completa e aprovada; percentual
  -- exige base comprovada.
  constraint employee_commission_rules_activation_ready_chk check (
    not active or (
      approved_by is not null and approved_at is not null
      and (method <> 'percentage' or percentage_base is not null)
    )
  ),
  -- PORTÃO DA FUNDAÇÃO (3.1F-I1): nenhuma regra pode ficar ativa. Uma sprint
  -- futura autorizada (ACTIVE_FINANCIAL_RULES_ALLOWED=YES) pode remover este CHECK.
  constraint employee_commission_rules_foundation_inactive_chk check (
    active = false and status is distinct from 'active'
  ),
  -- Sem retroatividade automática nesta sprint.
  constraint employee_commission_rules_no_retroactive_chk check (retroactive = false)
);

comment on table public.employee_commission_rules is
  '3.1F-I1: regras de comissão versionadas. Somente draft nesta sprint (CHECK foundation_inactive). Nova versão = nova linha.';

create index if not exists employee_commission_rules_scope_idx
  on public.employee_commission_rules (attribution_role, sector_id, effective_from);

drop trigger if exists trg_employee_commission_rules_set_updated_at on public.employee_commission_rules;
create trigger trg_employee_commission_rules_set_updated_at
before update on public.employee_commission_rules
for each row execute function public.set_updated_at();

-- Snapshot imutável: valores/método/gatilho/escopo nunca mudam após INSERT.
-- Única transição permitida: status draft -> superseded|inactive.
create or replace function public.trg_employee_commission_rules_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'employee_commission_rules_no_delete' using errcode = 'P0001';
  end if;
  if (to_jsonb(NEW) - array['status', 'updated_at']) is distinct from (to_jsonb(OLD) - array['status', 'updated_at']) then
    raise exception 'employee_commission_rule_snapshot_immutable' using errcode = 'P0001';
  end if;
  if NEW.status is distinct from OLD.status
     and not (OLD.status = 'draft' and NEW.status in ('superseded', 'inactive')) then
    raise exception 'employee_commission_rule_transition_forbidden' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_employee_commission_rules_immutable() from public, anon, authenticated;

drop trigger if exists trg_employee_commission_rules_immutable on public.employee_commission_rules;
create trigger trg_employee_commission_rules_immutable
before update or delete on public.employee_commission_rules
for each row execute function public.trg_employee_commission_rules_immutable();

-- ============================================================
-- 5. employee_commission_entitlements
-- ============================================================
create table if not exists public.employee_commission_entitlements (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.referrals(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  attribution_id uuid not null references public.sales_opportunity_attributions(id) on delete restrict,
  rule_id uuid not null references public.employee_commission_rules(id) on delete restrict,
  attribution_role text not null,
  trigger_kind text not null,
  -- Identificadores ERP opacos (somente dígitos). NÃO são ordem temporal.
  triggering_contract_pk text,
  triggering_invoice_pk text,
  status text not null default 'pending_evidence',
  amount numeric(10,2),
  currency text not null default 'BRL',
  competence_month date,
  source text not null default 'future_invoice_evaluation',
  evidence_at timestamptz,
  accrued_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  reversal_of uuid references public.employee_commission_entitlements(id) on delete restrict,
  idempotency_key text not null,
  rule_snapshot jsonb not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_commission_entitlements_idem_uq unique (idempotency_key),
  constraint employee_commission_entitlements_role_chk check (attribution_role in (
    'technician_originator', 'external_sales_originator', 'internal_sales_responsible'
  )),
  constraint employee_commission_entitlements_trigger_chk check (
    trigger_kind in ('first_valid_invoice_generated', 'first_valid_invoice_fully_paid')
  ),
  constraint employee_commission_entitlements_status_chk check (status in (
    'pending_evidence', 'accrued', 'approved', 'included_in_payroll', 'paid', 'reversed', 'rejected'
  )),
  constraint employee_commission_entitlements_erp_ids_chk check (
    (triggering_contract_pk is null or triggering_contract_pk ~ '^[0-9]{1,20}$')
    and (triggering_invoice_pk is null or triggering_invoice_pk ~ '^[0-9]{1,20}$')
  ),
  constraint employee_commission_entitlements_amount_chk check (amount is null or amount >= 0),
  constraint employee_commission_entitlements_amount_required_chk check (
    status in ('pending_evidence', 'rejected') or amount is not null
  ),
  constraint employee_commission_entitlements_currency_chk check (currency = 'BRL'),
  constraint employee_commission_entitlements_competence_chk check (
    competence_month is null or extract(day from competence_month) = 1
  ),
  constraint employee_commission_entitlements_source_chk check (
    source in ('future_invoice_evaluation', 'manual_admin')
  ),
  constraint employee_commission_entitlements_accrued_chk check (
    status in ('pending_evidence', 'rejected') or accrued_at is not null
  ),
  constraint employee_commission_entitlements_approved_chk check (
    status not in ('approved', 'included_in_payroll', 'paid')
    or (approved_at is not null and approved_by is not null)
  ),
  -- paid somente com aprovação + pagamento registrados (fechamento futuro).
  constraint employee_commission_entitlements_paid_chk check (
    (status = 'paid') = (paid_at is not null and paid_by is not null)
  ),
  constraint employee_commission_entitlements_rule_snapshot_chk check (
    public.finance_jsonb_is_sanitized(rule_snapshot)
  ),
  -- Forma sanitizada: somente chaves da allowlist; sem payload ERP/PII.
  constraint employee_commission_entitlements_evidence_shape_chk check (
    public.finance_jsonb_is_sanitized(evidence_snapshot)
    and public.finance_jsonb_keys_allowed(evidence_snapshot, array[
      'evidence_kind', 'trigger_kind', 'evidence_at', 'proof_version', 'source', 'checks'
    ])
  )
);

comment on table public.employee_commission_entitlements is
  '3.1F-I1: direitos de comissão. Criação BLOQUEADA nesta sprint (financial_rules_inactive). Sem payload ERP/PII.';

-- Sem duplicidade por oportunidade + funcionário + papel + gatilho + versão da regra.
create unique index if not exists employee_commission_entitlements_dedupe_uidx
  on public.employee_commission_entitlements (opportunity_id, employee_id, attribution_role, trigger_kind, rule_id)
  where reversal_of is null;

drop trigger if exists trg_employee_commission_entitlements_set_updated_at on public.employee_commission_entitlements;
create trigger trg_employee_commission_entitlements_set_updated_at
before update on public.employee_commission_entitlements
for each row execute function public.set_updated_at();

-- (a) Comissão somente para origin_kind = employee.
create or replace function public.trg_employee_commission_entitlements_origin_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_origin text;
begin
  select r.origin_kind into v_origin from public.referrals r where r.id = NEW.opportunity_id;
  if v_origin is distinct from 'employee' then
    raise exception 'commission_requires_employee_origin' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_employee_commission_entitlements_origin_guard() from public, anon, authenticated;

drop trigger if exists trg_employee_commission_entitlements_a_origin_guard on public.employee_commission_entitlements;
create trigger trg_employee_commission_entitlements_a_origin_guard
before insert or update of opportunity_id on public.employee_commission_entitlements
for each row execute function public.trg_employee_commission_entitlements_origin_guard();

-- (b) Imutabilidade após accrued; paid somente a partir de included_in_payroll.
create or replace function public.trg_employee_commission_entitlements_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'employee_commission_entitlements_no_delete' using errcode = 'P0001';
  end if;
  if OLD.status <> 'pending_evidence' and (
       NEW.employee_id is distinct from OLD.employee_id
       or NEW.amount is distinct from OLD.amount
       or NEW.rule_snapshot is distinct from OLD.rule_snapshot
       or NEW.source is distinct from OLD.source
       or NEW.rule_id is distinct from OLD.rule_id
       or NEW.opportunity_id is distinct from OLD.opportunity_id) then
    raise exception 'employee_commission_entitlement_immutable_after_accrued' using errcode = 'P0001';
  end if;
  if NEW.status = 'paid' and OLD.status is distinct from 'paid' and OLD.status <> 'included_in_payroll' then
    raise exception 'employee_commission_entitlement_paid_requires_payroll' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_employee_commission_entitlements_immutable() from public, anon, authenticated;

drop trigger if exists trg_employee_commission_entitlements_b_immutable on public.employee_commission_entitlements;
create trigger trg_employee_commission_entitlements_b_immutable
before update or delete on public.employee_commission_entitlements
for each row execute function public.trg_employee_commission_entitlements_immutable();

-- (z) PORTÃO DA FUNDAÇÃO: nenhuma linha pode ser criada nesta sprint.
create or replace function public.trg_employee_commission_entitlements_foundation_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'financial_rules_inactive' using errcode = 'P0001';
end;
$$;
revoke all on function public.trg_employee_commission_entitlements_foundation_gate() from public, anon, authenticated;

drop trigger if exists trg_employee_commission_entitlements_z_foundation_gate on public.employee_commission_entitlements;
create trigger trg_employee_commission_entitlements_z_foundation_gate
before insert on public.employee_commission_entitlements
for each row execute function public.trg_employee_commission_entitlements_foundation_gate();

-- ============================================================
-- 6. employee_compensation_profiles (versionado; somente draft)
-- ============================================================
create table if not exists public.employee_compensation_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  version integer not null,
  previous_version_id uuid references public.employee_compensation_profiles(id) on delete restrict,
  valid_from date not null,
  valid_until date,
  salary_enabled boolean not null default false,
  salary_amount numeric(10,2),
  meal_enabled boolean not null default false,
  meal_daily_amount numeric(10,2),
  transport_enabled boolean not null default false,
  transport_amount numeric(10,2),
  transport_method text,
  fuel_enabled boolean not null default false,
  fuel_amount numeric(10,2),
  fuel_method text,
  show_salary boolean not null default false,
  show_meal boolean not null default false,
  show_transport boolean not null default false,
  show_fuel boolean not null default false,
  status text not null default 'draft',
  snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_compensation_profiles_version_uq unique (employee_id, version),
  constraint employee_compensation_profiles_idem_uq unique (idempotency_key),
  constraint employee_compensation_profiles_version_chk check (version >= 1),
  constraint employee_compensation_profiles_period_chk check (valid_until is null or valid_until >= valid_from),
  constraint employee_compensation_profiles_salary_chk check (
    (salary_enabled and salary_amount is not null and salary_amount > 0)
    or (not salary_enabled and salary_amount is null)
  ),
  constraint employee_compensation_profiles_meal_chk check (
    (meal_enabled and meal_daily_amount is not null and meal_daily_amount > 0)
    or (not meal_enabled and meal_daily_amount is null)
  ),
  constraint employee_compensation_profiles_transport_chk check (
    (transport_enabled and transport_amount is not null and transport_amount > 0
       and transport_method in ('per_worked_day', 'monthly_fixed'))
    or (not transport_enabled and transport_amount is null and transport_method is null)
  ),
  constraint employee_compensation_profiles_fuel_chk check (
    (fuel_enabled and fuel_amount is not null and fuel_amount > 0
       and fuel_method in ('per_worked_day', 'monthly_fixed'))
    or (not fuel_enabled and fuel_amount is null and fuel_method is null)
  ),
  -- Componente não configurado não aparece ao funcionário.
  constraint employee_compensation_profiles_visibility_chk check (
    (not show_salary or salary_enabled) and (not show_meal or meal_enabled)
    and (not show_transport or transport_enabled) and (not show_fuel or fuel_enabled)
  ),
  constraint employee_compensation_profiles_status_chk check (status in ('draft', 'active', 'inactive')),
  -- PORTÃO DA FUNDAÇÃO: nenhuma configuração ativa nesta sprint.
  constraint employee_compensation_profiles_foundation_inactive_chk check (status <> 'active'),
  constraint employee_compensation_profiles_snapshot_chk check (public.finance_jsonb_is_sanitized(snapshot))
);

comment on table public.employee_compensation_profiles is
  '3.1F-I1: remuneração por funcionário (versões). Somente draft. Sem SELECT para authenticated.';

drop trigger if exists trg_employee_compensation_profiles_set_updated_at on public.employee_compensation_profiles;
create trigger trg_employee_compensation_profiles_set_updated_at
before update on public.employee_compensation_profiles
for each row execute function public.set_updated_at();

create or replace function public.trg_employee_compensation_profiles_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'employee_compensation_profiles_no_delete' using errcode = 'P0001';
  end if;
  if (to_jsonb(NEW) - array['status', 'updated_at'])
     is distinct from (to_jsonb(OLD) - array['status', 'updated_at']) then
    raise exception 'employee_compensation_profile_snapshot_immutable' using errcode = 'P0001';
  end if;
  if NEW.status is distinct from OLD.status and not (OLD.status = 'draft' and NEW.status = 'inactive') then
    raise exception 'employee_compensation_profile_transition_forbidden' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_employee_compensation_profiles_immutable() from public, anon, authenticated;

drop trigger if exists trg_employee_compensation_profiles_immutable on public.employee_compensation_profiles;
create trigger trg_employee_compensation_profiles_immutable
before update or delete on public.employee_compensation_profiles
for each row execute function public.trg_employee_compensation_profiles_immutable();

-- Componentes que o funcionário veria (futuro). Comissão sempre; demais só se
-- habilitados E visíveis. Salário ausente => somente comissão.
create or replace function public.employee_compensation_visible_components(p public.employee_compensation_profiles)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array_remove(array[
    'commission',
    case when p.salary_enabled and p.show_salary then 'salary' end,
    case when p.meal_enabled and p.show_meal then 'meal' end,
    case when p.transport_enabled and p.show_transport then 'transport' end,
    case when p.fuel_enabled and p.show_fuel then 'fuel' end
  ], null);
$$;
revoke all on function public.employee_compensation_visible_components(public.employee_compensation_profiles) from public, anon, authenticated;

-- ============================================================
-- 7. payroll_competences (antes de worked_days: o guard a referencia)
-- ============================================================
create table if not exists public.payroll_competences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  competence_month date not null,
  timezone text not null default 'America/Sao_Paulo',
  period_start date not null,
  period_end date not null,
  version integer not null default 1,
  is_current boolean not null default true,
  status text not null default 'draft',
  total_base_salary numeric(10,2) not null default 0,
  total_commission numeric(10,2) not null default 0,
  total_benefits numeric(10,2) not null default 0,
  total_other_earnings numeric(10,2) not null default 0,
  total_discounts numeric(10,2) not null default 0,
  total_adjustments numeric(10,2) not null default 0,
  net_total numeric(10,2) not null default 0,
  calculated_at timestamptz,
  calculated_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint payroll_competences_idem_uq unique (idempotency_key),
  constraint payroll_competences_version_uq unique (employee_id, competence_month, version),
  constraint payroll_competences_version_chk check (version >= 1),
  constraint payroll_competences_month_chk check (extract(day from competence_month) = 1),
  constraint payroll_competences_tz_chk check (timezone = 'America/Sao_Paulo'),
  constraint payroll_competences_period_chk check (
    period_start = competence_month
    and period_end = public.payroll_competence_period_end(competence_month)
  ),
  constraint payroll_competences_status_chk check (status in (
    'draft', 'calculated', 'reviewed', 'closed', 'paid', 'reopened'
  )),
  constraint payroll_competences_closed_meta_chk check (
    status not in ('closed', 'paid') or (closed_at is not null and closed_by is not null)
  ),
  constraint payroll_competences_paid_meta_chk check (
    (status = 'paid') = (paid_at is not null and paid_by is not null)
  ),
  -- PORTÃO DA FUNDAÇÃO: fechamento/pagamento não existem nesta sprint.
  constraint payroll_competences_foundation_no_close_pay_chk check (status not in ('closed', 'paid')),
  constraint payroll_competences_metadata_chk check (public.finance_jsonb_is_sanitized(metadata))
);

-- Uma versão vigente por funcionário + competência.
create unique index if not exists payroll_competences_current_uidx
  on public.payroll_competences (employee_id, competence_month) where is_current;

drop trigger if exists trg_payroll_competences_set_updated_at on public.payroll_competences;
create trigger trg_payroll_competences_set_updated_at
before update on public.payroll_competences
for each row execute function public.set_updated_at();

create or replace function public.trg_payroll_competences_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'payroll_competences_no_delete' using errcode = 'P0001';
  end if;
  if OLD.status in ('closed', 'paid') then
    raise exception 'payroll_competence_closed_immutable' using errcode = 'P0001';
  end if;
  if (NEW.employee_id, NEW.competence_month, NEW.version, NEW.period_start, NEW.period_end, NEW.idempotency_key)
     is distinct from (OLD.employee_id, OLD.competence_month, OLD.version, OLD.period_start, OLD.period_end, OLD.idempotency_key) then
    raise exception 'payroll_competence_identity_immutable' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_payroll_competences_guard() from public, anon, authenticated;

drop trigger if exists trg_payroll_competences_guard on public.payroll_competences;
create trigger trg_payroll_competences_guard
before update or delete on public.payroll_competences
for each row execute function public.trg_payroll_competences_guard();

-- ============================================================
-- 8. employee_worked_days
-- ============================================================
create table if not exists public.employee_worked_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  -- Dia civil em America/Sao_Paulo.
  work_date date not null,
  status text not null,
  meal_eligible boolean not null default false,
  source text not null default 'manual_rpc',
  operation_id text not null,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_worked_days_employee_date_uq unique (employee_id, work_date),
  constraint employee_worked_days_status_chk check (status in (
    'worked', 'absent', 'vacation', 'leave', 'holiday', 'compensated'
  )),
  constraint employee_worked_days_meal_chk check (not meal_eligible or status = 'worked'),
  constraint employee_worked_days_source_chk check (source in ('manual_rpc')),
  constraint employee_worked_days_operation_chk check (operation_id ~ '^[A-Za-z0-9_-]{16,128}$')
);

drop trigger if exists trg_employee_worked_days_set_updated_at on public.employee_worked_days;
create trigger trg_employee_worked_days_set_updated_at
before update on public.employee_worked_days
for each row execute function public.set_updated_at();

-- Após competência closed/paid: alteração exige ajuste, nunca sobrescrita.
create or replace function public.trg_employee_worked_days_closed_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'employee_worked_days_no_delete' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.payroll_competences c
    where c.employee_id = NEW.employee_id
      and c.is_current
      and c.competence_month = date_trunc('month', NEW.work_date::timestamp)::date
      and c.status in ('closed', 'paid')
  ) or (TG_OP = 'UPDATE' and exists (
    select 1 from public.payroll_competences c
    where c.employee_id = OLD.employee_id
      and c.is_current
      and c.competence_month = date_trunc('month', OLD.work_date::timestamp)::date
      and c.status in ('closed', 'paid')
  )) then
    raise exception 'competence_closed_requires_adjustment' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_employee_worked_days_closed_guard() from public, anon, authenticated;

drop trigger if exists trg_employee_worked_days_closed_guard on public.employee_worked_days;
create trigger trg_employee_worked_days_closed_guard
before insert or update or delete on public.employee_worked_days
for each row execute function public.trg_employee_worked_days_closed_guard();

-- ============================================================
-- 9. payroll_competence_lines (append-only)
-- ============================================================
create table if not exists public.payroll_competence_lines (
  id uuid primary key default gen_random_uuid(),
  competence_id uuid not null references public.payroll_competences(id) on delete restrict,
  line_type text not null,
  source_table text,
  source_id uuid,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_amount numeric(10,2),
  amount numeric(10,2) not null,
  reason text,
  snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint payroll_competence_lines_idem_uq unique (idempotency_key),
  constraint payroll_competence_lines_type_chk check (line_type in (
    'base_salary', 'commission', 'meal', 'transport', 'fuel',
    'other_earning', 'discount', 'adjustment', 'reversal'
  )),
  constraint payroll_competence_lines_source_chk check (
    source_table is null or source_table in (
      'employee_commission_entitlements', 'employee_worked_days', 'employee_compensation_profiles'
    )
  ),
  -- Descrição sanitizada: curta, sem sequências longas de dígitos (documentos/telefones) nem e-mail.
  constraint payroll_competence_lines_description_chk check (
    char_length(btrim(description)) between 3 and 200
    and description !~ '[0-9]{8,}'
    and description !~ '@'
  ),
  constraint payroll_competence_lines_quantity_chk check (quantity >= 0),
  constraint payroll_competence_lines_math_chk check (
    unit_amount is null or amount = round(quantity * unit_amount, 2)
  ),
  constraint payroll_competence_lines_sign_chk check (
    (line_type in ('discount', 'reversal') and amount < 0)
    or (line_type = 'adjustment' and amount <> 0)
    or (line_type not in ('discount', 'reversal', 'adjustment') and amount >= 0)
  ),
  constraint payroll_competence_lines_reason_chk check (
    line_type not in ('adjustment', 'reversal', 'discount') or char_length(btrim(coalesce(reason, ''))) >= 3
  ),
  constraint payroll_competence_lines_snapshot_chk check (public.finance_jsonb_is_sanitized(snapshot))
);

create index if not exists payroll_competence_lines_competence_idx
  on public.payroll_competence_lines (competence_id);

create or replace function public.trg_payroll_competence_lines_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if TG_OP <> 'INSERT' then
    raise exception 'payroll_competence_lines_append_only' using errcode = 'P0001';
  end if;
  select c.status into v_status from public.payroll_competences c where c.id = NEW.competence_id;
  if v_status in ('closed', 'paid') then
    raise exception 'payroll_competence_closed_immutable' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_payroll_competence_lines_guard() from public, anon, authenticated;

drop trigger if exists trg_payroll_competence_lines_guard on public.payroll_competence_lines;
create trigger trg_payroll_competence_lines_guard
before insert or update or delete on public.payroll_competence_lines
for each row execute function public.trg_payroll_competence_lines_guard();

drop trigger if exists trg_payroll_competence_lines_no_truncate on public.payroll_competence_lines;
create trigger trg_payroll_competence_lines_no_truncate
before truncate on public.payroll_competence_lines
for each statement execute function public.trg_finance_append_only();

-- ============================================================
-- RLS + grants das tabelas novas: RLS ON (FORCE), sem policies (nega tudo
-- para anon/authenticated, inclusive SELECT de salário entre funcionários),
-- sem DML direto; service_role somente SELECT (sem DELETE/TRUNCATE).
-- ============================================================
do $$
declare
  v_t text;
begin
  foreach v_t in array array[
    'finance_audit_events',
    'employee_commission_rules',
    'employee_commission_entitlements',
    'employee_compensation_profiles',
    'employee_worked_days',
    'payroll_competences',
    'payroll_competence_lines'
  ] loop
    execute format('alter table public.%I enable row level security', v_t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_t);
    execute format('grant select on table public.%I to service_role', v_t);
  end loop;
end$$;

-- ============================================================
-- 10. RPCs internas (SECURITY DEFINER; papel validado internamente)
-- NÃO existem nesta sprint: activate_commission_rule, evaluate_invoice_commission,
-- marcação de entitlement pago, close/pay de competência, job, cron, webhook.
-- ============================================================

-- 10.1 attribute_employee_sales_opportunity — idempotente; nunca cria reward.
create or replace function public.attribute_employee_sales_opportunity(
  p_idempotency_key text,
  p_opportunity_id uuid,
  p_employee_id uuid,
  p_attribution_role text,
  p_sector_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_origin text;
  v_sector_code text;
  v_expected_sector text;
  v_membership_id uuid;
  v_existing public.sales_opportunity_attributions;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if p_attribution_role is null or p_attribution_role not in (
    'technician_originator', 'external_sales_originator', 'internal_sales_responsible'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_attribution_role');
  end if;

  -- Ponto financeiro serializado pela oportunidade (FOR UPDATE).
  select r.origin_kind into v_origin from public.referrals r where r.id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'opportunity_not_found');
  end if;
  if v_origin is distinct from 'employee' then
    return jsonb_build_object('ok', false, 'code', 'attribution_requires_employee_origin');
  end if;

  select * into v_existing from public.sales_opportunity_attributions a where a.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.opportunity_id = p_opportunity_id and v_existing.employee_id = p_employee_id
       and v_existing.attribution_role = p_attribution_role then
      return jsonb_build_object('ok', true, 'idempotent', true, 'attribution_id', v_existing.id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  select * into v_existing from public.sales_opportunity_attributions a
  where a.opportunity_id = p_opportunity_id and a.attribution_role = p_attribution_role;
  if found then
    if v_existing.employee_id = p_employee_id then
      return jsonb_build_object('ok', true, 'idempotent', true, 'attribution_id', v_existing.id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'attribution_role_taken');
  end if;

  if not exists (select 1 from public.employees e where e.id = p_employee_id and e.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'employee_not_active');
  end if;

  -- Compatibilidade papel x setor (códigos de patch-employee-sector-foundation.sql).
  v_expected_sector := case p_attribution_role
    when 'technician_originator' then 'technician'
    when 'external_sales_originator' then 'external_sales'
    when 'internal_sales_responsible' then 'commercial'
  end;
  select s.code into v_sector_code from public.sectors s where s.id = p_sector_id and s.is_active;
  if v_sector_code is null or v_sector_code is distinct from v_expected_sector then
    return jsonb_build_object('ok', false, 'code', 'role_sector_incompatible');
  end if;

  select m.id into v_membership_id from public.employee_sector_memberships m
  where m.employee_id = p_employee_id and m.sector_id = p_sector_id and m.is_active
  limit 1;
  if v_membership_id is null then
    return jsonb_build_object('ok', false, 'code', 'membership_not_active');
  end if;

  insert into public.sales_opportunity_attributions (
    opportunity_id, employee_id, attribution_role, sector_id, membership_id,
    attributed_by, source, metadata, idempotency_key
  )
  values (
    p_opportunity_id, p_employee_id, p_attribution_role, p_sector_id, v_membership_id,
    auth.uid(), 'attribution_rpc', jsonb_build_object('rpc', 'attribute_employee_sales_opportunity'), p_idempotency_key
  )
  returning id into v_id;

  perform public.finance_audit_log(
    'attribution_created', 'sales_opportunity_attribution', v_id, '{}'::jsonb,
    jsonb_build_object('attribution_role', p_attribution_role, 'reward_created', false),
    null, p_idempotency_key
  );

  return jsonb_build_object('ok', true, 'idempotent', false, 'attribution_id', v_id);
end;
$$;

-- 10.2 create_commission_rule_draft — sempre draft, active=false, retroactive=false.
create or replace function public.create_commission_rule_draft(
  p_idempotency_key text,
  p_sector_id uuid,
  p_attribution_role text,
  p_method text,
  p_trigger_kind text,
  p_fixed_amount numeric,
  p_percentage_rate numeric,
  p_percentage_base text,
  p_effective_from date,
  p_effective_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_existing uuid;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.idem:' || p_idempotency_key, 0));
  select r.id into v_existing from public.employee_commission_rules r where r.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'rule_id', v_existing);
  end if;

  begin
    insert into public.employee_commission_rules (
      rule_family_id, version, sector_id, attribution_role, method, trigger_kind,
      fixed_amount, percentage_rate, percentage_base, effective_from, effective_until,
      status, active, retroactive, idempotency_key, created_by
    )
    values (
      gen_random_uuid(), 1, p_sector_id, p_attribution_role, p_method, p_trigger_kind,
      round(p_fixed_amount, 2), p_percentage_rate, nullif(btrim(coalesce(p_percentage_base, '')), ''),
      p_effective_from, p_effective_until,
      'draft', false, false, p_idempotency_key, auth.uid()
    )
    returning id into v_id;
  exception when check_violation or not_null_violation or foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_rule');
  end;

  perform public.finance_audit_log(
    'commission_rule_draft_created', 'employee_commission_rule', v_id, '{}'::jsonb,
    jsonb_build_object('method', p_method, 'trigger_kind', p_trigger_kind, 'status', 'draft',
                       'active', false, 'retroactive', false, 'version', 1),
    null, p_idempotency_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'rule_id', v_id, 'version', 1);
end;
$$;

-- 10.3 version_commission_rule_draft — nova linha; a anterior só muda status
-- draft -> superseded (valores/snapshot intocados, garantido por trigger).
create or replace function public.version_commission_rule_draft(
  p_idempotency_key text,
  p_previous_rule_id uuid,
  p_method text,
  p_trigger_kind text,
  p_fixed_amount numeric,
  p_percentage_rate numeric,
  p_percentage_base text,
  p_effective_from date,
  p_effective_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_prev public.employee_commission_rules;
  v_existing uuid;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;

  select * into v_prev from public.employee_commission_rules r where r.id = p_previous_rule_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'rule_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.family:' || v_prev.rule_family_id::text, 0));

  select r.id into v_existing from public.employee_commission_rules r where r.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'rule_id', v_existing);
  end if;
  select * into v_prev from public.employee_commission_rules r where r.id = p_previous_rule_id for update;
  if v_prev.status <> 'draft' or exists (
    select 1 from public.employee_commission_rules r
    where r.rule_family_id = v_prev.rule_family_id and r.version > v_prev.version
  ) then
    return jsonb_build_object('ok', false, 'code', 'rule_not_latest_draft');
  end if;

  begin
    insert into public.employee_commission_rules (
      rule_family_id, version, previous_version_id, sector_id, attribution_role, method, trigger_kind,
      fixed_amount, percentage_rate, percentage_base, effective_from, effective_until,
      status, active, retroactive, idempotency_key, created_by
    )
    values (
      v_prev.rule_family_id, v_prev.version + 1, v_prev.id, v_prev.sector_id, v_prev.attribution_role,
      p_method, p_trigger_kind, round(p_fixed_amount, 2), p_percentage_rate,
      nullif(btrim(coalesce(p_percentage_base, '')), ''), p_effective_from, p_effective_until,
      'draft', false, false, p_idempotency_key, auth.uid()
    )
    returning id into v_id;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_rule');
  end;

  update public.employee_commission_rules set status = 'superseded' where id = v_prev.id;

  perform public.finance_audit_log(
    'commission_rule_draft_versioned', 'employee_commission_rule', v_id,
    jsonb_build_object('version', v_prev.version, 'status', 'draft'),
    jsonb_build_object('version', v_prev.version + 1, 'status', 'draft', 'previous_status', 'superseded'),
    null, p_idempotency_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'rule_id', v_id, 'version', v_prev.version + 1);
end;
$$;

-- 10.4 configure_employee_compensation_draft — nova versão, sempre draft.
-- Componente com valor NULL = não configurado (não aparece ao funcionário).
-- Valor sugerido de refeição (R$ 22,00/dia) é apenas sugestão de UI futura;
-- NÃO é default de banco.
create or replace function public.configure_employee_compensation_draft(
  p_idempotency_key text,
  p_employee_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_salary_amount numeric,
  p_meal_daily_amount numeric,
  p_transport_amount numeric,
  p_transport_method text,
  p_fuel_amount numeric,
  p_fuel_method text,
  p_show_salary boolean default false,
  p_show_meal boolean default false,
  p_show_transport boolean default false,
  p_show_fuel boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_existing uuid;
  v_prev public.employee_compensation_profiles;
  v_version integer;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if p_employee_id is null or not exists (select 1 from public.employees e where e.id = p_employee_id) then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.compensation.employee:' || p_employee_id::text, 0));
  select c.id into v_existing from public.employee_compensation_profiles c where c.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'profile_id', v_existing);
  end if;

  select * into v_prev from public.employee_compensation_profiles c
  where c.employee_id = p_employee_id order by c.version desc limit 1;
  v_version := coalesce(v_prev.version, 0) + 1;

  begin
    insert into public.employee_compensation_profiles (
      employee_id, version, previous_version_id, valid_from, valid_until,
      salary_enabled, salary_amount, meal_enabled, meal_daily_amount,
      transport_enabled, transport_amount, transport_method,
      fuel_enabled, fuel_amount, fuel_method,
      show_salary, show_meal, show_transport, show_fuel,
      status, snapshot, idempotency_key, created_by
    )
    values (
      p_employee_id, v_version, v_prev.id, p_valid_from, p_valid_until,
      p_salary_amount is not null, round(p_salary_amount, 2),
      p_meal_daily_amount is not null, round(p_meal_daily_amount, 2),
      p_transport_amount is not null, round(p_transport_amount, 2), p_transport_method,
      p_fuel_amount is not null, round(p_fuel_amount, 2), p_fuel_method,
      coalesce(p_show_salary, false), coalesce(p_show_meal, false),
      coalesce(p_show_transport, false), coalesce(p_show_fuel, false),
      'draft',
      jsonb_build_object('version', v_version, 'components', jsonb_build_object(
        'salary', p_salary_amount is not null, 'meal', p_meal_daily_amount is not null,
        'transport', p_transport_amount is not null, 'fuel', p_fuel_amount is not null)),
      p_idempotency_key, auth.uid()
    )
    returning id into v_id;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_compensation');
  end;

  perform public.finance_audit_log(
    'compensation_draft_configured', 'employee_compensation_profile', v_id, '{}'::jsonb,
    jsonb_build_object('version', v_version, 'status', 'draft'),
    null, p_idempotency_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'profile_id', v_id, 'version', v_version);
end;
$$;

-- 10.5 record_employee_worked_day — idempotente por funcionário/data/operação.
create or replace function public.record_employee_worked_day(
  p_operation_id text,
  p_employee_id uuid,
  p_work_date date,
  p_status text,
  p_meal_eligible boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_existing public.employee_worked_days;
  v_found boolean;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_operation_id is null or p_operation_id !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_operation_id');
  end if;
  if p_work_date is null or p_employee_id is null
     or not exists (select 1 from public.employees e where e.id = p_employee_id) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'igt.worked_day:' || p_employee_id::text || ':' || p_work_date::text, 0));

  select * into v_existing from public.employee_worked_days w
  where w.employee_id = p_employee_id and w.work_date = p_work_date for update;
  v_found := found;

  if v_found and v_existing.operation_id = p_operation_id then
    return jsonb_build_object('ok', true, 'idempotent', true, 'worked_day_id', v_existing.id);
  end if;

  begin
    if v_found then
      update public.employee_worked_days
      set status = p_status, meal_eligible = coalesce(p_meal_eligible, false),
          operation_id = p_operation_id, recorded_by = auth.uid()
      where id = v_existing.id
      returning id into v_id;
      perform public.finance_audit_log(
        'worked_day_changed', 'employee_worked_day', v_id,
        jsonb_build_object('status', v_existing.status, 'meal_eligible', v_existing.meal_eligible),
        jsonb_build_object('status', p_status, 'meal_eligible', coalesce(p_meal_eligible, false)),
        null, p_operation_id
      );
    else
      insert into public.employee_worked_days (employee_id, work_date, status, meal_eligible, source, operation_id, recorded_by)
      values (p_employee_id, p_work_date, p_status, coalesce(p_meal_eligible, false), 'manual_rpc', p_operation_id, auth.uid())
      returning id into v_id;
      perform public.finance_audit_log(
        'worked_day_recorded', 'employee_worked_day', v_id, '{}'::jsonb,
        jsonb_build_object('status', p_status, 'meal_eligible', coalesce(p_meal_eligible, false)),
        null, p_operation_id
      );
    end if;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'invalid_worked_day');
    when raise_exception then
      if sqlerrm = 'competence_closed_requires_adjustment' then
        return jsonb_build_object('ok', false, 'code', 'competence_closed_requires_adjustment');
      end if;
      raise;
  end;

  return jsonb_build_object('ok', true, 'idempotent', false, 'worked_day_id', v_id);
end;
$$;

-- 10.6 open_payroll_competence_draft — não calcula, não paga, não cria linhas.
create or replace function public.open_payroll_competence_draft(
  p_idempotency_key text,
  p_employee_id uuid,
  p_competence_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_month date;
  v_existing uuid;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if p_competence_month is null or p_employee_id is null
     or not exists (select 1 from public.employees e where e.id = p_employee_id) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_month := date_trunc('month', p_competence_month::timestamp)::date;

  perform pg_advisory_xact_lock(hashtextextended(
    'igt.payroll_competence:' || p_employee_id::text || ':' || v_month::text, 0));

  select c.id into v_existing from public.payroll_competences c
  where c.employee_id = p_employee_id and c.competence_month = v_month and c.is_current;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competence_id', v_existing);
  end if;
  select c.id into v_existing from public.payroll_competences c where c.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  insert into public.payroll_competences (
    employee_id, competence_month, timezone, period_start, period_end, version, is_current,
    status, idempotency_key, created_by
  )
  values (
    p_employee_id, v_month, 'America/Sao_Paulo', v_month, public.payroll_competence_period_end(v_month),
    1, true, 'draft', p_idempotency_key, auth.uid()
  )
  returning id into v_id;

  perform public.finance_audit_log(
    'payroll_competence_draft_opened', 'payroll_competence', v_id, '{}'::jsonb,
    jsonb_build_object('status', 'draft', 'version', 1), null, p_idempotency_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'competence_id', v_id);
end;
$$;

-- 10.7 add_manual_payroll_adjustment — somente draft/reviewed; motivo obrigatório.
create or replace function public.add_manual_payroll_adjustment(
  p_idempotency_key text,
  p_competence_id uuid,
  p_line_type text,
  p_amount numeric,
  p_description text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_status text;
  v_existing public.payroll_competence_lines;
  v_id uuid;
  v_amount numeric(10,2);
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if p_line_type is null or p_line_type not in ('adjustment', 'discount', 'other_earning') then
    return jsonb_build_object('ok', false, 'code', 'invalid_line_type');
  end if;
  if p_amount is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;
  v_amount := round(p_amount, 2);

  -- Ponto financeiro serializado pela competência (FOR UPDATE).
  select c.status into v_status from public.payroll_competences c where c.id = p_competence_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;

  select * into v_existing from public.payroll_competence_lines l where l.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.competence_id = p_competence_id and v_existing.line_type = p_line_type and v_existing.amount = v_amount then
      return jsonb_build_object('ok', true, 'idempotent', true, 'line_id', v_existing.id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  if v_status not in ('draft', 'reviewed') then
    return jsonb_build_object('ok', false, 'code', 'competence_not_adjustable');
  end if;

  begin
    insert into public.payroll_competence_lines (
      competence_id, line_type, source_table, source_id, description, quantity, unit_amount, amount,
      reason, snapshot, idempotency_key, created_by
    )
    values (
      p_competence_id, p_line_type, null, null, btrim(coalesce(p_description, '')), 1, v_amount, v_amount,
      btrim(p_reason), jsonb_build_object('manual', true), p_idempotency_key, auth.uid()
    )
    returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_adjustment');
  end;

  perform public.finance_audit_log(
    'payroll_adjustment_added', 'payroll_competence_line', v_id, '{}'::jsonb,
    jsonb_build_object('line_type', p_line_type, 'competence_status', v_status),
    btrim(p_reason), p_idempotency_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'line_id', v_id);
end;
$$;

-- Grants das RPCs: somente authenticated (papel validado internamente);
-- sem PUBLIC/anon/service_role.
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.attribute_employee_sales_opportunity(text, uuid, uuid, text, uuid)',
    'public.create_commission_rule_draft(text, uuid, text, text, text, numeric, numeric, text, date, date)',
    'public.version_commission_rule_draft(text, uuid, text, text, numeric, numeric, text, date, date)',
    'public.configure_employee_compensation_draft(text, uuid, date, date, numeric, numeric, numeric, text, numeric, text, boolean, boolean, boolean, boolean)',
    'public.record_employee_worked_day(text, uuid, date, text, boolean)',
    'public.open_payroll_competence_draft(text, uuid, date)',
    'public.add_manual_payroll_adjustment(text, uuid, text, numeric, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end$$;

commit;
