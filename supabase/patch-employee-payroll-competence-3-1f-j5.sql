-- Sprint 3.1F-J5 — Aprovação de perfil, dias trabalhados, competência e cálculo controlado.
--
-- ADITIVA, transacional, reaplicável. Sem backfill financeiro. Sem ativar comissão.
-- Sem INSERT em rewards/wallet/referrals/Collections/entitlements. Sem estado paid.
--
-- Auditoria das RPCs I1 (EXECUTE revogado no J4 — permanece revogado):
--   create_commission_rule_draft / version_commission_rule_draft
--     → NÃO reutilizar (sem motivo, sem controle de sobreposição, não é o fluxo J4).
--   configure_employee_compensation_draft
--     → NÃO reutilizar (cria draft sem os campos J4; aprovação é outra operação).
--   record_employee_worked_day
--     → NÃO reutilizar (sem competência, sem vínculo/desligamento, sem bloqueio de futuro).
--   open_payroll_competence_draft
--     → NÃO reutilizar (sem snapshot de perfil aprovado, metadados vazios).
--   add_manual_payroll_adjustment
--     → NÃO reutilizar (motivo mínimo 3, estados draft/reviewed, sem visibilidade).
-- RPCs novas (restritas) abaixo. EXECUTE somente authenticated; PUBLIC/anon/service_role revogado.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.employee_compensation_profiles') is null
     or to_regclass('public.employee_worked_days') is null
     or to_regclass('public.payroll_competences') is null
     or to_regclass('public.payroll_competence_lines') is null
     or to_regclass('public.finance_audit_events') is null
     or to_regclass('public.employees') is null
     or to_regprocedure('public.finance_admin_actor_role()') is null
     or to_regprocedure('public.finance_jsonb_keys_allowed(jsonb,text[])') is null
     or to_regprocedure('public.finance_json_is_uuid(jsonb)') is null
     or to_regprocedure('public.finance_json_is_date(jsonb)') is null
     or to_regprocedure('public.finance_json_is_money(jsonb)') is null
     or to_regprocedure('public.payroll_competence_period_end(date)') is null
     or to_regprocedure('public.comp_cfg_today()') is null
     or to_regprocedure('public.employee_portal_self()') is null
     or not exists (select 1 from pg_constraint where conname = 'employee_compensation_profiles_foundation_inactive_chk')
     or not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_foundation_inactive_chk') then
    raise exception 'j5_prerequisite_missing: aplicar 3.1F-I1/I1B/J2/J3/J4 antes';
  end if;
  if exists (select 1 from public.employee_commission_rules where active or status = 'active')
     or exists (select 1 from public.employee_compensation_profiles where status = 'active')
     or exists (select 1 from public.employee_commission_entitlements)
     or exists (select 1 from public.payroll_competences where status = 'paid') then
    raise exception 'j5_active_financial_configuration_found';
  end if;
end$$;

-- ============================================================
-- 1. Colunas aditivas
-- ============================================================
alter table public.employee_worked_days add column if not exists absence_reason text;
alter table public.payroll_competences add column if not exists compensation_profile_id uuid references public.employee_compensation_profiles(id) on delete restrict;
alter table public.payroll_competences add column if not exists calculation_input_hash text;
alter table public.payroll_competences add column if not exists closed_reason text;
alter table public.payroll_competence_lines add column if not exists visible_to_employee boolean not null default false;
alter table public.payroll_competence_lines add column if not exists line_origin text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_worked_days_absence_reason_chk') then
    alter table public.employee_worked_days add constraint employee_worked_days_absence_reason_chk
      check (absence_reason is null or char_length(btrim(absence_reason)) between 3 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_competences_closed_reason_chk') then
    alter table public.payroll_competences add constraint payroll_competences_closed_reason_chk
      check (closed_reason is null or char_length(btrim(closed_reason)) between 20 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_competences_hash_chk') then
    alter table public.payroll_competences add constraint payroll_competences_hash_chk
      check (calculation_input_hash is null or calculation_input_hash ~ '^[0-9a-f]{32}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_competence_lines_origin_chk') then
    alter table public.payroll_competence_lines add constraint payroll_competence_lines_origin_chk
      check (line_origin is null or line_origin in ('approved_profile_snapshot', 'worked_days', 'manual_adjustment'));
  end if;
end$$;

create unique index if not exists employee_compensation_profiles_one_approved_uidx
  on public.employee_compensation_profiles (employee_id) where status = 'approved';

create unique index if not exists payroll_competence_lines_auto_type_uidx
  on public.payroll_competence_lines (competence_id, line_type)
  where line_type in ('base_salary', 'meal', 'transport', 'fuel');

-- ============================================================
-- 2. CHECKs ampliados (DROP+ADD da mesma constraint, valores adicionados)
-- ============================================================
alter table public.employee_compensation_profiles drop constraint if exists employee_compensation_profiles_status_chk;
alter table public.employee_compensation_profiles add constraint employee_compensation_profiles_status_chk
  check (status in ('draft', 'active', 'inactive', 'approved'));

alter table public.payroll_competences drop constraint if exists payroll_competences_status_chk;
alter table public.payroll_competences add constraint payroll_competences_status_chk
  check (status in ('draft', 'calculated', 'reviewed', 'under_review', 'closed', 'paid', 'reopened'));

alter table public.payroll_competences drop constraint if exists payroll_competences_foundation_no_close_pay_chk;
alter table public.payroll_competences drop constraint if exists payroll_competences_foundation_no_pay_chk;
alter table public.payroll_competences add constraint payroll_competences_foundation_no_pay_chk
  check (status is distinct from 'paid' and paid_at is null and paid_by is null);

alter table public.payroll_competence_lines drop constraint if exists payroll_competence_lines_refs_chk;
alter table public.payroll_competence_lines add constraint payroll_competence_lines_refs_chk check (
  (line_type = 'commission'
    and commission_entitlement_id is not null and compensation_profile_id is null and worked_day_id is null
    and adjustment_audit_event_id is null and reversal_of_line_id is null)
  or (line_type in ('base_salary', 'transport', 'fuel')
    and commission_entitlement_id is null and compensation_profile_id is not null and worked_day_id is null
    and adjustment_audit_event_id is null and reversal_of_line_id is null)
  or (line_type = 'meal'
    and commission_entitlement_id is null and compensation_profile_id is not null
    and adjustment_audit_event_id is null and reversal_of_line_id is null
    and (
      (worked_day_id is not null and quantity = 1)
      or (worked_day_id is null and quantity >= 1)
    ))
  or (line_type in ('adjustment', 'other_earning', 'discount')
    and commission_entitlement_id is null and compensation_profile_id is null and worked_day_id is null
    and adjustment_audit_event_id is not null and reversal_of_line_id is null)
  or (line_type = 'reversal'
    and commission_entitlement_id is null and compensation_profile_id is null and worked_day_id is null
    and adjustment_audit_event_id is null and reversal_of_line_id is not null)
);

alter table public.payroll_competence_lines drop constraint if exists payroll_competence_lines_snapshot_chk;
alter table public.payroll_competence_lines add constraint payroll_competence_lines_snapshot_chk check (
  public.finance_jsonb_keys_allowed(snapshot, array['manual', 'source', 'visible', 'profileVersion', 'workedDays'])
  and (not (snapshot ? 'manual') or jsonb_typeof(snapshot -> 'manual') = 'boolean')
  and (not (snapshot ? 'visible') or jsonb_typeof(snapshot -> 'visible') = 'boolean')
  and (not (snapshot ? 'source') or (jsonb_typeof(snapshot -> 'source') = 'string'
        and (snapshot ->> 'source') in ('approved_profile_snapshot', 'worked_days', 'manual_adjustment')))
  and (not (snapshot ? 'profileVersion') or public.finance_json_is_pos_int(snapshot -> 'profileVersion'))
  and (not (snapshot ? 'workedDays') or public.finance_json_is_pos_int(snapshot -> 'workedDays'))
);

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
  'commission_rule_draft_archived',
  'compensation_draft_versioned',
  'compensation_draft_archived',
  'segregation_override',
  'payroll_competence_calculated',
  'payroll_competence_reviewed',
  'payroll_competence_closed'
));

