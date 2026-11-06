-- Sprint 3.1F-H1 — Employee origin + rewards hardening (Fase 2A)
--
-- LOCAL ONLY nesta sprint. NÃO aplicar em produção sem release controlado.
-- Idempotente (reaplicável): IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE.
-- Não altera valores/estados de rewards, wallets ou withdrawals existentes.
-- Não reclassifica referrals existentes: linhas preexistentes recebem
-- origin_kind='legacy' e continuam regidas pelas regras financeiras atuais.
--
-- Conteúdo:
--  1. referrals.origin_kind + CHECK + invariantes employee
--  2. trigger de origem (deriva origem nova, bloqueia crossover employee)
--  3. sales_opportunity_attributions (fundação, sem comissão)
--  4. financial_security_audit_events (auditoria sanitizada mínima)
--  5. referral_is_financially_eligible endurecido (origin_kind)
--  6. ensure_referral_reward (RPC que substitui INSERT direto do browser)
--  7. create_employee_sales_opportunity (RPC exclusiva funcionário)
--  8. rewards: drop policies de mutação direta, REVOKE DML/TRUNCATE/REFERENCES/TRIGGER
--  9. grants das RPCs financeiras

begin;

-- ============================================================
-- 1. origin_kind
-- ============================================================
alter table public.referrals
  add column if not exists origin_kind text;

-- Linhas existentes: legacy (sem inferência; sem backfill especulativo).
update public.referrals set origin_kind = 'legacy' where origin_kind is null;

alter table public.referrals alter column origin_kind set default null;

alter table public.referrals
  drop constraint if exists referrals_origin_kind_chk;
alter table public.referrals
  add constraint referrals_origin_kind_chk
  check (
    origin_kind is not null
    and origin_kind in (
      'indicator',
      'assisted_indicator',
      'web_preregistration',
      'neutral_network',
      'employee',
      'legacy'
    )
  ) not valid;
alter table public.referrals validate constraint referrals_origin_kind_chk;

alter table public.referrals
  drop constraint if exists referrals_employee_origin_no_reward_chk;
alter table public.referrals
  add constraint referrals_employee_origin_no_reward_chk
  check (
    origin_kind is distinct from 'employee'
    or (
      indicator_profile_id is null
      and reward_eligible = false
    )
  );

alter table public.referrals
  add column if not exists employee_opportunity_idempotency_key text;

create unique index if not exists referrals_employee_opportunity_idem_uidx
  on public.referrals (employee_opportunity_idempotency_key)
  where employee_opportunity_idempotency_key is not null;

create index if not exists referrals_origin_kind_idx
  on public.referrals (origin_kind);

comment on column public.referrals.origin_kind is
  'Origem estrutural (3.1F-H1). employee => sem indicador e sem reward. legacy => linhas anteriores ao discriminador (regras financeiras atuais).';

-- ============================================================
-- 2. Trigger de origem
-- ============================================================
create or replace function public.trg_referrals_enforce_origin_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_indicator_role public.user_role;
  v_rpc text := coalesce(current_setting('igt.employee_opportunity_rpc', true), '');
begin
  if TG_OP = 'UPDATE' then
    if NEW.origin_kind is distinct from OLD.origin_kind then
      raise exception 'origin_kind_immutable'
        using errcode = 'P0001';
    end if;
    if OLD.origin_kind = 'employee' then
      NEW.indicator_profile_id := null;
      NEW.reward_eligible := false;
    end if;
    return NEW;
  end if;

  -- INSERT: derivação apenas para linhas novas, a partir de campos já gravados.
  if NEW.origin_kind is null then
    NEW.origin_kind := case
      when NEW.source = 'public_pre_registration' then 'web_preregistration'
      when NEW.source = 'neutral_network_pre_registration' then 'neutral_network'
      when NEW.source = 'commercial_assisted_referral' then 'assisted_indicator'
      when NEW.source = 'employee_sales_opportunity' then 'employee'
      else 'indicator'
    end;
  end if;

  if NEW.origin_kind = 'legacy' then
    raise exception 'origin_kind_legacy_reserved'
      using errcode = 'P0001';
  end if;

  if NEW.origin_kind = 'employee' then
    if v_rpc <> 'on' then
      raise exception 'employee_opportunity_requires_rpc'
        using errcode = '42501';
    end if;
    if NEW.indicator_profile_id is not null or NEW.reward_eligible is distinct from false then
      raise exception 'employee_origin_cannot_be_reward_eligible'
        using errcode = 'P0001';
    end if;
    return NEW;
  end if;

  if NEW.origin_kind in ('web_preregistration', 'neutral_network') then
    NEW.reward_eligible := false;
    return NEW;
  end if;

  -- indicator / assisted_indicator
  if NEW.indicator_profile_id is null then
    NEW.reward_eligible := false;
    return NEW;
  end if;

  select p.role into v_indicator_role
  from public.profiles p
  where p.id = NEW.indicator_profile_id;

  if v_indicator_role = 'funcionario' then
    -- Crossover: funcionário não pode virar indicador financeiro.
    raise exception 'employee_must_use_employee_opportunity_rpc'
      using errcode = '42501';
  end if;

  if v_indicator_role is distinct from 'indicador' then
    -- Fail-closed: beneficiário que não é indicador não gera direito financeiro.
    NEW.reward_eligible := false;
  end if;

  return NEW;
