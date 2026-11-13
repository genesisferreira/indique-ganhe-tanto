-- Sprint 3.1F-J4 — Configuração de comissão e remuneração de funcionários (somente rascunho).
--
-- ADITIVA, transacional e reaplicável (IF NOT EXISTS / CREATE OR REPLACE / DROP+ADD da mesma
-- CHECK ampliada). Sem backfill, sem UPDATE de dados existentes, sem DROP de tabela/coluna/função,
-- sem policy nova/alterada (RLS das tabelas financeiras permanece ligada e sem grants a clientes).
--
-- Garantias preservadas (CHECKs da fundação 3.1F-I1 NÃO são tocadas):
--   * employee_commission_rules_foundation_inactive_chk  -> nenhuma regra ativa;
--   * employee_commission_rules_no_retroactive_chk       -> retroactive = false;
--   * employee_compensation_profiles_foundation_inactive_chk -> nenhum perfil ativo;
--   * gate de entitlements / competências / linhas intocado. Nenhuma RPC de ativação existe.
--
-- Conteúdo:
--  1. Colunas aditivas: regra (rule_name, description, change_reason, request_hash);
--     perfil (notes, change_reason, request_hash). Sem default de valor monetário.
--  2. Guardas de banco: regra sem sobreposição por papel/tipo/período (trigger BEFORE INSERT com
--     advisory lock) e no máximo UM rascunho vigente por funcionário (índice único parcial).
--  3. finance_audit_events: CHECK de action AMPLIADA com 3 ações (arquivamento e versão de perfil).
--  4. RPCs de escrita (contrato JSON fechado, SECURITY DEFINER, admin_master/admin_financeiro):
--     admin_save_commission_rule_draft, admin_archive_commission_rule_draft,
--     admin_save_employee_compensation_draft, admin_archive_employee_compensation_draft.
--  5. RPCs de leitura admin: admin_list_commission_rules, admin_list_compensation_employees,
--     admin_get_employee_compensation.
--  6. RPC de leitura do funcionário: employee_compensation_preview (somente componentes
--     configurados E visíveis do próprio rascunho vigente; comissão "não calculada").
--  7. Grants mínimos. As RPCs posicionais da fundação I1 (sem motivo/sem controle de sobreposição)
--     e as de dias trabalhados/competência/ajuste deixam de ser executáveis por authenticated
--     (funções preservadas, sem DROP). Nenhum dia trabalhado/competência/folha nesta entrega.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.employee_commission_rules') is null
     or to_regclass('public.employee_compensation_profiles') is null
     or to_regclass('public.employee_commission_entitlements') is null
     or to_regclass('public.finance_audit_events') is null
     or to_regclass('public.payroll_competences') is null
     or to_regclass('public.payroll_competence_lines') is null
     or to_regclass('public.employee_worked_days') is null
     or to_regclass('public.employee_sector_memberships') is null
     or to_regprocedure('public.finance_admin_actor_role()') is null
     or to_regprocedure('public.finance_audit_log(text,text,uuid,jsonb,jsonb,text,text)') is null
     or to_regprocedure('public.finance_jsonb_keys_allowed(jsonb,text[])') is null
     or to_regprocedure('public.finance_json_is_money(jsonb)') is null
     or to_regprocedure('public.finance_json_is_rate(jsonb)') is null
     or to_regprocedure('public.finance_json_is_date(jsonb)') is null
     or to_regprocedure('public.finance_json_is_uuid(jsonb)') is null
     or to_regprocedure('public.finance_percentage_rate_valid(numeric)') is null
     or to_regprocedure('public.employee_portal_self()') is null
     or not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_foundation_inactive_chk'
                    and conrelid = 'public.employee_commission_rules'::regclass)
     or not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_no_retroactive_chk'
                    and conrelid = 'public.employee_commission_rules'::regclass)
     or not exists (select 1 from pg_constraint where conname = 'employee_compensation_profiles_foundation_inactive_chk'
                    and conrelid = 'public.employee_compensation_profiles'::regclass)
     or not exists (select 1 from pg_constraint where conname = 'finance_audit_events_action_chk'
                    and conrelid = 'public.finance_audit_events'::regclass) then
    raise exception 'j4_prerequisite_missing: aplicar 3.1F-I1/I1B/J2/J3 antes';
  end if;
  -- Nenhuma regra/perfil ativo pode existir antes (garantia da fundação).
  if exists (select 1 from public.employee_commission_rules where active or status = 'active')
     or exists (select 1 from public.employee_compensation_profiles where status = 'active') then
    raise exception 'j4_active_financial_configuration_found';
  end if;
end$$;