alter table public.finance_audit_events drop constraint if exists finance_audit_events_reason_required_chk;
alter table public.finance_audit_events add constraint finance_audit_events_reason_required_chk check (
  action not in ('approve', 'adjust', 'reverse', 'reopen', 'pay', 'payroll_adjustment_added',
                 'segregation_override', 'payroll_competence_closed')
  or char_length(btrim(coalesce(reason, ''))) >= 3
);

-- ============================================================
-- 3. Helpers (CREATE OR REPLACE; sem EXECUTE a clientes)
-- ============================================================
create or replace function public.finance_audit_snapshot_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is not null
    and jsonb_typeof(p) = 'object'
    and public.finance_jsonb_keys_allowed(p, array[
      'attribution_role', 'reward_created', 'method', 'trigger_kind', 'status', 'previous_status',
      'active', 'retroactive', 'version', 'meal_eligible', 'line_type', 'competence_status', 'amount'
    ])
    and (not (p ? 'attribution_role') or (jsonb_typeof(p -> 'attribution_role') = 'string'
         and (p ->> 'attribution_role') in ('technician_originator', 'external_sales_originator', 'internal_sales_responsible')))
    and (not (p ? 'method') or (jsonb_typeof(p -> 'method') = 'string'
         and (p ->> 'method') in ('fixed_amount', 'percentage', 'first_invoice_value')))
    and (not (p ? 'trigger_kind') or (jsonb_typeof(p -> 'trigger_kind') = 'string'
         and (p ->> 'trigger_kind') in ('first_valid_invoice_generated', 'first_valid_invoice_fully_paid')))
    and (not (p ? 'status') or (jsonb_typeof(p -> 'status') = 'string' and (p ->> 'status') in (
         'draft', 'superseded', 'inactive', 'worked', 'absent', 'vacation', 'leave', 'holiday', 'compensated',
         'calculated', 'reviewed', 'under_review', 'closed', 'reopened',
         'pending_evidence', 'accrued', 'approved', 'included_in_payroll', 'paid', 'reversed', 'rejected')))
    and (not (p ? 'previous_status') or (jsonb_typeof(p -> 'previous_status') = 'string'
         and (p ->> 'previous_status') in ('draft', 'superseded', 'inactive', 'approved', 'calculated', 'reviewed', 'under_review', 'closed')))
    and (not (p ? 'competence_status') or (jsonb_typeof(p -> 'competence_status') = 'string'
         and (p ->> 'competence_status') in ('draft', 'calculated', 'reviewed', 'under_review', 'closed', 'reopened')))
    and (not (p ? 'line_type') or (jsonb_typeof(p -> 'line_type') = 'string'
         and (p ->> 'line_type') in ('adjustment', 'discount', 'other_earning')))
    and (not (p ? 'reward_created') or jsonb_typeof(p -> 'reward_created') = 'boolean')
    and (not (p ? 'active') or jsonb_typeof(p -> 'active') = 'boolean')
    and (not (p ? 'retroactive') or jsonb_typeof(p -> 'retroactive') = 'boolean')
    and (not (p ? 'meal_eligible') or jsonb_typeof(p -> 'meal_eligible') = 'boolean')
    and (not (p ? 'version') or public.finance_json_is_pos_int(p -> 'version'))
    and (not (p ? 'amount') or public.finance_json_is_money(p -> 'amount'));
$$;

create or replace function public.comp_cfg_status_label(p_status text, p_has_successor boolean)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_status = 'draft' then 'draft'
    when p_status = 'approved' then 'approved'
    when p_status = 'superseded' then 'superseded'
    when p_status = 'inactive' and p_has_successor then 'superseded'
    when p_status = 'inactive' then 'archived'
    else 'unknown'
  end;
$$;

create or replace function public.trg_employee_compensation_profiles_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_allowed text[] := array['status', 'updated_at'];
begin
  if TG_OP = 'DELETE' then
    raise exception 'employee_compensation_profiles_no_delete' using errcode = 'P0001';
  end if;
  if OLD.status = 'draft' and NEW.status = 'approved' then
    v_allowed := v_allowed || array['approved_by', 'approved_at'];
  end if;
  if (to_jsonb(NEW) - v_allowed) is distinct from (to_jsonb(OLD) - v_allowed) then
    raise exception 'employee_compensation_profile_snapshot_immutable' using errcode = 'P0001';
  end if;
  if NEW.status is distinct from OLD.status and not (
       (OLD.status = 'draft' and NEW.status in ('inactive', 'approved'))
    or (OLD.status = 'approved' and NEW.status = 'inactive')
  ) then
    raise exception 'employee_compensation_profile_transition_forbidden' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

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
    if NEW.status is distinct from OLD.status
       or (to_jsonb(NEW) - array['is_current', 'updated_at']) is distinct from (to_jsonb(OLD) - array['is_current', 'updated_at'])
       or not (OLD.is_current = true and NEW.is_current = false) then
      raise exception 'payroll_competence_closed_immutable' using errcode = 'P0001';
    end if;
    return NEW;
  end if;
  if (NEW.employee_id, NEW.competence_month, NEW.version, NEW.period_start, NEW.period_end, NEW.idempotency_key)
     is distinct from (OLD.employee_id, OLD.competence_month, OLD.version, OLD.period_start, OLD.period_end, OLD.idempotency_key) then
    raise exception 'payroll_competence_identity_immutable' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

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
    where c.employee_id = coalesce(NEW.employee_id, OLD.employee_id)
      and c.is_current
      and c.competence_month = date_trunc('month', coalesce(NEW.work_date, OLD.work_date)::timestamp)::date
      and c.status in ('under_review', 'closed', 'paid')
  ) then
    raise exception 'competence_closed_requires_adjustment' using errcode = 'P0001';
  end if;
  if TG_OP = 'UPDATE' and exists (
    select 1 from public.payroll_competence_lines l where l.worked_day_id = OLD.id
  ) then
    raise exception 'worked_day_referenced_by_payroll_line' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