end;
$$;

revoke all on function public.trg_referrals_enforce_origin_kind() from public, anon, authenticated;

drop trigger if exists trg_referrals_enforce_origin_kind on public.referrals;
create trigger trg_referrals_enforce_origin_kind
before insert or update on public.referrals
for each row
execute function public.trg_referrals_enforce_origin_kind();

-- ============================================================
-- 3. sales_opportunity_attributions
-- ============================================================
create table if not exists public.sales_opportunity_attributions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.referrals(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  attribution_role text not null,
  sector_id uuid references public.sectors(id) on delete restrict,
  membership_id uuid references public.employee_sector_memberships(id) on delete restrict,
  attributed_at timestamptz not null default timezone('utc', now()),
  attributed_by uuid references public.profiles(id) on delete set null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sales_opportunity_attributions_role_chk check (
    attribution_role in (
      'technician_originator',
      'external_sales_originator',
      'internal_sales_responsible'
    )
  ),
  constraint sales_opportunity_attributions_source_chk check (
    source in ('employee_opportunity_rpc')
  ),
  constraint sales_opportunity_attributions_metadata_obj_chk check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint sales_opportunity_attributions_metadata_safe_chk check (
    not (metadata ?| array[
      'salary','salario','commission','comissao','commission_amount','amount','valor',
      'token','access_token','cookie','password','erp_payload','payload',
      'cpf','cnpj','document','phone','telefone','name','nome','email'
    ])
  ),
  constraint sales_opportunity_attributions_role_uq unique (opportunity_id, attribution_role)
);

comment on table public.sales_opportunity_attributions is
  'Atribuição de funcionário a oportunidade (3.1F-H1). Fundação: NÃO cria reward nem comissão.';

drop trigger if exists trg_sales_opportunity_attributions_set_updated_at on public.sales_opportunity_attributions;
create trigger trg_sales_opportunity_attributions_set_updated_at
before update on public.sales_opportunity_attributions
for each row execute function public.set_updated_at();

create or replace function public.trg_sales_opportunity_attributions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_origin text;
begin
  select e.status::text into v_status from public.employees e where e.id = NEW.employee_id;
  if v_status is distinct from 'active' then
    raise exception 'attribution_employee_not_active' using errcode = 'P0001';
  end if;
  select r.origin_kind into v_origin from public.referrals r where r.id = NEW.opportunity_id;
  if v_origin is distinct from 'employee' then
    raise exception 'attribution_requires_employee_origin' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

revoke all on function public.trg_sales_opportunity_attributions_guard() from public, anon, authenticated;

drop trigger if exists trg_sales_opportunity_attributions_guard on public.sales_opportunity_attributions;
create trigger trg_sales_opportunity_attributions_guard
before insert or update of employee_id, opportunity_id on public.sales_opportunity_attributions
for each row execute function public.trg_sales_opportunity_attributions_guard();

alter table public.sales_opportunity_attributions enable row level security;

revoke all on table public.sales_opportunity_attributions from public, anon, authenticated;
grant select on table public.sales_opportunity_attributions to authenticated;
revoke all on table public.sales_opportunity_attributions from service_role;
grant select on table public.sales_opportunity_attributions to service_role;