-- ============================================================
-- 1. Colunas aditivas (nullable, sem default; preenchidas somente pelas RPCs J4)
-- ============================================================
alter table public.employee_commission_rules add column if not exists rule_name text;
alter table public.employee_commission_rules add column if not exists description text;
alter table public.employee_commission_rules add column if not exists change_reason text;
alter table public.employee_commission_rules add column if not exists request_hash text;
alter table public.employee_compensation_profiles add column if not exists notes text;
alter table public.employee_compensation_profiles add column if not exists change_reason text;
alter table public.employee_compensation_profiles add column if not exists request_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_rule_name_chk') then
    alter table public.employee_commission_rules add constraint employee_commission_rules_rule_name_chk
      check (rule_name is null or char_length(btrim(rule_name)) between 3 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_description_chk') then
    alter table public.employee_commission_rules add constraint employee_commission_rules_description_chk
      check (description is null or char_length(description) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_change_reason_chk') then
    alter table public.employee_commission_rules add constraint employee_commission_rules_change_reason_chk
      check (change_reason is null or char_length(btrim(change_reason)) between 3 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_request_hash_chk') then
    alter table public.employee_commission_rules add constraint employee_commission_rules_request_hash_chk
      check (request_hash is null or request_hash ~ '^[0-9a-f]{32}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_compensation_profiles_notes_chk') then
    alter table public.employee_compensation_profiles add constraint employee_compensation_profiles_notes_chk
      check (notes is null or char_length(notes) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_compensation_profiles_change_reason_chk') then
    alter table public.employee_compensation_profiles add constraint employee_compensation_profiles_change_reason_chk
      check (change_reason is null or char_length(btrim(change_reason)) between 3 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_compensation_profiles_request_hash_chk') then
    alter table public.employee_compensation_profiles add constraint employee_compensation_profiles_request_hash_chk
      check (request_hash is null or request_hash ~ '^[0-9a-f]{32}$');
  end if;
end$$;

-- ============================================================
-- 2. Guardas de sobreposição
-- ============================================================
-- 2a. Regra: no máximo um rascunho por papel/tipo cobrindo o mesmo dia.
create or replace function public.trg_employee_commission_rules_no_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.status = 'draft' and NEW.attribution_role is not null then
    perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.scope:' || NEW.attribution_role || ':' || NEW.method, 0));
    if exists (
      select 1 from public.employee_commission_rules r
      where r.id <> NEW.id
        and r.status = 'draft'
        and r.attribution_role = NEW.attribution_role
        and r.method = NEW.method
        and daterange(r.effective_from, r.effective_until, '[]') && daterange(NEW.effective_from, NEW.effective_until, '[]')
    ) then
      raise exception 'employee_commission_rule_overlap' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_employee_commission_rules_no_overlap() from public, anon, authenticated, service_role;

drop trigger if exists trg_employee_commission_rules_no_overlap on public.employee_commission_rules;
create trigger trg_employee_commission_rules_no_overlap
before insert on public.employee_commission_rules
for each row execute function public.trg_employee_commission_rules_no_overlap();

-- 2b. Perfil: um único rascunho vigente por funcionário (nova versão inativa a anterior).
create unique index if not exists employee_compensation_profiles_one_draft_uidx
  on public.employee_compensation_profiles (employee_id) where status = 'draft';

-- ============================================================
-- 3. Auditoria: CHECK de action ampliada (somente adição de valores)
-- ============================================================
alter table public.finance_audit_events drop constraint if exists finance_audit_events_action_chk;
alter table public.finance_audit_events add constraint finance_audit_events_action_chk check (action in (
  'attribution_created',
  'commission_rule_draft_created',
  'commission_rule_draft_versioned',
  'compensation_draft_configured',
  'worked_day_recorded',
  'worked_day_changed',
  'payroll_competence_draft_opened',
  'payroll_adjustment_added',
  'approve', 'adjust', 'reverse', 'reopen', 'pay',
  -- 3.1F-J4:
  'commission_rule_draft_archived',
  'compensation_draft_versioned',
  'compensation_draft_archived'
));

-- ============================================================
-- 4. Helpers internos (sem EXECUTE para clientes)
-- ============================================================
create or replace function public.comp_cfg_today()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

create or replace function public.comp_cfg_is_null(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is null or jsonb_typeof(p) = 'null';
$$;

-- Texto obrigatório (string, comprimento após btrim entre min e max).
create or replace function public.comp_cfg_text_ok(p jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is not null and jsonb_typeof(p) = 'string'
    and char_length(btrim(p #>> '{}')) between p_min and p_max;
$$;

-- Texto opcional: ausente/null ou string com até max caracteres.
create or replace function public.comp_cfg_opt_text_ok(p jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.comp_cfg_is_null(p)
    or (jsonb_typeof(p) = 'string' and char_length(btrim(p #>> '{}')) <= p_max);
$$;

-- Valor BRL opcional: ausente/null ou string decimal positiva com até 2 casas.
create or replace function public.comp_cfg_opt_money_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.comp_cfg_is_null(p)
    or (public.finance_json_is_money(p) and (p #>> '{}')::numeric > 0);
$$;

create or replace function public.comp_cfg_opt_bool_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is null or jsonb_typeof(p) = 'boolean';
$$;

create or replace function public.comp_cfg_status_label(p_status text, p_has_successor boolean)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_status = 'draft' then 'draft'
    when p_status = 'superseded' then 'superseded'
    when p_status = 'inactive' and p_has_successor then 'superseded'
    when p_status = 'inactive' then 'archived'
    else 'unknown'
  end;
$$;

revoke all on function public.comp_cfg_today() from public, anon, authenticated, service_role;
revoke all on function public.comp_cfg_is_null(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.comp_cfg_text_ok(jsonb, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.comp_cfg_opt_text_ok(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.comp_cfg_opt_money_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.comp_cfg_opt_bool_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.comp_cfg_status_label(text, boolean) from public, anon, authenticated, service_role;

-- ============================================================
-- 5. Escrita: regra de comissão (criar rascunho / nova versão)
-- ============================================================
-- Contrato: {idempotencyKey, previousRuleId?, name, attributionRole?, method, fixedAmount?,
--            percentageRate?, percentageBase?, effectiveFrom, effectiveUntil?, description?, reason}
-- * gatilho derivado do tipo (nunca escolhido pelo cliente);
-- * percentageRate = FRAÇÃO (0.02 = 2%), até 6 casas, nunca arredondada;
-- * percentageBase: nenhuma base comprovada => só null (percentual fica "rascunho incompleto");
-- * Vendedor Interno (internal_sales_responsible) desabilitado nesta etapa;
-- * vigência inicial >= hoje (America/Sao_Paulo): sem retroatividade;
-- * mesma chave + mesmo payload => versão original; mesma chave + payload diferente => conflito.
create or replace function public.admin_save_commission_rule_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_hash text;
  v_existing public.employee_commission_rules;
  v_prev public.employee_commission_rules;
  v_prev_id uuid;
  v_attr text;
  v_method text;
  v_trigger text;
  v_fixed numeric(10,2);
  v_rate numeric(7,6);
  v_from date;
  v_until date;
  v_family uuid;
  v_version integer;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if not public.finance_jsonb_keys_allowed(p_payload, array[
    'idempotencyKey', 'previousRuleId', 'name', 'attributionRole', 'method', 'fixedAmount',
    'percentageRate', 'percentageBase', 'effectiveFrom', 'effectiveUntil', 'description', 'reason'
  ]) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  if jsonb_typeof(p_payload -> 'idempotencyKey') is distinct from 'string'
     or (p_payload ->> 'idempotencyKey') !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  v_hash := md5((p_payload - 'idempotencyKey')::text);

  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.idem:' || v_key, 0));
  select * into v_existing from public.employee_commission_rules r where r.idempotency_key = v_key;
  if found then
    if v_existing.request_hash is not distinct from v_hash then
      return jsonb_build_object('ok', true, 'idempotent', true, 'ruleId', v_existing.id,
        'familyId', v_existing.rule_family_id, 'version', v_existing.version, 'status', 'draft');
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if exists (select 1 from public.finance_audit_events a where a.idempotency_key = v_key)
     or exists (select 1 from public.employee_compensation_profiles c where c.idempotency_key = v_key) then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  -- Campos
  if not public.comp_cfg_text_ok(p_payload -> 'name', 3, 120) then
    return jsonb_build_object('ok', false, 'code', 'invalid_name');
  end if;
  if not public.comp_cfg_text_ok(p_payload -> 'reason', 3, 500) then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if not public.comp_cfg_opt_text_ok(p_payload -> 'description', 500) then
    return jsonb_build_object('ok', false, 'code', 'invalid_description');
  end if;
  if not (public.comp_cfg_is_null(p_payload -> 'previousRuleId') or public.finance_json_is_uuid(p_payload -> 'previousRuleId')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_previous_rule');
  end if;
  if not (public.comp_cfg_is_null(p_payload -> 'attributionRole') or jsonb_typeof(p_payload -> 'attributionRole') = 'string') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;
  if jsonb_typeof(p_payload -> 'method') is distinct from 'string'
     or (p_payload ->> 'method') not in ('fixed_amount', 'percentage', 'first_invoice_value') then
    return jsonb_build_object('ok', false, 'code', 'invalid_method');
  end if;
  v_method := p_payload ->> 'method';
  v_trigger := case when v_method = 'first_invoice_value' then 'first_valid_invoice_fully_paid'
                    else 'first_valid_invoice_generated' end;
  if not public.comp_cfg_is_null(p_payload -> 'percentageBase') then
    return jsonb_build_object('ok', false, 'code', 'percentage_base_not_proven');
  end if;
  if v_method = 'fixed_amount' then
    if public.comp_cfg_is_null(p_payload -> 'fixedAmount') or not public.comp_cfg_opt_money_ok(p_payload -> 'fixedAmount') then
      return jsonb_build_object('ok', false, 'code', 'invalid_fixed_amount');
    end if;
    if not public.comp_cfg_is_null(p_payload -> 'percentageRate') then
      return jsonb_build_object('ok', false, 'code', 'invalid_method_values');
    end if;
    v_fixed := (p_payload ->> 'fixedAmount')::numeric;
  elsif v_method = 'percentage' then
    if public.comp_cfg_is_null(p_payload -> 'percentageRate') or not public.finance_json_is_rate(p_payload -> 'percentageRate')
       or not public.finance_percentage_rate_valid((p_payload ->> 'percentageRate')::numeric) then
      return jsonb_build_object('ok', false, 'code', 'invalid_percentage_rate');
    end if;
    if not public.comp_cfg_is_null(p_payload -> 'fixedAmount') then
      return jsonb_build_object('ok', false, 'code', 'invalid_method_values');
    end if;
    v_rate := (p_payload ->> 'percentageRate')::numeric;
  else
    if not public.comp_cfg_is_null(p_payload -> 'fixedAmount') or not public.comp_cfg_is_null(p_payload -> 'percentageRate') then
      return jsonb_build_object('ok', false, 'code', 'invalid_method_values');
    end if;
  end if;
  if not public.finance_json_is_date(p_payload -> 'effectiveFrom') then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  v_from := (p_payload ->> 'effectiveFrom')::date;
  if not public.comp_cfg_is_null(p_payload -> 'effectiveUntil') then
    if not public.finance_json_is_date(p_payload -> 'effectiveUntil') then
      return jsonb_build_object('ok', false, 'code', 'invalid_period');
    end if;
    v_until := (p_payload ->> 'effectiveUntil')::date;
  end if;
  if v_until is not null and v_until < v_from then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  if v_from < public.comp_cfg_today() then
    return jsonb_build_object('ok', false, 'code', 'retroactive_forbidden');
  end if;

  v_attr := nullif(p_payload ->> 'attributionRole', '');
  if not public.comp_cfg_is_null(p_payload -> 'previousRuleId') then
    v_prev_id := (p_payload ->> 'previousRuleId')::uuid;
    select * into v_prev from public.employee_commission_rules r where r.id = v_prev_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'rule_not_found');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.family:' || v_prev.rule_family_id::text, 0));
    select * into v_prev from public.employee_commission_rules r where r.id = v_prev_id for update;
    if v_prev.status <> 'draft' or exists (
      select 1 from public.employee_commission_rules r
      where r.rule_family_id = v_prev.rule_family_id and r.version > v_prev.version
    ) then
      return jsonb_build_object('ok', false, 'code', 'stale_version');
    end if;
    if v_attr is not null and v_attr is distinct from v_prev.attribution_role then
      return jsonb_build_object('ok', false, 'code', 'role_immutable');
    end if;
    v_attr := v_prev.attribution_role;
    v_family := v_prev.rule_family_id;
    v_version := v_prev.version + 1;
  else
    v_family := gen_random_uuid();
    v_version := 1;
  end if;

  if v_attr = 'internal_sales_responsible' then
    return jsonb_build_object('ok', false, 'code', 'role_disabled');
  end if;
  if v_attr is null or v_attr not in ('technician_originator', 'external_sales_originator') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.scope:' || v_attr || ':' || v_method, 0));
  if exists (
    select 1 from public.employee_commission_rules r
    where r.status = 'draft' and r.attribution_role = v_attr and r.method = v_method
      and (v_prev_id is null or r.id <> v_prev_id)
      and daterange(r.effective_from, r.effective_until, '[]') && daterange(v_from, v_until, '[]')
  ) then
    return jsonb_build_object('ok', false, 'code', 'overlapping_rule');
  end if;

  begin
    if v_prev_id is not null then
      update public.employee_commission_rules set status = 'superseded' where id = v_prev_id;
    end if;
    insert into public.employee_commission_rules (
      rule_family_id, version, previous_version_id, sector_id, attribution_role, method, trigger_kind,
      fixed_amount, percentage_rate, percentage_base, effective_from, effective_until,
      status, active, retroactive, idempotency_key, created_by,
      rule_name, description, change_reason, request_hash
    )
    values (
      v_family, v_version, v_prev_id, null, v_attr, v_method, v_trigger,
      v_fixed, v_rate, null, v_from, v_until,
      'draft', false, false, v_key, auth.uid(),
      btrim(p_payload ->> 'name'), nullif(btrim(coalesce(p_payload ->> 'description', '')), ''),
      btrim(p_payload ->> 'reason'), v_hash
    )
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'stale_version');
    when check_violation or not_null_violation or foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'invalid_rule');
    when raise_exception then
      if sqlerrm = 'employee_commission_rule_overlap' then
        return jsonb_build_object('ok', false, 'code', 'overlapping_rule');
      end if;
      raise;
  end;

  perform public.finance_audit_log(
    case when v_prev_id is null then 'commission_rule_draft_created' else 'commission_rule_draft_versioned' end,
    'employee_commission_rule', v_id,
    case when v_prev_id is null then '{}'::jsonb
         else jsonb_build_object('version', v_prev.version, 'status', 'draft') end,
    case when v_prev_id is null
         then jsonb_build_object('attribution_role', v_attr, 'method', v_method, 'trigger_kind', v_trigger,
                                 'status', 'draft', 'active', false, 'retroactive', false, 'version', v_version)
         else jsonb_build_object('attribution_role', v_attr, 'method', v_method, 'trigger_kind', v_trigger,
                                 'status', 'draft', 'previous_status', 'superseded', 'active', false,
                                 'retroactive', false, 'version', v_version) end,
    btrim(p_payload ->> 'reason'), v_key
  );

  return jsonb_build_object('ok', true, 'idempotent', false, 'ruleId', v_id, 'familyId', v_family,
    'version', v_version, 'status', 'draft', 'incomplete', v_method = 'percentage', 'activatable', false);
end;
$$;

-- ============================================================
-- 6. Escrita: arquivar rascunho de regra (nunca apaga)
-- ============================================================
-- Contrato: {idempotencyKey, ruleId, reason}. Somente o rascunho mais recente da família e
-- sem nenhum entitlement referenciando a regra. draft -> inactive (transição já permitida em I1).
create or replace function public.admin_archive_commission_rule_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_rule_id uuid;
  v_reason text;
  v_event public.finance_audit_events;
  v_rule public.employee_commission_rules;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'ruleId', 'reason']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  if jsonb_typeof(p_payload -> 'idempotencyKey') is distinct from 'string'
     or (p_payload ->> 'idempotencyKey') !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'ruleId') then
    return jsonb_build_object('ok', false, 'code', 'rule_not_found');
  end if;
  if not public.comp_cfg_text_ok(p_payload -> 'reason', 3, 500) then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  v_rule_id := (p_payload ->> 'ruleId')::uuid;
  v_reason := btrim(p_payload ->> 'reason');

  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.idem:' || v_key, 0));
  select * into v_event from public.finance_audit_events a where a.idempotency_key = v_key;
  if found then
    if v_event.action = 'commission_rule_draft_archived' and v_event.entity_id = v_rule_id
       and v_event.reason is not distinct from v_reason then
      return jsonb_build_object('ok', true, 'idempotent', true, 'ruleId', v_rule_id, 'status', 'archived');
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if exists (select 1 from public.employee_commission_rules r where r.idempotency_key = v_key)
     or exists (select 1 from public.employee_compensation_profiles c where c.idempotency_key = v_key) then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  select * into v_rule from public.employee_commission_rules r where r.id = v_rule_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'rule_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.family:' || v_rule.rule_family_id::text, 0));
  select * into v_rule from public.employee_commission_rules r where r.id = v_rule_id for update;
  if v_rule.status <> 'draft' or exists (
    select 1 from public.employee_commission_rules r
    where r.rule_family_id = v_rule.rule_family_id and r.version > v_rule.version
  ) then
    return jsonb_build_object('ok', false, 'code', 'stale_version');
  end if;
  if exists (select 1 from public.employee_commission_entitlements e where e.rule_id = v_rule.id) then
    return jsonb_build_object('ok', false, 'code', 'rule_in_use');
  end if;

  update public.employee_commission_rules set status = 'inactive' where id = v_rule.id;
  insert into public.finance_audit_events (
    actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, reason, operation_id, idempotency_key
  ) values (
    auth.uid(), v_role, 'commission_rule_draft_archived', 'employee_commission_rule', v_rule.id,
    jsonb_build_object('status', 'draft', 'version', v_rule.version),
    jsonb_build_object('status', 'inactive', 'previous_status', 'draft', 'version', v_rule.version, 'active', false),
    v_reason, v_key, v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'ruleId', v_rule.id, 'status', 'archived');
end;
$$;

-- ============================================================
-- 7. Escrita: remuneração individual (nova versão, sempre draft)
-- ============================================================
-- Contrato: {idempotencyKey, employeeId, previousProfileId?, validFrom, validUntil?,
--   salaryAmount?, mealDailyAmount?, transportAmount?, transportMethod?, fuelAmount?, fuelMethod?,
--   showSalary?, showMeal?, showTransport?, showFuel?, notes?, reason}
-- * componente ausente/null = não configurado (nunca zero); visibilidade exige componente;
-- * sem default de valor (a sugestão de R$ 22,00/dia é somente da UI);
-- * previousProfileId deve ser o rascunho vigente atual (controle de concorrência otimista);
-- * a versão anterior fica imutável e passa a inactive (substituída); nada é apagado.
create or replace function public.admin_save_employee_compensation_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_hash text;
  v_existing public.employee_compensation_profiles;
  v_current public.employee_compensation_profiles;
  v_latest public.employee_compensation_profiles;
  v_employee_id uuid;
  v_emp_status text;
  v_prev_id uuid;
  v_from date;
  v_until date;
  v_salary numeric(10,2);
  v_meal numeric(10,2);
  v_transport numeric(10,2);
  v_transport_method text;
  v_fuel numeric(10,2);
  v_fuel_method text;
  v_show_salary boolean;
  v_show_meal boolean;
  v_show_transport boolean;
  v_show_fuel boolean;
  v_version integer;
  v_id uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if not public.finance_jsonb_keys_allowed(p_payload, array[
    'idempotencyKey', 'employeeId', 'previousProfileId', 'validFrom', 'validUntil',
    'salaryAmount', 'mealDailyAmount', 'transportAmount', 'transportMethod', 'fuelAmount', 'fuelMethod',
    'showSalary', 'showMeal', 'showTransport', 'showFuel', 'notes', 'reason'
  ]) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  if jsonb_typeof(p_payload -> 'idempotencyKey') is distinct from 'string'
     or (p_payload ->> 'idempotencyKey') !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  v_hash := md5((p_payload - 'idempotencyKey')::text);

  perform pg_advisory_xact_lock(hashtextextended('igt.compensation.idem:' || v_key, 0));
  select * into v_existing from public.employee_compensation_profiles c where c.idempotency_key = v_key;
  if found then
    if v_existing.request_hash is not distinct from v_hash then
      return jsonb_build_object('ok', true, 'idempotent', true, 'profileId', v_existing.id,
        'employeeId', v_existing.employee_id, 'version', v_existing.version, 'status', 'draft');
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if exists (select 1 from public.finance_audit_events a where a.idempotency_key = v_key)
     or exists (select 1 from public.employee_commission_rules r where r.idempotency_key = v_key) then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  if not public.finance_json_is_uuid(p_payload -> 'employeeId') then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;
  if not public.comp_cfg_text_ok(p_payload -> 'reason', 3, 500) then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if not public.comp_cfg_opt_text_ok(p_payload -> 'notes', 500) then
    return jsonb_build_object('ok', false, 'code', 'invalid_notes');
  end if;
  if not (public.comp_cfg_is_null(p_payload -> 'previousProfileId') or public.finance_json_is_uuid(p_payload -> 'previousProfileId')) then
    return jsonb_build_object('ok', false, 'code', 'stale_version');
  end if;
  if not (public.comp_cfg_opt_money_ok(p_payload -> 'salaryAmount')
          and public.comp_cfg_opt_money_ok(p_payload -> 'mealDailyAmount')
          and public.comp_cfg_opt_money_ok(p_payload -> 'transportAmount')
          and public.comp_cfg_opt_money_ok(p_payload -> 'fuelAmount')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;
  if not (public.comp_cfg_opt_bool_ok(p_payload -> 'showSalary') and public.comp_cfg_opt_bool_ok(p_payload -> 'showMeal')
          and public.comp_cfg_opt_bool_ok(p_payload -> 'showTransport') and public.comp_cfg_opt_bool_ok(p_payload -> 'showFuel')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_visibility');
  end if;
  if not (public.comp_cfg_is_null(p_payload -> 'transportMethod')
          or (jsonb_typeof(p_payload -> 'transportMethod') = 'string' and (p_payload ->> 'transportMethod') in ('per_worked_day', 'monthly_fixed')))
     or not (public.comp_cfg_is_null(p_payload -> 'fuelMethod')
          or (jsonb_typeof(p_payload -> 'fuelMethod') = 'string' and (p_payload ->> 'fuelMethod') in ('per_worked_day', 'monthly_fixed'))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_method');
  end if;

  v_salary := case when public.comp_cfg_is_null(p_payload -> 'salaryAmount') then null else (p_payload ->> 'salaryAmount')::numeric end;
  v_meal := case when public.comp_cfg_is_null(p_payload -> 'mealDailyAmount') then null else (p_payload ->> 'mealDailyAmount')::numeric end;
  v_transport := case when public.comp_cfg_is_null(p_payload -> 'transportAmount') then null else (p_payload ->> 'transportAmount')::numeric end;
  v_fuel := case when public.comp_cfg_is_null(p_payload -> 'fuelAmount') then null else (p_payload ->> 'fuelAmount')::numeric end;
  v_transport_method := case when public.comp_cfg_is_null(p_payload -> 'transportMethod') then null else p_payload ->> 'transportMethod' end;
  v_fuel_method := case when public.comp_cfg_is_null(p_payload -> 'fuelMethod') then null else p_payload ->> 'fuelMethod' end;
  if (v_transport is null) <> (v_transport_method is null) or (v_fuel is null) <> (v_fuel_method is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_method');
  end if;
  v_show_salary := coalesce((p_payload ->> 'showSalary')::boolean, false);
  v_show_meal := coalesce((p_payload ->> 'showMeal')::boolean, false);
  v_show_transport := coalesce((p_payload ->> 'showTransport')::boolean, false);
  v_show_fuel := coalesce((p_payload ->> 'showFuel')::boolean, false);
  if (v_show_salary and v_salary is null) or (v_show_meal and v_meal is null)
     or (v_show_transport and v_transport is null) or (v_show_fuel and v_fuel is null) then
    return jsonb_build_object('ok', false, 'code', 'visibility_without_component');
  end if;

  if not public.finance_json_is_date(p_payload -> 'validFrom') then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  v_from := (p_payload ->> 'validFrom')::date;
  if not public.comp_cfg_is_null(p_payload -> 'validUntil') then
    if not public.finance_json_is_date(p_payload -> 'validUntil') then
      return jsonb_build_object('ok', false, 'code', 'invalid_period');
    end if;
    v_until := (p_payload ->> 'validUntil')::date;
  end if;
  if v_until is not null and v_until < v_from then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  if v_from < public.comp_cfg_today() then
    return jsonb_build_object('ok', false, 'code', 'retroactive_forbidden');
  end if;

  v_employee_id := (p_payload ->> 'employeeId')::uuid;
  select e.status::text into v_emp_status from public.employees e where e.id = v_employee_id;
  if v_emp_status is null then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;
  if v_emp_status = 'dismissed' then
    return jsonb_build_object('ok', false, 'code', 'employee_dismissed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.compensation.employee:' || v_employee_id::text, 0));
  select * into v_current from public.employee_compensation_profiles c
  where c.employee_id = v_employee_id and c.status = 'draft' for update;
  v_prev_id := case when public.comp_cfg_is_null(p_payload -> 'previousProfileId') then null
                    else (p_payload ->> 'previousProfileId')::uuid end;
  if v_current.id is distinct from v_prev_id then
    return jsonb_build_object('ok', false, 'code', 'stale_version');
  end if;
  select * into v_latest from public.employee_compensation_profiles c
  where c.employee_id = v_employee_id order by c.version desc limit 1;
  v_version := coalesce(v_latest.version, 0) + 1;

  begin
    if v_current.id is not null then
      update public.employee_compensation_profiles set status = 'inactive' where id = v_current.id;
    end if;
    insert into public.employee_compensation_profiles (
      employee_id, version, previous_version_id, valid_from, valid_until,
      salary_enabled, salary_amount, meal_enabled, meal_daily_amount,
      transport_enabled, transport_amount, transport_method,
      fuel_enabled, fuel_amount, fuel_method,
      show_salary, show_meal, show_transport, show_fuel,
      status, snapshot, idempotency_key, created_by, notes, change_reason, request_hash
    )
    values (
      v_employee_id, v_version, v_latest.id, v_from, v_until,
      v_salary is not null, v_salary, v_meal is not null, v_meal,
      v_transport is not null, v_transport, v_transport_method,
      v_fuel is not null, v_fuel, v_fuel_method,
      v_show_salary, v_show_meal, v_show_transport, v_show_fuel,
      'draft',
      jsonb_build_object('version', v_version, 'components', jsonb_build_object(
        'salary', v_salary is not null, 'meal', v_meal is not null,
        'transport', v_transport is not null, 'fuel', v_fuel is not null)),
      v_key, auth.uid(), nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), btrim(p_payload ->> 'reason'), v_hash
    )
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'stale_version');
    when check_violation or not_null_violation or foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'invalid_compensation');
  end;

  -- Auditoria: somente versão/status (NUNCA valores de salário/benefício).
  perform public.finance_audit_log(
    case when v_latest.id is null then 'compensation_draft_configured' else 'compensation_draft_versioned' end,
    'employee_compensation_profile', v_id,
    case when v_current.id is null then '{}'::jsonb
         else jsonb_build_object('version', v_current.version, 'status', 'draft') end,
    case when v_current.id is null then jsonb_build_object('version', v_version, 'status', 'draft')
         else jsonb_build_object('version', v_version, 'status', 'draft', 'previous_status', 'inactive') end,
    btrim(p_payload ->> 'reason'), v_key
  );

  return jsonb_build_object('ok', true, 'idempotent', false, 'profileId', v_id, 'employeeId', v_employee_id,
    'version', v_version, 'status', 'draft');
end;
$$;

-- ============================================================
-- 8. Escrita: desativar (arquivar) rascunho de remuneração — nunca apaga
-- ============================================================
create or replace function public.admin_archive_employee_compensation_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_profile_id uuid;
  v_reason text;
  v_event public.finance_audit_events;
  v_prof public.employee_compensation_profiles;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'profileId', 'reason']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  if jsonb_typeof(p_payload -> 'idempotencyKey') is distinct from 'string'
     or (p_payload ->> 'idempotencyKey') !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'profileId') then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;
  if not public.comp_cfg_text_ok(p_payload -> 'reason', 3, 500) then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  v_profile_id := (p_payload ->> 'profileId')::uuid;
  v_reason := btrim(p_payload ->> 'reason');

  perform pg_advisory_xact_lock(hashtextextended('igt.compensation.idem:' || v_key, 0));
  select * into v_event from public.finance_audit_events a where a.idempotency_key = v_key;
  if found then
    if v_event.action = 'compensation_draft_archived' and v_event.entity_id = v_profile_id
       and v_event.reason is not distinct from v_reason then
      return jsonb_build_object('ok', true, 'idempotent', true, 'profileId', v_profile_id, 'status', 'archived');
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if exists (select 1 from public.employee_commission_rules r where r.idempotency_key = v_key)
     or exists (select 1 from public.employee_compensation_profiles c where c.idempotency_key = v_key) then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  select * into v_prof from public.employee_compensation_profiles c where c.id = v_profile_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.compensation.employee:' || v_prof.employee_id::text, 0));
  select * into v_prof from public.employee_compensation_profiles c where c.id = v_profile_id for update;
  if v_prof.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'stale_version');
  end if;

  update public.employee_compensation_profiles set status = 'inactive' where id = v_prof.id;
  insert into public.finance_audit_events (
    actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, reason, operation_id, idempotency_key
  ) values (
    auth.uid(), v_role, 'compensation_draft_archived', 'employee_compensation_profile', v_prof.id,
    jsonb_build_object('status', 'draft', 'version', v_prof.version),
    jsonb_build_object('status', 'inactive', 'previous_status', 'draft', 'version', v_prof.version),
    v_reason, v_key, v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'profileId', v_prof.id, 'status', 'archived');
end;
$$;

-- ============================================================
-- 9. Leitura admin (Admin Master / Admin Financeiro). admin_consulta => forbidden.
-- ============================================================
create or replace function public.admin_list_commission_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  if public.finance_admin_actor_role() is null then
    raise exception 'compensation_config_forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'familyId', r.rule_family_id,
      'version', r.version,
      'previousVersionId', r.previous_version_id,
      'name', r.rule_name,
      'attributionRole', r.attribution_role,
      'method', r.method,
      'triggerKind', r.trigger_kind,
      'fixedAmount', r.fixed_amount::text,
      'percentageRate', r.percentage_rate::text,
      'percentageBase', r.percentage_base,
      'effectiveFrom', r.effective_from,
      'effectiveUntil', r.effective_until,
      'description', r.description,
      'status', public.comp_cfg_status_label(r.status, false),
      'active', r.active,
      'retroactive', r.retroactive,
      'incomplete', r.method = 'percentage' and r.percentage_base is null,
      'activatable', false,
      'reason', r.change_reason,
      'createdBy', coalesce(nullif(btrim(pc.full_name), ''), 'Administrador'),
      'createdAt', r.created_at,
      'archivedBy', case when arch.created_at is not null then coalesce(nullif(btrim(pa.full_name), ''), 'Administrador') end,
      'archivedAt', arch.created_at,
      'archiveReason', arch.reason
    ) order by r.attribution_role, r.rule_family_id, r.version desc), '[]'::jsonb)
    into v_items
  from (select * from public.employee_commission_rules order by created_at desc limit 500) r
  left join public.profiles pc on pc.id = r.created_by
  left join lateral (
    select a.actor_id, a.created_at, a.reason from public.finance_audit_events a
    where a.entity_type = 'employee_commission_rule' and a.entity_id = r.id
      and a.action = 'commission_rule_draft_archived'
    order by a.created_at desc limit 1
  ) arch on true
  left join public.profiles pa on pa.id = arch.actor_id;

  return jsonb_build_object(
    'rules', v_items,
    'activeRuleCount', (select count(*) from public.employee_commission_rules where active or status = 'active')
  );
end;
$$;

create or replace function public.admin_list_compensation_employees()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  if public.finance_admin_actor_role() is null then
    raise exception 'compensation_config_forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'employeeId', e.id,
      'name', coalesce(nullif(btrim(p.full_name), ''), 'Funcionário'),
      'status', e.status::text,
      'sectors', coalesce(sec.items, '[]'::jsonb),
      'currentProfile', case when cur.id is null then null else jsonb_build_object(
        'profileId', cur.id,
        'version', cur.version,
        'validFrom', cur.valid_from,
        'validUntil', cur.valid_until,
        'components', jsonb_build_object('salary', cur.salary_enabled, 'meal', cur.meal_enabled,
                                         'transport', cur.transport_enabled, 'fuel', cur.fuel_enabled),
        'visible', jsonb_build_object('salary', cur.show_salary, 'meal', cur.show_meal,
                                      'transport', cur.show_transport, 'fuel', cur.show_fuel)
      ) end,
      'versionCount', coalesce(cnt.n, 0)
    ) order by lower(coalesce(p.full_name, '')), e.id), '[]'::jsonb)
    into v_items
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.name) items
    from public.employee_sector_memberships m
    join public.sectors s on s.id = m.sector_id
    where m.employee_id = e.id and m.is_active
  ) sec on true
  left join lateral (
    select * from public.employee_compensation_profiles c
    where c.employee_id = e.id and c.status = 'draft' limit 1
  ) cur on true
  left join lateral (
    select count(*) n from public.employee_compensation_profiles c where c.employee_id = e.id
  ) cnt on true;

  return jsonb_build_object('employees', v_items);
end;
$$;

create or replace function public.admin_get_employee_compensation(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_header jsonb;
  v_versions jsonb;
begin
  if public.finance_admin_actor_role() is null then
    raise exception 'compensation_config_forbidden' using errcode = '42501';
  end if;
  if p_employee_id is null then
    raise exception 'compensation_config_not_found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
      'employeeId', e.id,
      'name', coalesce(nullif(btrim(p.full_name), ''), 'Funcionário'),
      'status', e.status::text,
      'sectors', coalesce((
        select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.name)
        from public.employee_sector_memberships m join public.sectors s on s.id = m.sector_id
        where m.employee_id = e.id and m.is_active), '[]'::jsonb))
    into v_header
  from public.employees e join public.profiles p on p.id = e.profile_id
  where e.id = p_employee_id;
  if v_header is null then
    raise exception 'compensation_config_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'profileId', c.id,
      'version', c.version,
      'previousVersionId', c.previous_version_id,
      'status', public.comp_cfg_status_label(c.status,
                  exists (select 1 from public.employee_compensation_profiles n where n.previous_version_id = c.id)),
      'validFrom', c.valid_from,
      'validUntil', c.valid_until,
      'salaryAmount', c.salary_amount::text,
      'mealDailyAmount', c.meal_daily_amount::text,
      'transportAmount', c.transport_amount::text,
      'transportMethod', c.transport_method,
      'fuelAmount', c.fuel_amount::text,
      'fuelMethod', c.fuel_method,
      'showSalary', c.show_salary,
      'showMeal', c.show_meal,
      'showTransport', c.show_transport,
      'showFuel', c.show_fuel,
      'notes', c.notes,
      'reason', c.change_reason,
      'createdBy', coalesce(nullif(btrim(pc.full_name), ''), 'Administrador'),
      'createdAt', c.created_at,
      'archivedBy', case when arch.created_at is not null then coalesce(nullif(btrim(pa.full_name), ''), 'Administrador') end,
      'archivedAt', arch.created_at,
      'archiveReason', arch.reason
    ) order by c.version desc), '[]'::jsonb)
    into v_versions
  from public.employee_compensation_profiles c
  left join public.profiles pc on pc.id = c.created_by
  left join lateral (
    select a.actor_id, a.created_at, a.reason from public.finance_audit_events a
    where a.entity_type = 'employee_compensation_profile' and a.entity_id = c.id
      and a.action = 'compensation_draft_archived'
    order by a.created_at desc limit 1
  ) arch on true
  left join public.profiles pa on pa.id = arch.actor_id
  where c.employee_id = p_employee_id;

  return jsonb_build_object('employee', v_header, 'versions', v_versions);