create or replace function public.payroll_j5_round(p numeric)
returns numeric(10,2)
language sql
immutable
set search_path = public, pg_temp
as $$
  select round(p, 2)::numeric(10,2);
$$;

create or replace function public.payroll_j5_month(p date)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select date_trunc('month', p::timestamp)::date;
$$;

create or replace function public.payroll_j5_other_admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where coalesce(p.is_active, true)
      and p.role in ('admin_master', 'admin_financeiro')
      and p.id is distinct from auth.uid()
  );
$$;

create or replace function public.payroll_j5_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_key text
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.finance_audit_events (
    actor_id, actor_role, action, entity_type, entity_id,
    before_state, after_state, reason, operation_id, idempotency_key
  ) values (
    auth.uid(), public.finance_admin_actor_role(), p_action, p_entity_type, p_entity_id,
    coalesce(p_before, '{}'::jsonb), coalesce(p_after, '{}'::jsonb), p_reason, p_key, p_key
  )
  returning id;
$$;

create or replace function public.payroll_j5_input_hash(p_profile_id uuid, p_employee_id uuid, p_start date, p_end date)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select md5(
    coalesce(p_profile_id::text, '') || '|' ||
    coalesce((
      select string_agg(w.work_date::text || ':' || w.status || ':' || w.meal_eligible::text, ',' order by w.work_date)
      from public.employee_worked_days w
      where w.employee_id = p_employee_id and w.work_date between p_start and p_end
    ), '')
  );
$$;

create or replace function public.payroll_j5_recompute(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sal numeric(10,2);
  v_ben numeric(10,2);
  v_oth numeric(10,2);
  v_dis numeric(10,2);
  v_adj numeric(10,2);
  v_com numeric(10,2);
begin
  select
    coalesce(sum(l.amount) filter (where l.line_type = 'base_salary'), 0),
    coalesce(sum(l.amount) filter (where l.line_type in ('meal', 'transport', 'fuel')), 0),
    coalesce(sum(l.amount) filter (where l.line_type = 'other_earning'), 0),
    coalesce(sum(l.amount) filter (where l.line_type in ('discount', 'reversal') and l.amount < 0), 0),
    coalesce(sum(l.amount) filter (where l.line_type = 'adjustment'), 0),
    coalesce(sum(l.amount) filter (where l.line_type = 'commission'), 0)
  into v_sal, v_ben, v_oth, v_dis, v_adj, v_com
  from public.payroll_competence_lines l where l.competence_id = p_id;
  update public.payroll_competences c set
    total_base_salary = v_sal,
    total_benefits = v_ben,
    total_other_earnings = v_oth,
    total_discounts = v_dis,
    total_adjustments = v_adj,
    total_commission = v_com,
    net_total = public.payroll_j5_round(v_sal + v_ben + v_oth + v_adj + v_com + v_dis)
  where c.id = p_id;
end;
$$;

create or replace function public.payroll_j5_add_auto_line(
  p_comp uuid,
  p_type text,
  p_profile uuid,
  p_qty numeric,
  p_unit numeric,
  p_desc text,
  p_visible boolean,
  p_origin text,
  p_version integer,
  p_days integer,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_amt numeric(10,2);
  v_snap jsonb;
begin
  if p_qty is null or p_unit is null or p_qty <= 0 or p_unit <= 0 then
    return null;
  end if;
  v_amt := public.payroll_j5_round(p_qty * p_unit);
  if v_amt = 0 then
    return null;
  end if;
  v_snap := jsonb_strip_nulls(jsonb_build_object(
    'manual', false,
    'source', p_origin,
    'visible', p_visible,
    'profileVersion', p_version,
    'workedDays', case when p_days is not null and p_days > 0 then p_days end
  ));
  insert into public.payroll_competence_lines (
    competence_id, line_type, compensation_profile_id, description, quantity, unit_amount, amount,
    snapshot, idempotency_key, created_by, visible_to_employee, line_origin
  ) values (
    p_comp, p_type, p_profile, p_desc, p_qty, p_unit, v_amt,
    v_snap, p_key, auth.uid(), p_visible, p_origin
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.payroll_j5_round(numeric) from public, anon, authenticated, service_role;
revoke all on function public.payroll_j5_month(date) from public, anon, authenticated, service_role;
revoke all on function public.payroll_j5_other_admin_exists() from public, anon, authenticated, service_role;
revoke all on function public.payroll_j5_audit(text, text, uuid, jsonb, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.payroll_j5_input_hash(uuid, uuid, date, date) from public, anon, authenticated, service_role;
revoke all on function public.payroll_j5_recompute(uuid) from public, anon, authenticated, service_role;
revoke all on function public.payroll_j5_add_auto_line(uuid, text, uuid, numeric, numeric, text, boolean, text, integer, integer, text) from public, anon, authenticated, service_role;

-- ============================================================
-- 4. Aprovação do perfil (não ativa regra de comissão)
-- ============================================================
create or replace function public.admin_approve_employee_compensation(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_id uuid;
  v_reason text;
  v_prof public.employee_compensation_profiles;
  v_existing uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'profileId', 'overrideReason']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'profileId') then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;
  v_id := (p_payload ->> 'profileId')::uuid;
  v_reason := nullif(btrim(coalesce(p_payload ->> 'overrideReason', '')), '');

  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'approve' limit 1;
  if v_existing is not null then
    if v_existing is distinct from v_id then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'profileId', v_id, 'status', 'approved');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.compensation.approve:' || v_id::text, 0));
  select * into v_prof from public.employee_compensation_profiles p where p.id = v_id;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;
  if v_prof.status = 'approved' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'profileId', v_id, 'status', 'approved');
  end if;
  if v_prof.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'stale_version');
  end if;

  if v_prof.created_by is not distinct from auth.uid() and public.payroll_j5_other_admin_exists() then
    if v_role is distinct from 'admin_master' then
      return jsonb_build_object('ok', false, 'code', 'segregation_required');
    end if;
    if v_reason is null or char_length(v_reason) < 20 then
      return jsonb_build_object('ok', false, 'code', 'override_reason_required');
    end if;
    insert into public.finance_audit_events (
      actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, reason, operation_id
    ) values (
      auth.uid(), v_role, 'segregation_override', 'employee_compensation_profile', v_id,
      jsonb_build_object('status', 'draft', 'version', v_prof.version),
      jsonb_build_object('status', 'approved', 'version', v_prof.version),
      v_reason, v_key
    );
  end if;

  update public.employee_compensation_profiles
     set status = 'inactive'
   where employee_id = v_prof.employee_id and status = 'approved' and id is distinct from v_id;

  update public.employee_compensation_profiles
     set status = 'approved', approved_by = auth.uid(), approved_at = timezone('utc', now())
   where id = v_id;

  perform public.payroll_j5_audit(
    'approve', 'employee_compensation_profile', v_id,
    jsonb_build_object('status', 'draft', 'version', v_prof.version),
    jsonb_build_object('status', 'approved', 'version', v_prof.version),
    coalesce(v_reason, 'Aprovacao de versao de remuneracao'),
    v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'profileId', v_id, 'status', 'approved', 'version', v_prof.version);