drop policy if exists sales_opportunity_attributions_select_policy on public.sales_opportunity_attributions;
create policy sales_opportunity_attributions_select_policy
on public.sales_opportunity_attributions
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1 from public.employees e
    where e.id = sales_opportunity_attributions.employee_id
      and e.profile_id = auth.uid()
  )
);

-- ============================================================
-- 4. Auditoria financeira sanitizada
-- ============================================================
create table if not exists public.financial_security_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  referral_id uuid,
  actor_profile_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint financial_security_audit_events_type_chk check (
    event_type in (
      'employee_opportunity_created',
      'attribution_created',
      'reward_creation_blocked',
      'reward_rpc_executed'
    )
  ),
  constraint financial_security_audit_events_metadata_safe_chk check (
    jsonb_typeof(metadata) = 'object'
    and not (metadata ?| array[
      'salary','salario','commission','comissao','commission_amount','amount','valor',
      'token','access_token','cookie','password','erp_payload','payload',
      'cpf','cnpj','document','phone','telefone','name','nome','email'
    ])
  )
);

create index if not exists financial_security_audit_events_created_idx
  on public.financial_security_audit_events (created_at desc);

alter table public.financial_security_audit_events enable row level security;
revoke all on table public.financial_security_audit_events from public, anon, authenticated;
revoke all on table public.financial_security_audit_events from service_role;
grant select on table public.financial_security_audit_events to service_role;

create or replace function public.trg_financial_security_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'financial_security_audit_events_append_only' using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_financial_security_audit_append_only on public.financial_security_audit_events;
create trigger trg_financial_security_audit_append_only
before update or delete on public.financial_security_audit_events
for each row execute function public.trg_financial_security_audit_append_only();