end;
$$;

-- ============================================================
-- 10. Leitura do funcionário: prévia do próprio rascunho vigente
-- ============================================================
-- Somente componentes configurados E visíveis (oculto/ausente é OMITIDO, nunca zero).
-- Comissão sempre "not_calculated". Total estimado = soma dos componentes visíveis de valor
-- mensal (salário; transporte/combustível "monthly_fixed"); componentes por dia trabalhado
-- dependem dos dias trabalhados (Entrega C) e NÃO entram no total. Não é folha fechada.
create or replace function public.employee_compensation_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_today date := public.comp_cfg_today();
  v_prof public.employee_compensation_profiles;
  v_components jsonb := '{}'::jsonb;
  v_total numeric(12,2) := 0;
  v_has_monthly boolean := false;
  v_has_per_day boolean := false;
  v_eligible boolean;
begin
  select * into v_self from public.employee_portal_self();

  select exists (
    select 1 from public.employee_sector_memberships m join public.sectors s on s.id = m.sector_id
    where m.employee_id = v_self.employee_id and m.is_active and s.is_active
      and s.code in ('technician', 'external_sales')
  ) into v_eligible;

  select * into v_prof from public.employee_compensation_profiles c
  where c.employee_id = v_self.employee_id and c.status = 'draft'
    and c.valid_from <= v_today and (c.valid_until is null or c.valid_until >= v_today)
  order by c.version desc limit 1;

  if v_prof.id is not null then
    if v_prof.salary_enabled and v_prof.show_salary then
      v_components := v_components || jsonb_build_object('salary', jsonb_build_object('amount', v_prof.salary_amount::text));
      v_total := v_total + v_prof.salary_amount; v_has_monthly := true;
    end if;
    if v_prof.meal_enabled and v_prof.show_meal then
      v_components := v_components || jsonb_build_object('meal', jsonb_build_object('dailyAmount', v_prof.meal_daily_amount::text));
      v_has_per_day := true;
    end if;
    if v_prof.transport_enabled and v_prof.show_transport then
      v_components := v_components || jsonb_build_object('transport',
        jsonb_build_object('amount', v_prof.transport_amount::text, 'method', v_prof.transport_method));
      if v_prof.transport_method = 'monthly_fixed' then
        v_total := v_total + v_prof.transport_amount; v_has_monthly := true;
      else
        v_has_per_day := true;
      end if;
    end if;
    if v_prof.fuel_enabled and v_prof.show_fuel then
      v_components := v_components || jsonb_build_object('fuel',
        jsonb_build_object('amount', v_prof.fuel_amount::text, 'method', v_prof.fuel_method));
      if v_prof.fuel_method = 'monthly_fixed' then
        v_total := v_total + v_prof.fuel_amount; v_has_monthly := true;
      else
        v_has_per_day := true;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'employeeStatus', v_self.employee_status,
    'readOnly', v_self.employee_status <> 'active',
    'competenceMonth', to_char(date_trunc('month', v_today), 'YYYY-MM-DD'),
    'configured', v_prof.id is not null,
    'components', v_components,
    'commission', case when v_eligible then jsonb_build_object('status', 'not_calculated') else null end,
    'estimatedTotal', case when v_has_monthly then v_total::text else null end,
    'perDayComponentsExcluded', v_has_per_day,
    'closedPayroll', false
  );