end;
$$;

-- ============================================================
-- 5. Dias trabalhados
-- ============================================================
create or replace function public.admin_save_employee_worked_days(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_emp uuid;
  v_month date;
  v_today date := public.comp_cfg_today();
  v_end date;
  v_hired date;
  v_dismissed date;
  v_day jsonb;
  v_date date;
  v_present boolean;
  v_abs text;
  v_count int := 0;
  v_existing uuid;
  v_status text;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'employeeId', 'competenceMonth', 'days']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'employeeId') then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;
  if not public.finance_json_is_date(p_payload -> 'competenceMonth') then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  v_emp := (p_payload ->> 'employeeId')::uuid;
  v_month := public.payroll_j5_month((p_payload ->> 'competenceMonth')::date);
  if v_month is distinct from (p_payload ->> 'competenceMonth')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  v_end := public.payroll_competence_period_end(v_month);
  if jsonb_typeof(p_payload -> 'days') is distinct from 'array' or jsonb_array_length(p_payload -> 'days') > 31 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;

  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'worked_day_recorded' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'employeeId', v_emp, 'competenceMonth', v_month);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.worked_days:' || v_emp::text || ':' || v_month::text, 0));

  if exists (
    select 1 from public.payroll_competences c
    where c.employee_id = v_emp and c.is_current and c.competence_month = v_month
      and c.status in ('under_review', 'closed', 'paid')
  ) then
    return jsonb_build_object('ok', false, 'code', 'competence_locked');
  end if;

  select (e.hired_at at time zone 'America/Sao_Paulo')::date,
         (e.dismissed_at at time zone 'America/Sao_Paulo')::date
    into v_hired, v_dismissed
    from public.employees e where e.id = v_emp;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;

  for v_day in select value from jsonb_array_elements(p_payload -> 'days')
  loop
    if jsonb_typeof(v_day) <> 'object'
       or not public.finance_jsonb_keys_allowed(v_day, array['date', 'present', 'absenceReason'])
       or not public.finance_json_is_date(v_day -> 'date')
       or jsonb_typeof(v_day -> 'present') is distinct from 'boolean' then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload');
    end if;
    v_date := (v_day ->> 'date')::date;
    v_present := (v_day ->> 'present')::boolean;
    v_abs := nullif(btrim(coalesce(v_day ->> 'absenceReason', '')), '');
    if v_date < v_month or v_date > v_end then
      return jsonb_build_object('ok', false, 'code', 'date_outside_competence');
    end if;
    if v_date > v_today then
      return jsonb_build_object('ok', false, 'code', 'future_date');
    end if;
    if v_hired is not null and v_date < v_hired then
      return jsonb_build_object('ok', false, 'code', 'before_hire');
    end if;
    if v_dismissed is not null and v_date > v_dismissed then
      return jsonb_build_object('ok', false, 'code', 'after_dismissal');
    end if;
    if v_present then
      v_status := 'worked';
      v_abs := null;
    else
      v_status := 'absent';
      if v_abs is not null and char_length(v_abs) < 3 then
        return jsonb_build_object('ok', false, 'code', 'invalid_payload');
      end if;
    end if;
    insert into public.employee_worked_days (
      employee_id, work_date, status, meal_eligible, source, operation_id, recorded_by, absence_reason
    ) values (
      v_emp, v_date, v_status, (v_status = 'worked'), 'manual_rpc', v_key, auth.uid(), v_abs
    )
    on conflict (employee_id, work_date) do update
      set status = excluded.status,
          meal_eligible = excluded.meal_eligible,
          operation_id = excluded.operation_id,
          recorded_by = excluded.recorded_by,
          absence_reason = excluded.absence_reason;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    select w.id into v_existing from public.employee_worked_days w where w.operation_id = v_key limit 1;
    perform public.payroll_j5_audit(
      'worked_day_recorded', 'employee_worked_day', v_existing,
      '{}'::jsonb,
      jsonb_build_object('status', 'worked', 'meal_eligible', true, 'version', v_count),
      null, v_key
    );
  end if;
  return jsonb_build_object('ok', true, 'idempotent', false, 'employeeId', v_emp, 'competenceMonth', v_month, 'saved', v_count);
end;
$$;

create or replace function public.admin_list_employee_worked_days(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp uuid;
  v_month date;
  v_end date;
  v_today date := public.comp_cfg_today();
  v_header jsonb;
  v_days jsonb;
  v_comp record;
begin
  if public.finance_admin_actor_role() is null then
    raise exception 'compensation_config_forbidden' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['employeeId', 'competenceMonth'])
     or not public.finance_json_is_uuid(p_payload -> 'employeeId')
     or not public.finance_json_is_date(p_payload -> 'competenceMonth') then
    raise exception 'compensation_config_invalid' using errcode = '22023';
  end if;
  v_emp := (p_payload ->> 'employeeId')::uuid;
  v_month := public.payroll_j5_month((p_payload ->> 'competenceMonth')::date);
  v_end := public.payroll_competence_period_end(v_month);

  select jsonb_build_object(
      'employeeId', e.id,
      'name', coalesce(nullif(btrim(p.full_name), ''), 'Funcionario'),
      'status', e.status::text,
      'hiredOn', (e.hired_at at time zone 'America/Sao_Paulo')::date,
      'dismissedOn', (e.dismissed_at at time zone 'America/Sao_Paulo')::date
    ) into v_header
    from public.employees e join public.profiles p on p.id = e.profile_id
   where e.id = v_emp;
  if v_header is null then
    raise exception 'compensation_config_not_found' using errcode = 'P0002';
  end if;

  select c.status, c.id into v_comp from public.payroll_competences c
   where c.employee_id = v_emp and c.is_current and c.competence_month = v_month;

  select coalesce(jsonb_agg(jsonb_build_object(
      'date', w.work_date, 'status', w.status, 'present', w.status = 'worked',
      'mealEligible', w.meal_eligible, 'absenceReason', w.absence_reason
    ) order by w.work_date), '[]'::jsonb)
    into v_days
    from public.employee_worked_days w
   where w.employee_id = v_emp and w.work_date between v_month and v_end;

  return jsonb_build_object(
    'employee', v_header,
    'competenceMonth', v_month,
    'periodStart', v_month,
    'periodEnd', v_end,
    'today', v_today,
    'competenceStatus', v_comp.status,
    'locked', coalesce(v_comp.status in ('under_review', 'closed', 'paid'), false),
    'days', v_days,
    'workedCount', (select count(*) from public.employee_worked_days w
                     where w.employee_id = v_emp and w.work_date between v_month and v_end and w.status = 'worked')
  );