create or replace function public.log_financial_security_event(
  p_event_type text,
  p_referral_id uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.financial_security_audit_events (event_type, referral_id, actor_profile_id, reason, metadata)
  values (p_event_type, p_referral_id, auth.uid(), p_reason, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on function public.log_financial_security_event(text, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ============================================================
-- 5. Elegibilidade financeira endurecida
-- ============================================================
create or replace function public.referral_is_financially_eligible(p_ref public.referrals)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    p_ref.reward_eligible is true
    and coalesce(p_ref.origin_kind, 'legacy') in ('indicator', 'assisted_indicator', 'legacy')
    and coalesce(p_ref.source, '') not in (
      'public_pre_registration',
      'neutral_network_pre_registration',
      'employee_sales_opportunity'
    )
    and coalesce(p_ref.erp_lead_source, '') not in (
      'Pré-cadastro Web',
      'Pré-cadastro Rede Neutra'
    )
    and p_ref.indicator_profile_id is not null;
$$;

comment on function public.referral_is_financially_eligible(public.referrals) is
  'Elegibilidade financeira: reward_eligible=true, origin_kind indicador/legacy, source, erp_lead_source e indicador. 3.1F-H1.';

revoke all on function public.referral_is_financially_eligible(public.referrals) from public, anon, authenticated;
grant execute on function public.referral_is_financially_eligible(public.referrals) to service_role;

-- trigger de rewards: mesma função, agora com origin_kind (corpo 1.2R-D preservado)
create or replace function public.trg_rewards_enforce_financial_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
begin
  if NEW.referral_id is null then
    raise exception 'not_reward_eligible: referral_id ausente' using errcode = 'P0001';
  end if;

  select * into v_ref from public.referrals where id = NEW.referral_id for share;

  if not found then
    raise exception 'not_reward_eligible: indicação não encontrada' using errcode = 'P0001';
  end if;

  if v_ref.origin_kind = 'employee' then
    raise exception 'not_reward_eligible: origem funcionário nunca gera reward' using errcode = 'P0001';
  end if;

  if not public.referral_is_financially_eligible(v_ref) then
    raise exception 'not_reward_eligible: referral inelegível para recompensa' using errcode = 'P0001';
  end if;

  NEW.indicator_profile_id := v_ref.indicator_profile_id;
  return NEW;
end;
$$;

revoke all on function public.trg_rewards_enforce_financial_eligibility() from public, anon, authenticated;

drop trigger if exists trg_rewards_enforce_financial_eligibility on public.rewards;
create trigger trg_rewards_enforce_financial_eligibility
before insert or update of referral_id, indicator_profile_id
on public.rewards
for each row
execute function public.trg_rewards_enforce_financial_eligibility();

-- ============================================================
-- 6. ensure_referral_reward — substitui INSERT direto do browser
--    (ensureRewardForReferralFromSupabase). Mesma autorização da
--    antiga rewards_insert_policy: admin write ou comercial atribuído.
--    Mesma semântica: idempotente por referral_id, status pendente,
--    valor = referrals.reward_amount (null => 0, como o app fazia).
-- ============================================================
create or replace function public.ensure_referral_reward(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_ref public.referrals%rowtype;
  v_reward_id uuid;
  v_amount numeric(10,2);
begin
  select p.role into v_role from public.profiles p where p.id = v_uid and coalesce(p.is_active, true);

  if v_role is null or v_role not in ('admin_master', 'admin_financeiro', 'comercial') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into v_ref from public.referrals where id = p_referral_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'referral_not_found');
  end if;

  if v_role = 'comercial' and v_ref.commercial_profile_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_ref.origin_kind = 'employee' or not public.referral_is_financially_eligible(v_ref) then
    perform public.log_financial_security_event(
      'reward_creation_blocked', p_referral_id,
      case when v_ref.origin_kind = 'employee' then 'employee_origin' else 'not_reward_eligible' end,
      jsonb_build_object('origin_kind', v_ref.origin_kind, 'rpc', 'ensure_referral_reward')
    );
    return jsonb_build_object('ok', false, 'code', 'not_reward_eligible');
  end if;

  select r.id into v_reward_id from public.rewards r where r.referral_id = p_referral_id
  order by r.created_at asc limit 1;
  if v_reward_id is not null then
    return jsonb_build_object('ok', true, 'created', false, 'reward_id', v_reward_id);
  end if;

  v_amount := coalesce(v_ref.reward_amount, 0);
  if v_amount < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;

  insert into public.rewards (referral_id, indicator_profile_id, amount, reward_type, status, available_at, paid_at)
  values (
    p_referral_id,
    v_ref.indicator_profile_id,
    v_amount,
    case when v_ref.reward_type = 'desconto_fatura' then 'desconto_fatura'::public.reward_type else 'pix'::public.reward_type end,
    'pendente'::public.reward_status,
    null,
    null
  )
  on conflict (referral_id) do nothing
  returning id into v_reward_id;

  if v_reward_id is null then
    select r.id into v_reward_id from public.rewards r where r.referral_id = p_referral_id;
    return jsonb_build_object('ok', true, 'created', false, 'reward_id', v_reward_id);
  end if;

  perform public.log_financial_security_event(
    'reward_rpc_executed', p_referral_id, 'reward_created_pending',
    jsonb_build_object('rpc', 'ensure_referral_reward', 'origin_kind', v_ref.origin_kind)
  );

  return jsonb_build_object('ok', true, 'created', true, 'reward_id', v_reward_id);
end;
$$;

revoke all on function public.ensure_referral_reward(uuid) from public, anon;
grant execute on function public.ensure_referral_reward(uuid) to authenticated;

-- ============================================================
-- 7. create_employee_sales_opportunity — RPC exclusiva
-- ============================================================
create or replace function public.create_employee_sales_opportunity(
  p_idempotency_key text,
  p_attribution_role text,
  p_sector_id uuid,
  p_plan_id uuid,
  p_referred_name text,
  p_referred_phone text,
  p_referred_email text default null,
  p_referred_observation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_active boolean;
  v_employee_id uuid;
  v_membership_id uuid;
  v_referral_id uuid;
  v_existing uuid;
  v_attr_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;

  if p_attribution_role is null or p_attribution_role not in (
    'technician_originator', 'external_sales_originator', 'internal_sales_responsible'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_attribution_role');
  end if;

  if coalesce(btrim(p_referred_name), '') = '' or coalesce(btrim(p_referred_phone), '') = '' or p_plan_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;

  select p.role, coalesce(p.is_active, true) into v_role, v_active
  from public.profiles p where p.id = v_uid;

  if v_role is distinct from 'funcionario' or v_active is not true then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select e.id into v_employee_id from public.employees e
  where e.profile_id = v_uid and e.status = 'active';
  if v_employee_id is null then
    return jsonb_build_object('ok', false, 'code', 'employee_not_active');
  end if;

  select m.id into v_membership_id from public.employee_sector_memberships m
  where m.employee_id = v_employee_id and m.sector_id = p_sector_id and m.is_active = true
  limit 1;
  if v_membership_id is null then
    return jsonb_build_object('ok', false, 'code', 'membership_not_active');
  end if;

  -- Idempotência
  select r.id into v_existing from public.referrals r
  where r.employee_opportunity_idempotency_key = p_idempotency_key;
  if v_existing is not null then
    if not exists (
      select 1 from public.sales_opportunity_attributions a
      where a.opportunity_id = v_existing and a.employee_id = v_employee_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'opportunity_id', v_existing);
  end if;

  perform set_config('igt.employee_opportunity_rpc', 'on', true);

  insert into public.referrals (
    indicator_profile_id, referred_name, referred_phone, referred_email,
    referred_observation, plan_id, reward_type, reward_amount, reward_eligible,
    source, erp_lead_source, origin_kind, created_by_profile_id,
    employee_opportunity_idempotency_key, status
  )
  values (
    null, btrim(p_referred_name), btrim(p_referred_phone), nullif(btrim(coalesce(p_referred_email, '')), ''),
    nullif(btrim(coalesce(p_referred_observation, '')), ''), p_plan_id, null, null, false,
    'employee_sales_opportunity', 'Oportunidade Funcionário', 'employee', v_uid,
    p_idempotency_key, 'pendente'
  )
  returning id into v_referral_id;

  perform set_config('igt.employee_opportunity_rpc', '', true);

  insert into public.sales_opportunity_attributions (
    opportunity_id, employee_id, attribution_role, sector_id, membership_id,
    attributed_by, source, metadata
  )
  values (
    v_referral_id, v_employee_id, p_attribution_role, p_sector_id, v_membership_id,
    v_uid, 'employee_opportunity_rpc', jsonb_build_object('rpc', 'create_employee_sales_opportunity')
  )
  returning id into v_attr_id;

  perform public.log_financial_security_event(
    'employee_opportunity_created', v_referral_id, 'employee_origin',
    jsonb_build_object('origin_kind', 'employee', 'reward_eligible', false)
  );
  perform public.log_financial_security_event(
    'attribution_created', v_referral_id, p_attribution_role,
    jsonb_build_object('attribution_role', p_attribution_role)
  );

  return jsonb_build_object('ok', true, 'idempotent', false, 'opportunity_id', v_referral_id);
end;
$$;

revoke all on function public.create_employee_sales_opportunity(text, text, uuid, uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.create_employee_sales_opportunity(text, text, uuid, uuid, text, text, text, text) to authenticated;

-- ============================================================
-- 8. rewards: sem mutação direta por anon/authenticated
-- ============================================================
drop policy if exists dev_insert_rewards on public.rewards;
drop policy if exists commercial_insert_rewards on public.rewards;
drop policy if exists rewards_insert_policy on public.rewards;
drop policy if exists rewards_update_policy on public.rewards;
drop policy if exists rewards_delete_policy on public.rewards;
-- Sem policies de INSERT/UPDATE/DELETE para authenticated: RLS nega por padrão.
-- Mutação somente via RPC SECURITY DEFINER (ensure_referral_reward,
-- mark_first_invoice_paid, mark_first_invoice_paid_from_sync, saque Pix).

alter table public.rewards enable row level security;

revoke insert, update, delete, truncate, references, trigger on table public.rewards from public;
revoke insert, update, delete, truncate, references, trigger on table public.rewards from anon;
revoke insert, update, delete, truncate, references, trigger on table public.rewards from authenticated;
revoke select on table public.rewards from anon;
-- SELECT de authenticated preservado (rewards_select_policy: próprio indicador ou admin read).
grant select on table public.rewards to authenticated;
-- service_role: check-first-invoice (insert pendente) e reset-referral (leitura).
revoke delete, truncate, references, trigger on table public.rewards from service_role;
grant select, insert, update on table public.rewards to service_role;

-- ============================================================
-- 9. RPCs financeiras
-- ============================================================
revoke all on function public.mark_first_invoice_paid(uuid) from public;
revoke all on function public.mark_first_invoice_paid(uuid) from anon;
-- authenticated mantido: UI admin/comercial (markFirstInvoiceAsPaidFromSupabase);
-- a função valida auth.uid + role + comercial atribuído + elegibilidade.
grant execute on function public.mark_first_invoice_paid(uuid) to authenticated;

do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_first_invoice_paid_from_sync'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end$$;

commit;