end;
$$;

-- ============================================================
-- 11. Grants mínimos
-- ============================================================
revoke all on function public.admin_save_commission_rule_draft(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_archive_commission_rule_draft(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_save_employee_compensation_draft(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_archive_employee_compensation_draft(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_commission_rules() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_compensation_employees() from public, anon, authenticated, service_role;
revoke all on function public.admin_get_employee_compensation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.employee_compensation_preview() from public, anon, authenticated, service_role;

grant execute on function public.admin_save_commission_rule_draft(jsonb) to authenticated;
grant execute on function public.admin_archive_commission_rule_draft(jsonb) to authenticated;
grant execute on function public.admin_save_employee_compensation_draft(jsonb) to authenticated;
grant execute on function public.admin_archive_employee_compensation_draft(jsonb) to authenticated;
grant execute on function public.admin_list_commission_rules() to authenticated;
grant execute on function public.admin_list_compensation_employees() to authenticated;
grant execute on function public.admin_get_employee_compensation(uuid) to authenticated;
grant execute on function public.employee_compensation_preview() to authenticated;

-- RPCs posicionais I1 (sem motivo/sem detecção de conflito/sem controle de sobreposição) e
-- de dias trabalhados/competência/ajuste: sem EXECUTE para clientes nesta entrega (sem DROP).
revoke all on function public.create_commission_rule_draft(text, uuid, text, text, text, numeric, numeric, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.version_commission_rule_draft(text, uuid, text, text, numeric, numeric, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.configure_employee_compensation_draft(text, uuid, date, date, numeric, numeric, numeric, text, numeric, text, boolean, boolean, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.record_employee_worked_day(text, uuid, date, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.open_payroll_competence_draft(text, uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.add_manual_payroll_adjustment(text, uuid, text, numeric, text, text) from public, anon, authenticated, service_role;

comment on function public.admin_save_commission_rule_draft(jsonb) is '3.1F-J4: cria rascunho/nova versão de regra (sempre inativa, sem retroatividade). Contrato JSON fechado.';
comment on function public.admin_archive_commission_rule_draft(jsonb) is '3.1F-J4: arquiva rascunho não utilizado (draft -> inactive). Nunca apaga.';
comment on function public.admin_save_employee_compensation_draft(jsonb) is '3.1F-J4: nova versão de remuneração individual (sempre draft). Sem defaults.';
comment on function public.admin_archive_employee_compensation_draft(jsonb) is '3.1F-J4: desativa rascunho de remuneração (draft -> inactive). Nunca apaga.';
comment on function public.admin_list_commission_rules() is '3.1F-J4: leitura admin (master/financeiro) das versões de regra.';
comment on function public.admin_list_compensation_employees() is '3.1F-J4: leitura admin (master/financeiro) de funcionários e rascunho vigente.';
comment on function public.admin_get_employee_compensation(uuid) is '3.1F-J4: histórico de versões de remuneração de um funcionário (admin master/financeiro).';
comment on function public.employee_compensation_preview() is '3.1F-J4: prévia do próprio rascunho vigente; somente componentes configurados e visíveis.';

-- ============================================================
-- 12. Verificação em transação
-- ============================================================
do $$
declare
  v_fn text;
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_foundation_inactive_chk')
     or not exists (select 1 from pg_constraint where conname = 'employee_compensation_profiles_foundation_inactive_chk')
     or not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_no_retroactive_chk') then
    raise exception 'j4_verify_foundation_gate_missing';
  end if;
  foreach v_fn in array array[
    'public.create_commission_rule_draft(text,uuid,text,text,text,numeric,numeric,text,date,date)',
    'public.version_commission_rule_draft(text,uuid,text,text,numeric,numeric,text,date,date)',
    'public.configure_employee_compensation_draft(text,uuid,date,date,numeric,numeric,numeric,text,numeric,text,boolean,boolean,boolean,boolean)',
    'public.record_employee_worked_day(text,uuid,date,text,boolean)',
    'public.open_payroll_competence_draft(text,uuid,date)',
    'public.add_manual_payroll_adjustment(text,uuid,text,numeric,text,text)'
  ] loop
    if has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'j4_verify_legacy_rpc_still_executable %', v_fn;
    end if;
  end loop;
  foreach v_fn in array array[
    'public.admin_save_commission_rule_draft(jsonb)', 'public.admin_archive_commission_rule_draft(jsonb)',
    'public.admin_save_employee_compensation_draft(jsonb)', 'public.admin_archive_employee_compensation_draft(jsonb)',
    'public.admin_list_commission_rules()', 'public.admin_list_compensation_employees()',
    'public.admin_get_employee_compensation(uuid)', 'public.employee_compensation_preview()'
  ] loop
    if not has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'j4_verify_grant_mismatch %', v_fn;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c
    where c.oid in ('public.employee_commission_rules'::regclass, 'public.employee_compensation_profiles'::regclass,
                    'public.finance_audit_events'::regclass, 'public.employee_commission_entitlements'::regclass,
                    'public.payroll_competences'::regclass, 'public.payroll_competence_lines'::regclass,
                    'public.employee_worked_days'::regclass)
      and (not c.relrowsecurity
           or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')
           or has_table_privilege('anon', c.oid, 'select,insert,update,delete'))
  ) then
    raise exception 'j4_verify_rls_or_table_grant_mismatch';
  end if;
  if exists (select 1 from public.employee_commission_rules where active or status = 'active')
     or exists (select 1 from public.employee_compensation_profiles where status = 'active') then
    raise exception 'j4_verify_active_configuration_found';
  end if;
end$$;

commit;