end;
$$;

-- ============================================================
-- 6. Competência: abrir / calcular / revisar / ajustar / fechar / reabrir
-- ============================================================
create or replace function public.admin_open_payroll_competence(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_emp uuid;
  v_month date;
  v_end date;
  v_today date := public.comp_cfg_today();
  v_prof public.employee_compensation_profiles;
  v_id uuid;
  v_existing public.payroll_competences;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'employeeId', 'competenceMonth']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'employeeId') or not public.finance_json_is_date(p_payload -> 'competenceMonth') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_emp := (p_payload ->> 'employeeId')::uuid;
  v_month := public.payroll_j5_month((p_payload ->> 'competenceMonth')::date);
  if v_month is distinct from (p_payload ->> 'competenceMonth')::date or v_month > public.payroll_j5_month(v_today) then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  v_end := public.payroll_competence_period_end(v_month);

  select * into v_existing from public.payroll_competences c where c.idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_existing.id, 'status', v_existing.status, 'version', v_existing.version);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.competence:' || v_emp::text || ':' || v_month::text, 0));
  if exists (select 1 from public.payroll_competences c where c.employee_id = v_emp and c.competence_month = v_month and c.is_current) then
    return jsonb_build_object('ok', false, 'code', 'competence_exists');
  end if;
  if not exists (select 1 from public.employees e where e.id = v_emp) then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;

  select * into v_prof from public.employee_compensation_profiles p
   where p.employee_id = v_emp and p.status = 'approved'
     and p.valid_from <= v_end and (p.valid_until is null or p.valid_until >= v_month)
   order by p.version desc limit 1;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'code', 'approved_profile_required');
  end if;

  insert into public.payroll_competences (
    employee_id, competence_month, timezone, period_start, period_end, version, is_current, status,
    idempotency_key, created_by, compensation_profile_id
  ) values (
    v_emp, v_month, 'America/Sao_Paulo', v_month, v_end, 1, true, 'draft',
    v_key, auth.uid(), v_prof.id
  ) returning id into v_id;

  perform public.payroll_j5_audit(
    'payroll_competence_draft_opened', 'payroll_competence', v_id,
    '{}'::jsonb, jsonb_build_object('competence_status', 'draft', 'version', 1),
    null, v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_id, 'status', 'draft', 'version', 1);
end;
$$;

create or replace function public.admin_calculate_payroll_competence(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_id uuid;
  v_comp public.payroll_competences;
  v_prof public.employee_compensation_profiles;
  v_hash text;
  v_days int;
  v_new uuid;
  v_ver int;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'competenceId']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'competenceId') then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  v_id := (p_payload ->> 'competenceId')::uuid;

  select a.entity_id into v_new from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'payroll_competence_calculated' limit 1;
  if v_new is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_new);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.calc:' || v_id::text, 0));
  select * into v_comp from public.payroll_competences c where c.id = v_id and c.is_current;
  if v_comp.id is null then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  if v_comp.status in ('under_review', 'closed', 'paid') then
    return jsonb_build_object('ok', false, 'code', 'competence_locked');
  end if;
  if v_comp.status not in ('draft', 'calculated') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  if exists (select 1 from public.employee_commission_rules r where r.active or r.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'active_commission_forbidden');
  end if;

  select * into v_prof from public.employee_compensation_profiles p where p.id = v_comp.compensation_profile_id;
  if v_prof.id is null or v_prof.status not in ('approved', 'inactive') then
    return jsonb_build_object('ok', false, 'code', 'approved_profile_required');
  end if;

  v_hash := public.payroll_j5_input_hash(v_prof.id, v_comp.employee_id, v_comp.period_start, v_comp.period_end);
  if v_comp.status = 'calculated' and v_comp.calculation_input_hash is not distinct from v_hash then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_id, 'status', 'calculated', 'version', v_comp.version);
  end if;

  if v_comp.status = 'calculated' and exists (
    select 1 from public.payroll_competence_lines l
     where l.competence_id = v_id and l.line_type in ('base_salary', 'meal', 'transport', 'fuel')
  ) then
    v_ver := v_comp.version + 1;
    insert into public.payroll_competences (
      employee_id, competence_month, timezone, period_start, period_end, version, is_current, status,
      idempotency_key, created_by, compensation_profile_id
    ) values (
      v_comp.employee_id, v_comp.competence_month, 'America/Sao_Paulo', v_comp.period_start, v_comp.period_end,
      v_ver, true, 'draft', v_key, auth.uid(), v_comp.compensation_profile_id
    ) returning id into v_id;
    update public.payroll_competences set is_current = false where id = v_comp.id;
    select * into v_comp from public.payroll_competences c where c.id = v_id;
  end if;

  select count(*)::int into v_days from public.employee_worked_days w
   where w.employee_id = v_comp.employee_id and w.work_date between v_comp.period_start and v_comp.period_end
     and w.status = 'worked';

  if v_prof.salary_enabled then
    perform public.payroll_j5_add_auto_line(
      v_id, 'base_salary', v_prof.id, 1, v_prof.salary_amount, 'Salario mensal',
      v_prof.show_salary, 'approved_profile_snapshot', v_prof.version, null, md5(v_key || ':' || v_id::text || ':sal'));
  end if;
  if v_prof.meal_enabled and v_days > 0 then
    perform public.payroll_j5_add_auto_line(
      v_id, 'meal', v_prof.id, v_days, v_prof.meal_daily_amount, 'Vale-refeicao',
      v_prof.show_meal, 'worked_days', v_prof.version, v_days, md5(v_key || ':' || v_id::text || ':meal'));
  end if;
  if v_prof.transport_enabled then
    if v_prof.transport_method = 'monthly_fixed' then
      perform public.payroll_j5_add_auto_line(
        v_id, 'transport', v_prof.id, 1, v_prof.transport_amount, 'Passagem mensal',
        v_prof.show_transport, 'approved_profile_snapshot', v_prof.version, null, md5(v_key || ':' || v_id::text || ':tr'));
    elsif v_days > 0 then
      perform public.payroll_j5_add_auto_line(
        v_id, 'transport', v_prof.id, v_days, v_prof.transport_amount, 'Passagem por dia',
        v_prof.show_transport, 'worked_days', v_prof.version, v_days, md5(v_key || ':' || v_id::text || ':tr'));
    end if;
  end if;
  if v_prof.fuel_enabled then
    if v_prof.fuel_method = 'monthly_fixed' then
      perform public.payroll_j5_add_auto_line(
        v_id, 'fuel', v_prof.id, 1, v_prof.fuel_amount, 'Gasolina mensal',
        v_prof.show_fuel, 'approved_profile_snapshot', v_prof.version, null, md5(v_key || ':' || v_id::text || ':fuel'));
    elsif v_days > 0 then
      perform public.payroll_j5_add_auto_line(
        v_id, 'fuel', v_prof.id, v_days, v_prof.fuel_amount, 'Gasolina por dia',
        v_prof.show_fuel, 'worked_days', v_prof.version, v_days, md5(v_key || ':' || v_id::text || ':fuel'));
    end if;
  end if;

  update public.payroll_competences
     set status = 'calculated', calculated_at = timezone('utc', now()), calculated_by = auth.uid(),
         calculation_input_hash = v_hash
   where id = v_id;
  perform public.payroll_j5_recompute(v_id);

  perform public.payroll_j5_audit(
    'payroll_competence_calculated', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', v_comp.status, 'version', v_comp.version),
    jsonb_build_object('competence_status', 'calculated', 'version', v_comp.version),
    null, v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_id, 'status', 'calculated', 'version', v_comp.version);
end;
$$;

create or replace function public.admin_review_payroll_competence(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_id uuid;
  v_comp public.payroll_competences;
  v_existing uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'competenceId']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'competenceId') then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  v_id := (p_payload ->> 'competenceId')::uuid;
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'payroll_competence_reviewed' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_existing, 'status', 'under_review');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.review:' || v_id::text, 0));
  select * into v_comp from public.payroll_competences c where c.id = v_id and c.is_current;
  if v_comp.id is null then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  if v_comp.status = 'under_review' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_id, 'status', 'under_review');
  end if;
  if v_comp.status <> 'calculated' then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  update public.payroll_competences
     set status = 'under_review', reviewed_at = timezone('utc', now()), reviewed_by = auth.uid()
   where id = v_id;
  perform public.payroll_j5_audit(
    'payroll_competence_reviewed', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', 'calculated', 'version', v_comp.version),
    jsonb_build_object('competence_status', 'under_review', 'version', v_comp.version),
    null, v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_id, 'status', 'under_review');
end;
$$;

create or replace function public.admin_add_payroll_manual_line(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_id uuid;
  v_type text;
  v_reason text;
  v_amt numeric(10,2);
  v_vis boolean;
  v_comp public.payroll_competences;
  v_event uuid;
  v_line uuid;
  v_existing uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'competenceId', 'lineType', 'amount', 'reason', 'visibleToEmployee']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'competenceId') then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  v_type := p_payload ->> 'lineType';
  if v_type not in ('other_earning', 'discount', 'adjustment') then
    return jsonb_build_object('ok', false, 'code', 'invalid_line_type');
  end if;
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  if v_reason is null or char_length(v_reason) < 20 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if jsonb_typeof(p_payload -> 'amount') is distinct from 'string'
     or (p_payload ->> 'amount') !~ '^-?[0-9]{1,8}\.[0-9]{2}$'
     or (p_payload ->> 'amount') in ('0.00', '-0.00') then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;
  v_amt := (p_payload ->> 'amount')::numeric(10,2);
  if v_type = 'discount' then
    v_amt := -abs(v_amt);
  elsif v_type = 'other_earning' then
    v_amt := abs(v_amt);
  end if;
  if v_amt = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;
  v_vis := coalesce((p_payload ->> 'visibleToEmployee')::boolean, false);
  v_id := (p_payload ->> 'competenceId')::uuid;

  select l.id into v_existing from public.payroll_competence_lines l where l.idempotency_key = v_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'lineId', v_existing, 'competenceId', v_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.adjust:' || v_id::text, 0));
  select * into v_comp from public.payroll_competences c where c.id = v_id and c.is_current;
  if v_comp.id is null then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  if v_comp.status in ('closed', 'paid') then
    return jsonb_build_object('ok', false, 'code', 'competence_locked');
  end if;
  if v_comp.status not in ('draft', 'calculated', 'under_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;

  insert into public.finance_audit_events (
    actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, reason, operation_id, idempotency_key
  ) values (
    auth.uid(), v_role, 'payroll_adjustment_added', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', v_comp.status),
    jsonb_build_object('competence_status', v_comp.status, 'line_type', v_type),
    v_reason, v_key, v_key
  ) returning id into v_event;

  insert into public.payroll_competence_lines (
    competence_id, line_type, adjustment_audit_event_id, description, quantity, unit_amount, amount, reason,
    snapshot, idempotency_key, created_by, visible_to_employee, line_origin
  ) values (
    v_id, v_type, v_event,
    case v_type when 'discount' then 'Desconto manual' when 'other_earning' then 'Outro ganho' else 'Ajuste manual' end,
    1, v_amt, v_amt, v_reason,
    jsonb_build_object('manual', true, 'source', 'manual_adjustment', 'visible', v_vis),
    v_key, auth.uid(), v_vis, 'manual_adjustment'
  ) returning id into v_line;

  perform public.payroll_j5_recompute(v_id);
  return jsonb_build_object('ok', true, 'idempotent', false, 'lineId', v_line, 'competenceId', v_id);
end;
$$;

create or replace function public.admin_close_payroll_competence(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_id uuid;
  v_reason text;
  v_comp public.payroll_competences;
  v_gross numeric(10,2);
  v_existing uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'competenceId', 'reason']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  if v_reason is null or char_length(v_reason) < 20 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'competenceId') then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  v_id := (p_payload ->> 'competenceId')::uuid;
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'payroll_competence_closed' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_existing, 'status', 'closed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.close:' || v_id::text, 0));
  select * into v_comp from public.payroll_competences c where c.id = v_id and c.is_current;
  if v_comp.id is null then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  if v_comp.status = 'closed' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_id, 'status', 'closed');
  end if;
  if v_comp.status <> 'under_review' then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  if exists (select 1 from public.employee_commission_rules r where r.active or r.status = 'active')
     or exists (select 1 from public.employee_commission_entitlements)
     or exists (select 1 from public.payroll_competence_lines l where l.competence_id = v_id and l.line_type = 'commission')
     or v_comp.total_commission <> 0 then
    return jsonb_build_object('ok', false, 'code', 'active_commission_forbidden');
  end if;
  if exists (select 1 from public.payroll_competence_lines l where l.competence_id = v_id and l.competence_id is null) then
    return jsonb_build_object('ok', false, 'code', 'orphan_line');
  end if;
  perform public.payroll_j5_recompute(v_id);
  select * into v_comp from public.payroll_competences c where c.id = v_id;
  select public.payroll_j5_round(c.total_base_salary + c.total_benefits + c.total_other_earnings + c.total_adjustments + c.total_commission)
    into v_gross from public.payroll_competences c where c.id = v_id;
  if v_comp.net_total is distinct from public.payroll_j5_round(v_gross + v_comp.total_discounts) then
    return jsonb_build_object('ok', false, 'code', 'totals_inconsistent');
  end if;
  if exists (
    select 1 from public.employee_compensation_profiles a
    join public.employee_compensation_profiles b on a.employee_id = b.employee_id and a.id < b.id
    where a.status = 'approved' and b.status = 'approved'
  ) then
    return jsonb_build_object('ok', false, 'code', 'profile_overlap');
  end if;

  update public.payroll_competences
     set status = 'closed', closed_at = timezone('utc', now()), closed_by = auth.uid(), closed_reason = v_reason
   where id = v_id;
  perform public.payroll_j5_audit(
    'payroll_competence_closed', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', 'under_review', 'version', v_comp.version),
    jsonb_build_object('competence_status', 'closed', 'version', v_comp.version),
    v_reason, v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_id, 'status', 'closed');
end;
$$;

create or replace function public.admin_reopen_payroll_competence(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_id uuid;
  v_reason text;
  v_comp public.payroll_competences;
  v_new uuid;
  v_existing uuid;
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'competenceId', 'reason']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  if v_reason is null or char_length(v_reason) < 20 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'competenceId') then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  v_id := (p_payload ->> 'competenceId')::uuid;
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'reopen' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_existing);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.reopen:' || v_id::text, 0));
  select * into v_comp from public.payroll_competences c where c.id = v_id;
  if v_comp.id is null then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  if v_comp.status <> 'closed' then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;

  insert into public.payroll_competences (
    employee_id, competence_month, timezone, period_start, period_end, version, is_current, status,
    idempotency_key, created_by, compensation_profile_id
  ) values (
    v_comp.employee_id, v_comp.competence_month, 'America/Sao_Paulo', v_comp.period_start, v_comp.period_end,
    v_comp.version + 1, true, 'draft', v_key, auth.uid(), v_comp.compensation_profile_id
  ) returning id into v_new;
  update public.payroll_competences set is_current = false where id = v_comp.id;

  perform public.payroll_j5_audit(
    'reopen', 'payroll_competence', v_new,
    jsonb_build_object('competence_status', 'closed', 'version', v_comp.version),
    jsonb_build_object('competence_status', 'draft', 'version', v_comp.version + 1),
    v_reason, v_key
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_new, 'status', 'draft', 'version', v_comp.version + 1);
end;
$$;

-- ============================================================
-- 7. Leituras admin
-- ============================================================
create or replace function public.admin_list_payroll_competences(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_emp uuid;
  v_month date;
begin
  if public.finance_admin_actor_role() is null then
    raise exception 'compensation_config_forbidden' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['employeeId', 'competenceMonth']) then
    raise exception 'compensation_config_invalid' using errcode = '22023';
  end if;
  if p_payload ? 'employeeId' and not public.finance_json_is_uuid(p_payload -> 'employeeId') then
    raise exception 'compensation_config_invalid' using errcode = '22023';
  end if;
  if p_payload ? 'competenceMonth' and not public.finance_json_is_date(p_payload -> 'competenceMonth') then
    raise exception 'compensation_config_invalid' using errcode = '22023';
  end if;
  v_emp := case when p_payload ? 'employeeId' then (p_payload ->> 'employeeId')::uuid end;
  v_month := case when p_payload ? 'competenceMonth' then public.payroll_j5_month((p_payload ->> 'competenceMonth')::date) end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'competenceId', c.id,
      'employeeId', c.employee_id,
      'employeeName', coalesce(nullif(btrim(p.full_name), ''), 'Funcionario'),
      'competenceMonth', c.competence_month,
      'status', c.status,
      'version', c.version,
      'grossTotal', public.payroll_j5_round(c.total_base_salary + c.total_benefits + c.total_other_earnings + c.total_adjustments)::text,
      'discountTotal', c.total_discounts::text,
      'netTotal', c.net_total::text,
      'commissionTotal', c.total_commission::text
    ) order by c.competence_month desc, lower(coalesce(p.full_name, ''))), '[]'::jsonb)
    into v_items
    from public.payroll_competences c
    join public.employees e on e.id = c.employee_id
    join public.profiles p on p.id = e.profile_id
   where c.is_current
     and (v_emp is null or c.employee_id = v_emp)
     and (v_month is null or c.competence_month = v_month);

  return jsonb_build_object(
    'competences', v_items,
    'activeCommissionRuleCount', (select count(*) from public.employee_commission_rules where active or status = 'active'),
    'entitlementCount', (select count(*) from public.employee_commission_entitlements),
    'paidCount', (select count(*) from public.payroll_competences where status = 'paid')
  );
end;
$$;

create or replace function public.admin_get_payroll_competence(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_comp jsonb;
  v_lines jsonb;
begin
  if public.finance_admin_actor_role() is null then
    raise exception 'compensation_config_forbidden' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['competenceId'])
     or not public.finance_json_is_uuid(p_payload -> 'competenceId') then
    raise exception 'compensation_config_invalid' using errcode = '22023';
  end if;
  v_id := (p_payload ->> 'competenceId')::uuid;

  select jsonb_build_object(
      'competenceId', c.id,
      'employeeId', c.employee_id,
      'employeeName', coalesce(nullif(btrim(p.full_name), ''), 'Funcionario'),
      'competenceMonth', c.competence_month,
      'periodStart', c.period_start,
      'periodEnd', c.period_end,
      'status', c.status,
      'version', c.version,
      'profileId', c.compensation_profile_id,
      'totals', jsonb_build_object(
        'salary', c.total_base_salary::text,
        'benefits', c.total_benefits::text,
        'otherEarnings', c.total_other_earnings::text,
        'discounts', c.total_discounts::text,
        'adjustments', c.total_adjustments::text,
        'commission', c.total_commission::text,
        'gross', public.payroll_j5_round(c.total_base_salary + c.total_benefits + c.total_other_earnings + c.total_adjustments)::text,
        'net', c.net_total::text
      )
    ) into v_comp
    from public.payroll_competences c
    join public.employees e on e.id = c.employee_id
    join public.profiles p on p.id = e.profile_id
   where c.id = v_id;
  if v_comp is null then
    raise exception 'compensation_config_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'lineId', l.id,
      'type', l.line_type,
      'description', l.description,
      'quantity', l.quantity::text,
      'unitAmount', l.unit_amount::text,
      'amount', l.amount::text,
      'origin', l.line_origin,
      'visibleToEmployee', l.visible_to_employee,
      'reason', l.reason,
      'createdAt', l.created_at
    ) order by l.created_at, l.id), '[]'::jsonb)
    into v_lines
    from public.payroll_competence_lines l where l.competence_id = v_id;

  return jsonb_build_object('competence', v_comp, 'lines', v_lines);
end;
$$;

-- Funcionário: perfil APROVADO vigente (não draft, não active).
create or replace function public.employee_compensation_summary(p_limit integer default 12, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_prof public.employee_compensation_profiles;
  v_profile jsonb := null;
  v_items jsonb;
  v_total bigint;
begin
  select * into v_self from public.employee_portal_self();
  if p_limit is null or p_limit < 1 or p_limit > 24 or p_offset is null or p_offset < 0 or p_offset > 1000 then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;

  select * into v_prof from public.employee_compensation_profiles p
  where p.employee_id = v_self.employee_id and p.status = 'approved'
    and p.valid_from <= v_today and (p.valid_until is null or p.valid_until >= v_today)
  order by p.version desc limit 1;
  if v_prof.id is not null then
    v_profile := jsonb_strip_nulls(jsonb_build_object(
      'validFrom', v_prof.valid_from,
      'salary', case when v_prof.salary_enabled and v_prof.show_salary then jsonb_build_object('amount', v_prof.salary_amount) end,
      'meal', case when v_prof.meal_enabled and v_prof.show_meal then jsonb_build_object('dailyAmount', v_prof.meal_daily_amount) end,
      'transport', case when v_prof.transport_enabled and v_prof.show_transport then jsonb_build_object('amount', v_prof.transport_amount, 'method', v_prof.transport_method) end,
      'fuel', case when v_prof.fuel_enabled and v_prof.show_fuel then jsonb_build_object('amount', v_prof.fuel_amount, 'method', v_prof.fuel_method) end
    ));
  end if;

  select count(*) into v_total from public.payroll_competences c
  where c.employee_id = v_self.employee_id and c.is_current;

  select coalesce(jsonb_agg(x.j order by x.m desc), '[]'::jsonb) into v_items
  from (
    select c.competence_month m, jsonb_build_object(
      'competenceMonth', c.competence_month,
      'status', c.status,
      'visibleTotal', (
        select coalesce(sum(l.amount), 0)::numeric(12,2) from public.payroll_competence_lines l
        where l.competence_id = c.id and public.employee_portal_line_visible(l.id) and l.visible_to_employee),
      'totalKind', case when c.status in ('closed', 'paid') then 'closed' else 'expected' end
    ) j
    from public.payroll_competences c
    where c.employee_id = v_self.employee_id and c.is_current
    order by c.competence_month desc
    limit p_limit offset p_offset
  ) x;

  return jsonb_build_object(
    'employeeStatus', v_self.employee_status,
    'readOnly', v_self.employee_status <> 'active',
    'profile', v_profile,
    'competences', v_items,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'commissionStatus', 'not_calculated'
  );
end;
$$;

create or replace function public.list_employee_competence_lines(p_competence_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_comp record;
  v_components jsonb;
  v_lines jsonb;
  v_total numeric(12,2);
begin
  select * into v_self from public.employee_portal_self();
  if p_competence_month is null or extract(day from p_competence_month) <> 1
     or p_competence_month < date '2020-01-01' or p_competence_month > date '2100-01-01' then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;
  select c.id, c.competence_month, c.status, c.version into v_comp
  from public.payroll_competences c
  where c.employee_id = v_self.employee_id and c.is_current and c.competence_month = p_competence_month;
  if v_comp.id is null then
    raise exception 'employee_portal_not_found' using errcode = 'P0001';
  end if;

  with vis as (
    select l.*, public.employee_portal_line_kind(l.id) kind
    from public.payroll_competence_lines l
    where l.competence_id = v_comp.id
      and public.employee_portal_line_visible(l.id)
      and l.visible_to_employee
  )
  select
    coalesce((select jsonb_object_agg(k.kind, k.s) from (select kind, sum(amount)::numeric(12,2) s from vis group by kind) k), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', v.kind, 'type', v.line_type, 'description', v.description,
        'quantity', v.quantity, 'amount', v.amount, 'createdAt', v.created_at
      ) order by v.created_at, v.id) from (select * from vis order by created_at, id limit 500) v), '[]'::jsonb),
    coalesce((select sum(amount) from vis), 0)::numeric(12,2)
  into v_components, v_lines, v_total;

  if v_components ? 'commission' then
    v_components := v_components - 'commission';
  end if;

  return jsonb_build_object(
    'competenceMonth', v_comp.competence_month,
    'status', v_comp.status,
    'version', v_comp.version,
    'components', v_components,
    'commissionStatus', 'not_calculated',
    'total', jsonb_build_object('kind', case when v_comp.status in ('closed', 'paid') then 'closed' else 'expected' end, 'amount', v_total),
    'lines', v_lines
  );
end;
$$;

-- ============================================================
-- 8. Grants mínimos. Legado I1 permanece SEM EXECUTE.
-- ============================================================
revoke all on function public.admin_approve_employee_compensation(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_save_employee_worked_days(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_employee_worked_days(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_open_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_calculate_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_review_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_add_payroll_manual_line(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_close_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_reopen_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_payroll_competences(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_payroll_competence(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_employee_compensation(jsonb) to authenticated;
grant execute on function public.admin_save_employee_worked_days(jsonb) to authenticated;
grant execute on function public.admin_list_employee_worked_days(jsonb) to authenticated;
grant execute on function public.admin_open_payroll_competence(jsonb) to authenticated;
grant execute on function public.admin_calculate_payroll_competence(jsonb) to authenticated;
grant execute on function public.admin_review_payroll_competence(jsonb) to authenticated;
grant execute on function public.admin_add_payroll_manual_line(jsonb) to authenticated;
grant execute on function public.admin_close_payroll_competence(jsonb) to authenticated;
grant execute on function public.admin_reopen_payroll_competence(jsonb) to authenticated;
grant execute on function public.admin_list_payroll_competences(jsonb) to authenticated;
grant execute on function public.admin_get_payroll_competence(jsonb) to authenticated;

revoke all on function public.employee_compensation_summary(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.list_employee_competence_lines(date) from public, anon, authenticated, service_role;
grant execute on function public.employee_compensation_summary(integer, integer) to authenticated;
grant execute on function public.list_employee_competence_lines(date) to authenticated;

revoke all on function public.create_commission_rule_draft(text, uuid, text, text, text, numeric, numeric, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.version_commission_rule_draft(text, uuid, text, text, numeric, numeric, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.configure_employee_compensation_draft(text, uuid, date, date, numeric, numeric, numeric, text, numeric, text, boolean, boolean, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.record_employee_worked_day(text, uuid, date, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.open_payroll_competence_draft(text, uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.add_manual_payroll_adjustment(text, uuid, text, numeric, text, text) from public, anon, authenticated, service_role;

commit;
