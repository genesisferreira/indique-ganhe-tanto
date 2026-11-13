-- Sprint 3.1F-J6 — ativacao controlada, entitlement, reconciliacao e pagamento manual.
-- ADITIVA, transacional, reaplicavel. Sem ERP, sem Pix, sem wallet, sem cron.
-- Modalidades de comissao permanecem NAO ativaveis (GATE 1).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.employee_commission_rules') is null
     or to_regclass('public.employee_commission_entitlements') is null
     or to_regclass('public.payroll_competences') is null
     or to_regprocedure('public.admin_close_payroll_competence(jsonb)') is null
     or to_regprocedure('public.payroll_j5_round(numeric)') is null
     or to_regprocedure('public.payroll_j5_audit(text,text,uuid,jsonb,jsonb,text,text)') is null then
    raise exception 'j6_prerequisite_missing: aplicar 3.1F-I1/J4/J5 antes';
  end if;
  -- Primeira aplicação: exige portões I1/J5. Reaplicação: paid_on já existe.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payroll_competences' and column_name = 'paid_on'
  ) then
    if not exists (select 1 from pg_constraint where conname = 'employee_commission_rules_foundation_inactive_chk')
       or not exists (select 1 from pg_constraint where conname = 'payroll_competences_foundation_no_pay_chk') then
      raise exception 'j6_prerequisite_missing: aplicar 3.1F-I1/J4/J5 antes';
    end if;
    if exists (select 1 from public.employee_commission_rules where active or status = 'active')
       or exists (select 1 from public.employee_commission_entitlements)
       or exists (select 1 from public.payroll_competences where status = 'paid') then
      raise exception 'j6_active_financial_state_found';
    end if;
  end if;
end$$;

-- ============================================================
-- 1. Schema
-- ============================================================
alter table public.employee_commission_rules drop constraint if exists employee_commission_rules_foundation_inactive_chk;
alter table public.payroll_competences drop constraint if exists payroll_competences_foundation_no_pay_chk;

alter table public.employee_commission_rules drop constraint if exists employee_commission_rules_status_chk;
alter table public.employee_commission_rules add constraint employee_commission_rules_status_chk
  check (status in ('draft', 'approved', 'active', 'inactive', 'superseded'));

alter table public.payroll_competences add column if not exists paid_on date;
alter table public.payroll_competences add column if not exists payment_method text;
alter table public.payroll_competences add column if not exists payment_reference text;
alter table public.payroll_competences add column if not exists payment_note text;
alter table public.payroll_competences add column if not exists payment_reversed boolean not null default false;
alter table public.payroll_competences add column if not exists payment_reversed_at timestamptz;
alter table public.payroll_competences add column if not exists payment_reversed_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payroll_competences_payment_method_chk') then
    alter table public.payroll_competences add constraint payroll_competences_payment_method_chk
      check (payment_method is null or payment_method in ('bank_transfer', 'cash', 'payroll_batch', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_competences_payment_ref_chk') then
    alter table public.payroll_competences add constraint payroll_competences_payment_ref_chk
      check (payment_reference is null or payment_reference ~ '^[A-Za-z0-9._-]{1,80}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_competences_payment_note_chk') then
    alter table public.payroll_competences add constraint payroll_competences_payment_note_chk
      check (payment_note is null or char_length(btrim(payment_note)) between 1 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_competences_paid_consistency_chk') then
    alter table public.payroll_competences add constraint payroll_competences_paid_consistency_chk
      check (
        (status = 'paid') = (paid_at is not null and paid_by is not null and paid_on is not null and payment_method is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_competences_reversed_chk') then
    alter table public.payroll_competences add constraint payroll_competences_reversed_chk
      check (
        (payment_reversed = true) = (payment_reversed_at is not null and payment_reversed_by is not null)
        and (payment_reversed = false or status = 'paid')
      );
  end if;
end$$;

create unique index if not exists payroll_competence_lines_commission_uidx
  on public.payroll_competence_lines (competence_id, commission_entitlement_id)
  where commission_entitlement_id is not null and line_type = 'commission';

alter table public.payroll_competence_lines drop constraint if exists payroll_competence_lines_origin_chk;
alter table public.payroll_competence_lines add constraint payroll_competence_lines_origin_chk
  check (line_origin is null or line_origin in ('approved_profile_snapshot', 'worked_days', 'manual_adjustment', 'commission_entitlement'));

alter table public.payroll_competence_lines drop constraint if exists payroll_competence_lines_snapshot_chk;
alter table public.payroll_competence_lines add constraint payroll_competence_lines_snapshot_chk check (
  public.finance_jsonb_keys_allowed(snapshot, array['manual', 'source', 'visible', 'profileVersion', 'workedDays'])
  and (not (snapshot ? 'manual') or jsonb_typeof(snapshot -> 'manual') = 'boolean')
  and (not (snapshot ? 'visible') or jsonb_typeof(snapshot -> 'visible') = 'boolean')
  and (not (snapshot ? 'source') or (jsonb_typeof(snapshot -> 'source') = 'string'
        and (snapshot ->> 'source') in ('approved_profile_snapshot', 'worked_days', 'manual_adjustment', 'commission_entitlement')))
  and (not (snapshot ? 'profileVersion') or public.finance_json_is_pos_int(snapshot -> 'profileVersion'))
  and (not (snapshot ? 'workedDays') or public.finance_json_is_pos_int(snapshot -> 'workedDays'))
);

create table if not exists public.employee_commission_reconcile_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  cursor_opportunity_id uuid,
  scanned integer not null default 0,
  accrued integer not null default 0,
  skipped_unproven integer not null default 0,
  skipped_no_rule integer not null default 0,
  skipped_existing integer not null default 0,
  erp_requests integer not null default 0,
  limit_rows integer not null default 50,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  actor_id uuid references public.profiles(id) on delete set null,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_commission_reconcile_runs_status_chk check (status in ('running', 'paused', 'completed', 'failed')),
  constraint employee_commission_reconcile_runs_idem_uq unique (idempotency_key),
  constraint employee_commission_reconcile_runs_erp_zero_chk check (erp_requests = 0),
  constraint employee_commission_reconcile_runs_limit_chk check (limit_rows between 1 and 200),
  constraint employee_commission_reconcile_runs_counts_chk check (
    scanned >= 0 and accrued >= 0 and skipped_unproven >= 0 and skipped_no_rule >= 0 and skipped_existing >= 0
  )
);
create unique index if not exists employee_commission_reconcile_runs_running_uidx
  on public.employee_commission_reconcile_runs ((true)) where status = 'running';
alter table public.employee_commission_reconcile_runs enable row level security;
revoke all on table public.employee_commission_reconcile_runs from public, anon, authenticated, service_role;
drop trigger if exists trg_employee_commission_reconcile_runs_updated on public.employee_commission_reconcile_runs;
create trigger trg_employee_commission_reconcile_runs_updated
before update on public.employee_commission_reconcile_runs
for each row execute function public.set_updated_at();

alter table public.finance_audit_events drop constraint if exists finance_audit_events_entity_chk;
alter table public.finance_audit_events add constraint finance_audit_events_entity_chk check (entity_type in (
  'sales_opportunity_attribution',
  'employee_commission_rule',
  'employee_commission_entitlement',
  'employee_compensation_profile',
  'employee_worked_day',
  'payroll_competence',
  'payroll_competence_line',
  'employee_commission_reconcile_run'
));

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
  'payroll_competence_closed',
  'commission_rule_approved',
  'commission_rule_activated',
  'commission_reconcile_started',
  'commission_reconcile_finished',
  'entitlement_approved',
  'entitlement_included'
));

alter table public.finance_audit_events drop constraint if exists finance_audit_events_reason_required_chk;
alter table public.finance_audit_events add constraint finance_audit_events_reason_required_chk check (
  action not in ('approve', 'adjust', 'reverse', 'reopen', 'pay', 'payroll_adjustment_added',
                 'segregation_override', 'payroll_competence_closed', 'commission_rule_approved',
                 'commission_rule_activated', 'entitlement_approved', 'entitlement_included')
  or char_length(btrim(coalesce(reason, ''))) >= 3
);

-- ============================================================
-- 2. Snapshots / gates
-- ============================================================
create or replace function public.finance_evidence_snapshot_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is not null
    and jsonb_typeof(p) = 'object'
    and public.finance_jsonb_keys_allowed(p, array[
      'evidenceKind', 'contractIdentityPresent', 'invoiceIdentityPresent', 'invoiceGeneratedAt',
      'invoicePaidAt', 'documentAmount', 'paidAmount', 'fullPaymentProven', 'evidenceSource', 'evidenceVersion',
      'firstInvoiceOrderProven', 'partialPayment', 'invoiceDeleted', 'triggerKind'
    ])
    and (not (p ? 'evidenceKind') or jsonb_typeof(p -> 'evidenceKind') = 'null'
         or (jsonb_typeof(p -> 'evidenceKind') = 'string' and (p ->> 'evidenceKind') in ('not_collected', 'manual_review', 'crm_persisted', 'gate_blocked')))
    and (not (p ? 'evidenceSource') or jsonb_typeof(p -> 'evidenceSource') = 'null'
         or (jsonb_typeof(p -> 'evidenceSource') = 'string' and (p ->> 'evidenceSource') in ('not_collected', 'manual_review', 'crm_persisted')))
    and (not (p ? 'contractIdentityPresent') or jsonb_typeof(p -> 'contractIdentityPresent') in ('null', 'boolean'))
    and (not (p ? 'invoiceIdentityPresent') or jsonb_typeof(p -> 'invoiceIdentityPresent') in ('null', 'boolean'))
    and (not (p ? 'fullPaymentProven') or jsonb_typeof(p -> 'fullPaymentProven') in ('null', 'boolean'))
    and (not (p ? 'firstInvoiceOrderProven') or jsonb_typeof(p -> 'firstInvoiceOrderProven') in ('null', 'boolean'))
    and (not (p ? 'partialPayment') or jsonb_typeof(p -> 'partialPayment') in ('null', 'boolean'))
    and (not (p ? 'invoiceDeleted') or jsonb_typeof(p -> 'invoiceDeleted') in ('null', 'boolean'))
    and (not (p ? 'invoiceGeneratedAt') or jsonb_typeof(p -> 'invoiceGeneratedAt') = 'null' or public.finance_json_is_instant(p -> 'invoiceGeneratedAt'))
    and (not (p ? 'invoicePaidAt') or jsonb_typeof(p -> 'invoicePaidAt') = 'null' or public.finance_json_is_instant(p -> 'invoicePaidAt'))
    and (not (p ? 'documentAmount') or jsonb_typeof(p -> 'documentAmount') = 'null' or public.finance_json_is_money(p -> 'documentAmount'))
    and (not (p ? 'paidAmount') or jsonb_typeof(p -> 'paidAmount') = 'null' or public.finance_json_is_money(p -> 'paidAmount'))
    and (not (p ? 'evidenceVersion') or jsonb_typeof(p -> 'evidenceVersion') = 'null' or public.finance_json_is_pos_int(p -> 'evidenceVersion'))
    and (not (p ? 'triggerKind') or jsonb_typeof(p -> 'triggerKind') = 'null'
         or (jsonb_typeof(p -> 'triggerKind') = 'string'
             and (p ->> 'triggerKind') in ('first_valid_invoice_generated', 'first_valid_invoice_fully_paid')));
$$;

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
      'active', 'retroactive', 'version', 'meal_eligible', 'line_type', 'competence_status', 'amount',
      'payment_method'
    ])
    and (not (p ? 'attribution_role') or (jsonb_typeof(p -> 'attribution_role') = 'string'
         and (p ->> 'attribution_role') in ('technician_originator', 'external_sales_originator', 'internal_sales_responsible')))
    and (not (p ? 'method') or (jsonb_typeof(p -> 'method') = 'string'
         and (p ->> 'method') in ('fixed_amount', 'percentage', 'first_invoice_value')))
    and (not (p ? 'trigger_kind') or (jsonb_typeof(p -> 'trigger_kind') = 'string'
         and (p ->> 'trigger_kind') in ('first_valid_invoice_generated', 'first_valid_invoice_fully_paid')))
    and (not (p ? 'status') or (jsonb_typeof(p -> 'status') = 'string' and (p ->> 'status') in (
         'draft', 'approved', 'active', 'superseded', 'inactive', 'worked', 'absent', 'vacation', 'leave', 'holiday', 'compensated',
         'calculated', 'reviewed', 'under_review', 'closed', 'reopened', 'running', 'paused', 'completed', 'failed',
         'pending_evidence', 'accrued', 'included_in_payroll', 'paid', 'reversed', 'rejected')))
    and (not (p ? 'previous_status') or (jsonb_typeof(p -> 'previous_status') = 'string'
         and (p ->> 'previous_status') in ('draft', 'approved', 'active', 'superseded', 'inactive', 'calculated', 'reviewed', 'under_review', 'closed', 'paid', 'running')))
    and (not (p ? 'competence_status') or (jsonb_typeof(p -> 'competence_status') = 'string'
         and (p ->> 'competence_status') in ('draft', 'calculated', 'reviewed', 'under_review', 'closed', 'reopened', 'paid')))
    and (not (p ? 'line_type') or (jsonb_typeof(p -> 'line_type') = 'string'
         and (p ->> 'line_type') in ('adjustment', 'discount', 'other_earning', 'commission', 'reversal')))
    and (not (p ? 'payment_method') or (jsonb_typeof(p -> 'payment_method') = 'string'
         and (p ->> 'payment_method') in ('bank_transfer', 'cash', 'payroll_batch', 'other')))
    and (not (p ? 'reward_created') or jsonb_typeof(p -> 'reward_created') = 'boolean')
    and (not (p ? 'active') or jsonb_typeof(p -> 'active') = 'boolean')
    and (not (p ? 'retroactive') or jsonb_typeof(p -> 'retroactive') = 'boolean')
    and (not (p ? 'meal_eligible') or jsonb_typeof(p -> 'meal_eligible') = 'boolean')
    and (not (p ? 'version') or public.finance_json_is_pos_int(p -> 'version'))
    and (not (p ? 'amount') or public.finance_json_is_money(p -> 'amount'));
$$;

-- GATE 1: nenhuma modalidade comprovada nesta entrega.
create or replace function public.commission_j6_method_activatable(p_method text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select false
    and p_method in ('fixed_amount', 'percentage', 'first_invoice_value');
$$;

create or replace function public.commission_j6_method_block_reason(p_method text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_method
    when 'fixed_amount' then 'first_invoice_order_unproven'
    when 'percentage' then 'percentage_base_not_proven'
    when 'first_invoice_value' then 'full_payment_unproven'
    else 'method_not_activatable'
  end;
$$;

create or replace function public.commission_j6_calculate(
  p_method text,
  p_fixed numeric,
  p_rate numeric,
  p_base numeric
)
returns numeric(10,2)
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_method = 'fixed_amount' and p_fixed is not null and p_fixed > 0 then round(p_fixed, 2)::numeric(10,2)
    when p_method = 'percentage' and p_base is not null and p_base > 0 and public.finance_percentage_rate_valid(p_rate)
      then public.finance_percentage_amount(p_base, p_rate)
    when p_method = 'first_invoice_value' and p_base is not null and p_base > 0 then round(p_base, 2)::numeric(10,2)
    else null
  end;
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
    when p_status = 'active' then 'active'
    when p_status = 'superseded' then 'superseded'
    when p_status = 'inactive' and p_has_successor then 'superseded'
    when p_status = 'inactive' then 'archived'
    else 'unknown'
  end;
$$;

create or replace function public.trg_employee_commission_rules_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_allowed text[] := array['status', 'updated_at'];
begin
  if TG_OP = 'DELETE' then
    raise exception 'employee_commission_rules_no_delete' using errcode = 'P0001';
  end if;
  if OLD.status = 'draft' and NEW.status = 'approved' then
    v_allowed := v_allowed || array['approved_by', 'approved_at'];
  elsif OLD.status in ('draft', 'approved') and NEW.status = 'active' then
    v_allowed := array['status', 'updated_at', 'active', 'approved_by', 'approved_at'];
  elsif NEW.status = 'inactive' and OLD.status in ('draft', 'approved', 'active') then
    v_allowed := array['status', 'updated_at', 'active'];
  elsif OLD.status = 'active' and NEW.status = 'superseded' then
    v_allowed := array['status', 'updated_at', 'active'];
  end if;
  if (to_jsonb(NEW) - v_allowed) is distinct from (to_jsonb(OLD) - v_allowed) then
    raise exception 'employee_commission_rule_snapshot_immutable' using errcode = 'P0001';
  end if;
  if NEW.status is distinct from OLD.status and not (
       (OLD.status = 'draft' and NEW.status in ('approved', 'inactive', 'superseded', 'active'))
    or (OLD.status = 'approved' and NEW.status in ('active', 'inactive'))
    or (OLD.status = 'active' and NEW.status in ('inactive', 'superseded'))
  ) then
    raise exception 'employee_commission_rule_transition_forbidden' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

create or replace function public.trg_payroll_competences_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_allowed text[];
begin
  if TG_OP = 'DELETE' then
    raise exception 'payroll_competences_no_delete' using errcode = 'P0001';
  end if;
  if OLD.status = 'closed' then
    v_allowed := array['is_current', 'updated_at'];
    if NEW.status = 'paid' then
      v_allowed := v_allowed || array['status', 'paid_at', 'paid_by', 'paid_on', 'payment_method', 'payment_reference', 'payment_note'];
    end if;
    if (to_jsonb(NEW) - v_allowed) is distinct from (to_jsonb(OLD) - v_allowed) then
      raise exception 'payroll_competence_closed_immutable' using errcode = 'P0001';
    end if;
    if NEW.status = 'closed' and not (OLD.is_current = true and NEW.is_current = false) then
      raise exception 'payroll_competence_closed_immutable' using errcode = 'P0001';
    end if;
    return NEW;
  end if;
  if OLD.status = 'paid' then
    v_allowed := array['is_current', 'updated_at'];
    if NEW.payment_reversed = true and OLD.payment_reversed is distinct from true then
      v_allowed := v_allowed || array['payment_reversed', 'payment_reversed_at', 'payment_reversed_by'];
    end if;
    if (to_jsonb(NEW) - v_allowed) is distinct from (to_jsonb(OLD) - v_allowed) then
      raise exception 'payroll_competence_closed_immutable' using errcode = 'P0001';
    end if;
    if NEW.status is distinct from 'paid' then
      raise exception 'payroll_competence_closed_immutable' using errcode = 'P0001';
    end if;
    if NEW.payment_reversed is distinct from true and not (OLD.is_current = true and NEW.is_current = false) then
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

create or replace function public.trg_finance_audit_events_validate_entity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
begin
  v_exists := case NEW.entity_type
    when 'sales_opportunity_attribution' then exists (select 1 from public.sales_opportunity_attributions x where x.id = NEW.entity_id)
    when 'employee_commission_rule' then exists (select 1 from public.employee_commission_rules x where x.id = NEW.entity_id)
    when 'employee_commission_entitlement' then exists (select 1 from public.employee_commission_entitlements x where x.id = NEW.entity_id)
    when 'employee_compensation_profile' then exists (select 1 from public.employee_compensation_profiles x where x.id = NEW.entity_id)
    when 'employee_worked_day' then exists (select 1 from public.employee_worked_days x where x.id = NEW.entity_id)
    when 'payroll_competence' then exists (select 1 from public.payroll_competences x where x.id = NEW.entity_id)
    when 'payroll_competence_line' then exists (select 1 from public.payroll_competence_lines x where x.id = NEW.entity_id)
    when 'employee_commission_reconcile_run' then exists (select 1 from public.employee_commission_reconcile_runs x where x.id = NEW.entity_id)
    else false
  end;
  if NEW.entity_id is null or not coalesce(v_exists, false) then
    raise exception 'finance_audit_entity_not_found' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_employee_commission_entitlements_z_foundation_gate on public.employee_commission_entitlements;
create or replace function public.trg_employee_commission_entitlements_foundation_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.status = 'accrued' then
    if NEW.amount is null or NEW.accrued_at is null then
      raise exception 'entitlement_evidence_incomplete' using errcode = 'P0001';
    end if;
    if coalesce(NEW.evidence_snapshot ->> 'evidenceKind', 'not_collected') in ('not_collected', 'gate_blocked') then
      raise exception 'entitlement_evidence_incomplete' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_employee_commission_entitlements_z_accrual_gate on public.employee_commission_entitlements;
create trigger trg_employee_commission_entitlements_z_accrual_gate
before insert on public.employee_commission_entitlements
for each row execute function public.trg_employee_commission_entitlements_foundation_gate();

create or replace function public.payroll_j6_copy_commission_lines(p_from uuid, p_to uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.payroll_competence_lines (
    competence_id, line_type, commission_entitlement_id, description, quantity, unit_amount, amount, reason,
    snapshot, idempotency_key, created_by, visible_to_employee, line_origin
  )
  select p_to, l.line_type, l.commission_entitlement_id, l.description, l.quantity, l.unit_amount, l.amount, l.reason,
         l.snapshot, md5(p_key || ':' || l.id::text), l.created_by, l.visible_to_employee, l.line_origin
    from public.payroll_competence_lines l
   where l.competence_id = p_from and l.line_type = 'commission';
end;
$$;

revoke all on function public.commission_j6_method_activatable(text) from public, anon, authenticated, service_role;
revoke all on function public.commission_j6_method_block_reason(text) from public, anon, authenticated, service_role;
revoke all on function public.commission_j6_calculate(text, numeric, numeric, numeric) from public, anon, authenticated, service_role;
revoke all on function public.payroll_j6_copy_commission_lines(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ============================================================
-- 3. RPCs
-- ============================================================
create or replace function public.admin_approve_commission_rule(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_id uuid;
  v_rule public.employee_commission_rules;
  v_override text;
  v_existing uuid;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'ruleId', 'overrideReason']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'ruleId') then
    return jsonb_build_object('ok', false, 'code', 'rule_not_found');
  end if;
  v_id := (p_payload ->> 'ruleId')::uuid;
  v_override := nullif(btrim(coalesce(p_payload ->> 'overrideReason', '')), '');
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'commission_rule_approved' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'ruleId', v_existing, 'status', 'approved');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule:' || v_id::text, 0));
  select * into v_rule from public.employee_commission_rules r where r.id = v_id;
  if v_rule.id is null then return jsonb_build_object('ok', false, 'code', 'rule_not_found'); end if;
  if v_rule.status = 'approved' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'ruleId', v_id, 'status', 'approved');
  end if;
  if v_rule.status <> 'draft' then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if v_rule.created_by is not distinct from auth.uid() and public.payroll_j5_other_admin_exists() then
    if v_role <> 'admin_master' or v_override is null or char_length(v_override) < 20 then
      return jsonb_build_object('ok', false, 'code', case when v_role = 'admin_master' then 'override_reason_required' else 'segregation_required' end);
    end if;
    perform public.payroll_j5_audit('segregation_override', 'employee_commission_rule', v_id,
      jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'approved'), v_override, v_key || '_ov');
  end if;
  update public.employee_commission_rules
     set status = 'approved', approved_by = auth.uid(), approved_at = timezone('utc', now())
   where id = v_id;
  perform public.payroll_j5_audit('commission_rule_approved', 'employee_commission_rule', v_id,
    jsonb_build_object('status', 'draft', 'method', v_rule.method),
    jsonb_build_object('status', 'approved', 'method', v_rule.method),
    coalesce(v_override, 'Aprovacao de rascunho de regra de comissao.'), v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'ruleId', v_id, 'status', 'approved');
end;
$$;

create or replace function public.admin_activate_commission_rule(p_payload jsonb)
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
  v_rule public.employee_commission_rules;
  v_today date := public.comp_cfg_today();
  v_existing uuid;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'ruleId', 'reason']) then
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
  if not public.finance_json_is_uuid(p_payload -> 'ruleId') then
    return jsonb_build_object('ok', false, 'code', 'rule_not_found');
  end if;
  v_id := (p_payload ->> 'ruleId')::uuid;
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'commission_rule_activated' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'ruleId', v_existing, 'status', 'active');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.commission_rule.activate:' || v_id::text, 0));
  select * into v_rule from public.employee_commission_rules r where r.id = v_id;
  if v_rule.id is null then return jsonb_build_object('ok', false, 'code', 'rule_not_found'); end if;
  if v_rule.status = 'active' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'ruleId', v_id, 'status', 'active');
  end if;
  if v_rule.status <> 'approved' then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if v_rule.effective_from < v_today then return jsonb_build_object('ok', false, 'code', 'retroactive_forbidden'); end if;
  if v_rule.attribution_role = 'internal_sales_responsible' then
    return jsonb_build_object('ok', false, 'code', 'role_disabled');
  end if;
  if not public.commission_j6_method_activatable(v_rule.method) then
    return jsonb_build_object('ok', false, 'code', public.commission_j6_method_block_reason(v_rule.method));
  end if;
  update public.employee_commission_rules
     set status = 'inactive', active = false
   where rule_family_id = v_rule.rule_family_id and status = 'active' and id <> v_id;
  update public.employee_commission_rules
     set status = 'active', active = true
   where id = v_id;
  perform public.payroll_j5_audit('commission_rule_activated', 'employee_commission_rule', v_id,
    jsonb_build_object('status', 'approved', 'active', false, 'method', v_rule.method),
    jsonb_build_object('status', 'active', 'active', true, 'method', v_rule.method),
    v_reason, v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'ruleId', v_id, 'status', 'active');
end;
$$;

create or replace function public.admin_approve_commission_entitlement(p_payload jsonb)
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
  v_ent public.employee_commission_entitlements;
  v_existing uuid;
  v_month date;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'entitlementId', 'reason']) then
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
  if not public.finance_json_is_uuid(p_payload -> 'entitlementId') then
    return jsonb_build_object('ok', false, 'code', 'entitlement_not_found');
  end if;
  v_id := (p_payload ->> 'entitlementId')::uuid;
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'entitlement_approved' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'entitlementId', v_existing);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.entitlement:' || v_id::text, 0));
  select * into v_ent from public.employee_commission_entitlements e where e.id = v_id;
  if v_ent.id is null then return jsonb_build_object('ok', false, 'code', 'entitlement_not_found'); end if;
  if v_ent.status = 'approved' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'entitlementId', v_id);
  end if;
  if v_ent.status <> 'accrued' then return jsonb_build_object('ok', false, 'code', 'entitlement_not_accrued'); end if;
  v_month := coalesce(v_ent.competence_month, public.payroll_competence_month_for(coalesce(v_ent.accrued_at, timezone('utc', now()))));
  update public.employee_commission_entitlements
     set status = 'approved', approved_at = timezone('utc', now()), approved_by = auth.uid(), competence_month = v_month
   where id = v_id;
  perform public.payroll_j5_audit('entitlement_approved', 'employee_commission_entitlement', v_id,
    jsonb_build_object('status', 'accrued'), jsonb_build_object('status', 'approved'), v_reason, v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'entitlementId', v_id, 'status', 'approved');
end;
$$;

create or replace function public.admin_include_commission_in_payroll(p_payload jsonb)
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
  v_vis boolean;
  v_ent public.employee_commission_entitlements;
  v_comp public.payroll_competences;
  v_line uuid;
  v_existing uuid;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'entitlementId', 'reason', 'visibleToEmployee']) then
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
  if jsonb_typeof(p_payload -> 'visibleToEmployee') is distinct from 'boolean' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_vis := (p_payload ->> 'visibleToEmployee')::boolean;
  if not public.finance_json_is_uuid(p_payload -> 'entitlementId') then
    return jsonb_build_object('ok', false, 'code', 'entitlement_not_found');
  end if;
  v_id := (p_payload ->> 'entitlementId')::uuid;
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'entitlement_included' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'entitlementId', v_existing);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.entitlement.include:' || v_id::text, 0));
  select * into v_ent from public.employee_commission_entitlements e where e.id = v_id;
  if v_ent.id is null then return jsonb_build_object('ok', false, 'code', 'entitlement_not_found'); end if;
  if v_ent.status = 'included_in_payroll' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'entitlementId', v_id);
  end if;
  if v_ent.status <> 'approved' then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if v_ent.competence_month is null then return jsonb_build_object('ok', false, 'code', 'invalid_period'); end if;
  select * into v_comp from public.payroll_competences c
   where c.employee_id = v_ent.employee_id and c.competence_month = v_ent.competence_month and c.is_current;
  if v_comp.id is null then return jsonb_build_object('ok', false, 'code', 'competence_not_found'); end if;
  if v_comp.status in ('closed', 'paid') then return jsonb_build_object('ok', false, 'code', 'competence_locked'); end if;
  if v_comp.status not in ('draft', 'calculated', 'under_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  if exists (select 1 from public.payroll_competence_lines l
              where l.competence_id = v_comp.id and l.commission_entitlement_id = v_ent.id) then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  insert into public.payroll_competence_lines (
    competence_id, line_type, commission_entitlement_id, description, quantity, unit_amount, amount, reason,
    snapshot, idempotency_key, created_by, visible_to_employee, line_origin
  ) values (
    v_comp.id, 'commission', v_ent.id, 'Comissao por venda', 1, v_ent.amount, v_ent.amount, v_reason,
    jsonb_build_object('manual', false, 'source', 'commission_entitlement', 'visible', v_vis),
    v_key, auth.uid(), v_vis, 'commission_entitlement'
  ) returning id into v_line;
  update public.employee_commission_entitlements set status = 'included_in_payroll' where id = v_ent.id;
  perform public.payroll_j5_recompute(v_comp.id);
  perform public.payroll_j5_audit('entitlement_included', 'employee_commission_entitlement', v_ent.id,
    jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'included_in_payroll', 'line_type', 'commission'),
    v_reason, v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'entitlementId', v_ent.id, 'competenceId', v_comp.id);
end;
$$;

create or replace function public.admin_reconcile_employee_commissions(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.finance_admin_actor_role();
  v_key text;
  v_limit int := 50;
  v_run uuid;
  v_existing public.employee_commission_reconcile_runs;
  v_cursor uuid;
  v_attr record;
  v_n int := 0;
  v_skip_unproven int := 0;
  v_skip_rule int := 0;
  v_skip_exist int := 0;
  v_accrued int := 0;
  v_done boolean := true;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'limit', 'runId']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if p_payload ? 'limit' then
    if jsonb_typeof(p_payload -> 'limit') <> 'number' then return jsonb_build_object('ok', false, 'code', 'invalid_payload'); end if;
    v_limit := (p_payload ->> 'limit')::int;
    if v_limit < 1 or v_limit > 200 then return jsonb_build_object('ok', false, 'code', 'invalid_payload'); end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.commission.reconcile', 0));
  select * into v_existing from public.employee_commission_reconcile_runs rr where rr.idempotency_key = v_key;
  if v_existing.id is not null and v_existing.status = 'completed' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'runId', v_existing.id, 'status', 'completed',
      'scanned', v_existing.scanned, 'accrued', v_existing.accrued,
      'skippedUnproven', v_existing.skipped_unproven, 'skippedNoRule', v_existing.skipped_no_rule,
      'skippedExisting', v_existing.skipped_existing, 'erpRequests', 0, 'done', true);
  end if;
  if p_payload ? 'runId' then
    if not public.finance_json_is_uuid(p_payload -> 'runId') then return jsonb_build_object('ok', false, 'code', 'invalid_payload'); end if;
    select * into v_existing from public.employee_commission_reconcile_runs rr where rr.id = (p_payload ->> 'runId')::uuid;
    if v_existing.id is null then return jsonb_build_object('ok', false, 'code', 'invalid_payload'); end if;
    if v_existing.status = 'running' and v_existing.idempotency_key is distinct from v_key then
      return jsonb_build_object('ok', false, 'code', 'reconcile_in_progress');
    end if;
  elsif exists (select 1 from public.employee_commission_reconcile_runs rr where rr.status = 'running' and rr.idempotency_key is distinct from v_key) then
    return jsonb_build_object('ok', false, 'code', 'reconcile_in_progress');
  end if;
  if v_existing.id is null then
    insert into public.employee_commission_reconcile_runs (status, limit_rows, actor_id, idempotency_key)
    values ('running', v_limit, auth.uid(), v_key)
    returning * into v_existing;
    perform public.payroll_j5_audit('commission_reconcile_started', 'employee_commission_reconcile_run', v_existing.id,
      '{}'::jsonb, jsonb_build_object('status', 'running'), null, v_key);
  end if;
  v_run := v_existing.id;
  v_cursor := v_existing.cursor_opportunity_id;
  v_skip_unproven := v_existing.skipped_unproven;
  v_skip_rule := v_existing.skipped_no_rule;
  v_skip_exist := v_existing.skipped_existing;
  v_accrued := v_existing.accrued;

  for v_attr in
    select a.id as attribution_id, a.opportunity_id, a.employee_id, a.attribution_role
      from public.sales_opportunity_attributions a
      join public.referrals rf on rf.id = a.opportunity_id
     where rf.origin_kind = 'employee'
       and a.attribution_role in ('technician_originator', 'external_sales_originator')
       and (v_cursor is null or a.opportunity_id > v_cursor)
     order by a.opportunity_id, a.id
     limit v_limit
  loop
    v_n := v_n + 1;
    v_cursor := v_attr.opportunity_id;
    if exists (
      select 1 from public.employee_commission_entitlements e
       where e.opportunity_id = v_attr.opportunity_id and e.employee_id = v_attr.employee_id
         and e.attribution_role = v_attr.attribution_role and e.reversal_of is null
    ) then
      v_skip_exist := v_skip_exist + 1;
      continue;
    end if;
    if not exists (
      select 1 from public.employee_commission_rules ru
       where ru.active and ru.status = 'active' and ru.attribution_role = v_attr.attribution_role
    ) then
      v_skip_rule := v_skip_rule + 1;
      continue;
    end if;
    -- GATE 1: mesmo com regra ativa, modalidade permanece bloqueada nesta entrega.
    v_skip_unproven := v_skip_unproven + 1;
  end loop;

  v_done := v_n < v_limit;
  update public.employee_commission_reconcile_runs set
    scanned = scanned + v_n,
    accrued = v_accrued,
    skipped_unproven = v_skip_unproven,
    skipped_no_rule = v_skip_rule,
    skipped_existing = v_skip_exist,
    cursor_opportunity_id = v_cursor,
    status = case when v_done then 'completed' else 'paused' end,
    finished_at = case when v_done then timezone('utc', now()) else null end,
    erp_requests = 0
  where id = v_run;
  if v_done then
    perform public.payroll_j5_audit('commission_reconcile_finished', 'employee_commission_reconcile_run', v_run,
      jsonb_build_object('status', 'running'), jsonb_build_object('status', 'completed'), null, left(v_key || '_fin', 128));
  end if;
  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'runId', v_run,
    'status', case when v_done then 'completed' else 'paused' end,
    'scanned', v_existing.scanned + v_n, 'accrued', v_accrued,
    'skippedUnproven', v_skip_unproven, 'skippedNoRule', v_skip_rule,
    'skippedExisting', v_skip_exist, 'erpRequests', 0, 'done', v_done
  );
end;
$$;

create or replace function public.admin_register_payroll_payment(p_payload jsonb)
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
  v_method text;
  v_on date;
  v_ref text;
  v_note text;
  v_comp public.payroll_competences;
  v_existing uuid;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array['idempotencyKey', 'competenceId', 'paidOn', 'method', 'reference', 'note', 'reason', 'confirmed']) then
    return jsonb_build_object('ok', false, 'code', 'unknown_field');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if coalesce(p_payload ->> 'confirmed', '') <> 'true' and (p_payload -> 'confirmed') is distinct from 'true'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'confirmation_required');
  end if;
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  if v_reason is null or char_length(v_reason) < 20 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if not public.finance_json_is_uuid(p_payload -> 'competenceId') then
    return jsonb_build_object('ok', false, 'code', 'competence_not_found');
  end if;
  v_id := (p_payload ->> 'competenceId')::uuid;
  if not public.finance_json_is_date(p_payload -> 'paidOn') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_on := (p_payload ->> 'paidOn')::date;
  if v_on > public.comp_cfg_today() then return jsonb_build_object('ok', false, 'code', 'future_date'); end if;
  v_method := p_payload ->> 'method';
  if v_method is null or v_method not in ('bank_transfer', 'cash', 'payroll_batch', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payment_method');
  end if;
  v_ref := nullif(p_payload ->> 'reference', '');
  v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  select a.entity_id into v_existing from public.finance_audit_events a
   where a.idempotency_key = v_key and a.action = 'pay' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_existing, 'status', 'paid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.pay:' || v_id::text, 0));
  select * into v_comp from public.payroll_competences c where c.id = v_id and c.is_current;
  if v_comp.id is null then return jsonb_build_object('ok', false, 'code', 'competence_not_found'); end if;
  if v_comp.status = 'paid' then
    return jsonb_build_object('ok', false, 'code', 'payment_already_registered');
  end if;
  if v_comp.status <> 'closed' then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if v_comp.payment_reversed then return jsonb_build_object('ok', false, 'code', 'payment_already_registered'); end if;

  update public.payroll_competences set
    status = 'paid', paid_at = timezone('utc', now()), paid_by = auth.uid(),
    paid_on = v_on, payment_method = v_method, payment_reference = v_ref, payment_note = v_note
  where id = v_id;

  update public.employee_commission_entitlements e
     set status = 'paid', paid_at = timezone('utc', now()), paid_by = auth.uid()
   where e.status = 'included_in_payroll'
     and exists (
       select 1 from public.payroll_competence_lines l
        where l.competence_id = v_id and l.commission_entitlement_id = e.id and l.line_type = 'commission'
     );

  perform public.payroll_j5_audit('pay', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', 'closed'),
    jsonb_build_object('competence_status', 'paid', 'payment_method', v_method),
    v_reason, v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_id, 'status', 'paid');
end;
$$;

create or replace function public.admin_reverse_payroll_payment(p_payload jsonb)
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
  v_existing uuid;
  v_ent record;
  v_new uuid;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
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
   where a.idempotency_key = v_key and a.action = 'reverse' limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_existing);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.payroll.reverse:' || v_id::text, 0));
  select * into v_comp from public.payroll_competences c where c.id = v_id and c.is_current;
  if v_comp.id is null then return jsonb_build_object('ok', false, 'code', 'competence_not_found'); end if;
  if v_comp.status <> 'paid' then return jsonb_build_object('ok', false, 'code', 'not_reversed'); end if;
  if v_comp.payment_reversed then return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_id); end if;

  for v_ent in
    select e.* from public.employee_commission_entitlements e
     join public.payroll_competence_lines l on l.commission_entitlement_id = e.id
    where l.competence_id = v_id and l.line_type = 'commission' and e.status = 'paid' and e.reversal_of is null
  loop
    update public.employee_commission_entitlements set status = 'reversed' where id = v_ent.id;
    insert into public.employee_commission_entitlements (
      opportunity_id, employee_id, attribution_id, rule_id, attribution_role, trigger_kind,
      triggering_contract_pk, triggering_invoice_pk, status, amount, currency, competence_month,
      source, evidence_at, accrued_at, approved_at, approved_by, reversal_of, idempotency_key,
      rule_snapshot, evidence_snapshot
    ) values (
      v_ent.opportunity_id, v_ent.employee_id, v_ent.attribution_id, v_ent.rule_id, v_ent.attribution_role, v_ent.trigger_kind,
      v_ent.triggering_contract_pk, v_ent.triggering_invoice_pk, 'reversed', v_ent.amount, v_ent.currency, v_ent.competence_month,
      'manual_admin', v_ent.evidence_at, v_ent.accrued_at, v_ent.approved_at, v_ent.approved_by, v_ent.id,
      left(v_key || replace(v_ent.id::text, '-', ''), 128),
      v_ent.rule_snapshot, v_ent.evidence_snapshot
    ) returning id into v_new;
    perform public.payroll_j5_audit('reverse', 'employee_commission_entitlement', v_new,
      jsonb_build_object('status', 'paid'), jsonb_build_object('status', 'reversed'), v_reason, left(v_key || replace(v_ent.id::text, '-', ''), 128));
  end loop;

  update public.payroll_competences set
    payment_reversed = true, payment_reversed_at = timezone('utc', now()), payment_reversed_by = auth.uid()
  where id = v_id;
  perform public.payroll_j5_audit('reverse', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', 'paid'), jsonb_build_object('competence_status', 'paid', 'status', 'reversed'),
    v_reason, v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_id, 'status', 'paid');
end;
$$;

alter table public.employee_commission_entitlements drop constraint if exists employee_commission_entitlements_paid_chk;
alter table public.employee_commission_entitlements add constraint employee_commission_entitlements_paid_chk check (
  (status <> 'paid' or (paid_at is not null and paid_by is not null))
  and (paid_at is null) = (paid_by is null)
);

create or replace function public.trg_employee_commission_entitlements_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_allowed text[] := array['status', 'updated_at'];
begin
  if TG_OP = 'DELETE' then
    raise exception 'employee_commission_entitlements_no_delete' using errcode = 'P0001';
  elsif TG_OP = 'TRUNCATE' then
    raise exception 'employee_commission_entitlements_no_delete' using errcode = 'P0001';
  end if;
  if (NEW.opportunity_id, NEW.employee_id, NEW.attribution_id, NEW.rule_id, NEW.attribution_role,
      NEW.trigger_kind, NEW.idempotency_key, NEW.rule_snapshot, NEW.source, NEW.reversal_of,
      NEW.currency, NEW.created_at)
     is distinct from
     (OLD.opportunity_id, OLD.employee_id, OLD.attribution_id, OLD.rule_id, OLD.attribution_role,
      OLD.trigger_kind, OLD.idempotency_key, OLD.rule_snapshot, OLD.source, OLD.reversal_of,
      OLD.currency, OLD.created_at) then
    raise exception 'employee_commission_entitlement_immutable_after_accrued' using errcode = 'P0001';
  end if;
  if NEW.status is distinct from OLD.status and not (
       (OLD.status = 'pending_evidence' and NEW.status in ('accrued', 'rejected'))
    or (OLD.status = 'accrued' and NEW.status in ('approved', 'reversed', 'rejected'))
    or (OLD.status = 'approved' and NEW.status in ('included_in_payroll', 'reversed'))
    or (OLD.status = 'included_in_payroll' and NEW.status in ('paid', 'reversed'))
    or (OLD.status = 'paid' and NEW.status = 'reversed')
  ) then
    raise exception 'employee_commission_entitlement_transition_forbidden' using errcode = 'P0001';
  end if;
  if OLD.status in ('accrued', 'approved', 'included_in_payroll', 'paid', 'reversed', 'rejected') then
    if NEW.status = 'approved' and OLD.status <> 'approved' then
      v_allowed := v_allowed || array['approved_at', 'approved_by', 'competence_month'];
    elsif NEW.status = 'paid' and OLD.status <> 'paid' then
      v_allowed := v_allowed || array['paid_at', 'paid_by'];
    end if;
    if (to_jsonb(NEW) - v_allowed) is distinct from (to_jsonb(OLD) - v_allowed) then
      raise exception 'employee_commission_entitlement_immutable_after_accrued' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
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
  v_old uuid;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
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
  if v_comp.id is null then return jsonb_build_object('ok', false, 'code', 'competence_not_found'); end if;
  if v_comp.status in ('under_review', 'closed', 'paid') then
    return jsonb_build_object('ok', false, 'code', 'competence_locked');
  end if;
  if v_comp.status not in ('draft', 'calculated') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
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
    v_old := v_comp.id;
    insert into public.payroll_competences (
      employee_id, competence_month, timezone, period_start, period_end, version, is_current, status,
      idempotency_key, created_by, compensation_profile_id
    ) values (
      v_comp.employee_id, v_comp.competence_month, 'America/Sao_Paulo', v_comp.period_start, v_comp.period_end,
      v_ver, true, 'draft', v_key, auth.uid(), v_comp.compensation_profile_id
    ) returning id into v_id;
    update public.payroll_competences set is_current = false where id = v_old;
    perform public.payroll_j6_copy_commission_lines(v_old, v_id, v_key);
    select * into v_comp from public.payroll_competences c where c.id = v_id;
  end if;
  select count(*)::int into v_days from public.employee_worked_days w
   where w.employee_id = v_comp.employee_id and w.work_date between v_comp.period_start and v_comp.period_end
     and w.status = 'worked';
  if v_prof.salary_enabled then
    perform public.payroll_j5_add_auto_line(v_id, 'base_salary', v_prof.id, 1, v_prof.salary_amount, 'Salario mensal', v_prof.show_salary, 'approved_profile_snapshot', v_prof.version, null, md5(v_key || ':' || v_id::text || ':sal'));
  end if;
  if v_prof.meal_enabled and v_days > 0 then
    perform public.payroll_j5_add_auto_line(v_id, 'meal', v_prof.id, v_days, v_prof.meal_daily_amount, 'Vale-refeicao', v_prof.show_meal, 'worked_days', v_prof.version, v_days, md5(v_key || ':' || v_id::text || ':meal'));
  end if;
  if v_prof.transport_enabled then
    if v_prof.transport_method = 'monthly_fixed' then
      perform public.payroll_j5_add_auto_line(v_id, 'transport', v_prof.id, 1, v_prof.transport_amount, 'Passagem mensal', v_prof.show_transport, 'approved_profile_snapshot', v_prof.version, null, md5(v_key || ':' || v_id::text || ':tr'));
    elsif v_days > 0 then
      perform public.payroll_j5_add_auto_line(v_id, 'transport', v_prof.id, v_days, v_prof.transport_amount, 'Passagem por dia', v_prof.show_transport, 'worked_days', v_prof.version, v_days, md5(v_key || ':' || v_id::text || ':tr'));
    end if;
  end if;
  if v_prof.fuel_enabled then
    if v_prof.fuel_method = 'monthly_fixed' then
      perform public.payroll_j5_add_auto_line(v_id, 'fuel', v_prof.id, 1, v_prof.fuel_amount, 'Gasolina mensal', v_prof.show_fuel, 'approved_profile_snapshot', v_prof.version, null, md5(v_key || ':' || v_id::text || ':fuel'));
    elsif v_days > 0 then
      perform public.payroll_j5_add_auto_line(v_id, 'fuel', v_prof.id, v_days, v_prof.fuel_amount, 'Gasolina por dia', v_prof.show_fuel, 'worked_days', v_prof.version, v_days, md5(v_key || ':' || v_id::text || ':fuel'));
    end if;
  end if;
  update public.payroll_competences
     set status = 'calculated', calculated_at = timezone('utc', now()), calculated_by = auth.uid(), calculation_input_hash = v_hash
   where id = v_id;
  perform public.payroll_j5_recompute(v_id);
  perform public.payroll_j5_audit('payroll_competence_calculated', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', v_comp.status, 'version', v_comp.version),
    jsonb_build_object('competence_status', 'calculated', 'version', v_comp.version), null, v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_id, 'status', 'calculated', 'version', v_comp.version);
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
  v_existing uuid;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
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
  if v_comp.id is null then return jsonb_build_object('ok', false, 'code', 'competence_not_found'); end if;
  if v_comp.status = 'closed' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'competenceId', v_id, 'status', 'closed');
  end if;
  if v_comp.status <> 'under_review' then return jsonb_build_object('ok', false, 'code', 'invalid_status'); end if;
  if exists (
    select 1 from public.payroll_competence_lines l
     where l.competence_id = v_id and l.line_type = 'commission'
       and not exists (
         select 1 from public.employee_commission_entitlements e
          where e.id = l.commission_entitlement_id and e.status = 'included_in_payroll' and e.employee_id = v_comp.employee_id
       )
  ) then
    return jsonb_build_object('ok', false, 'code', 'totals_inconsistent');
  end if;
  perform public.payroll_j5_recompute(v_id);
  select * into v_comp from public.payroll_competences c where c.id = v_id;
  update public.payroll_competences set status = 'closed', closed_at = timezone('utc', now()), closed_by = auth.uid(), closed_reason = v_reason
   where id = v_id;
  perform public.payroll_j5_audit('payroll_competence_closed', 'payroll_competence', v_id,
    jsonb_build_object('competence_status', 'under_review', 'version', v_comp.version),
    jsonb_build_object('competence_status', 'closed', 'version', v_comp.version), v_reason, v_key);
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
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
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
  if v_comp.id is null then return jsonb_build_object('ok', false, 'code', 'competence_not_found'); end if;
  if v_comp.status = 'paid' and v_comp.payment_reversed then
    null;
  elsif v_comp.status <> 'closed' then
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
  perform public.payroll_j5_audit('reopen', 'payroll_competence', v_new,
    jsonb_build_object('competence_status', v_comp.status, 'version', v_comp.version),
    jsonb_build_object('competence_status', 'draft', 'version', v_comp.version + 1), v_reason, v_key);
  return jsonb_build_object('ok', true, 'idempotent', false, 'competenceId', v_new, 'status', 'draft', 'version', v_comp.version + 1);
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
      'competenceId', c.id, 'employeeId', c.employee_id,
      'employeeName', coalesce(nullif(btrim(p.full_name), ''), 'Funcionario'),
      'competenceMonth', c.competence_month, 'periodStart', c.period_start, 'periodEnd', c.period_end,
      'status', c.status, 'version', c.version, 'profileId', c.compensation_profile_id,
      'paidOn', c.paid_on, 'paymentMethod', c.payment_method, 'paymentReference', c.payment_reference,
      'paymentReversed', c.payment_reversed,
      'totals', jsonb_build_object(
        'salary', c.total_base_salary::text, 'benefits', c.total_benefits::text,
        'otherEarnings', c.total_other_earnings::text, 'discounts', c.total_discounts::text,
        'adjustments', c.total_adjustments::text, 'commission', c.total_commission::text,
        'gross', public.payroll_j5_round(c.total_base_salary + c.total_benefits + c.total_other_earnings + c.total_adjustments)::text,
        'net', c.net_total::text
      )
    ) into v_comp
    from public.payroll_competences c
    join public.employees e on e.id = c.employee_id
    join public.profiles p on p.id = e.profile_id
   where c.id = v_id;
  if v_comp is null then raise exception 'compensation_config_not_found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'lineId', l.id, 'type', l.line_type, 'description', l.description, 'quantity', l.quantity::text,
      'unitAmount', l.unit_amount::text, 'amount', l.amount::text, 'origin', l.line_origin,
      'visibleToEmployee', l.visible_to_employee, 'reason', l.reason, 'createdAt', l.created_at
    ) order by l.created_at, l.id), '[]'::jsonb)
    into v_lines from public.payroll_competence_lines l where l.competence_id = v_id;
  return jsonb_build_object('competence', v_comp, 'lines', v_lines);
end;
$$;

create or replace function public.admin_list_commission_entitlements(p_payload jsonb)
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
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not public.finance_jsonb_keys_allowed(p_payload, array[]::text[]) then
    raise exception 'compensation_config_invalid' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'entitlementId', e.id, 'employeeId', e.employee_id, 'opportunityId', e.opportunity_id,
      'role', e.attribution_role, 'status', e.status, 'amount', e.amount::text,
      'competenceMonth', e.competence_month, 'method', e.rule_snapshot ->> 'method',
      'triggerKind', e.trigger_kind
    ) order by e.created_at desc), '[]'::jsonb)
    into v_items
    from (select * from public.employee_commission_entitlements e0 order by e0.created_at desc limit 200) e;
  return jsonb_build_object('entitlements', coalesce(v_items, '[]'::jsonb), 'activeRuleCount',
    (select count(*) from public.employee_commission_rules where active),
    'schedulerEnabled', false);
end;
$$;

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
  v_comms jsonb;
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
      'competenceMonth', c.competence_month, 'status', c.status, 'paidOn', c.paid_on,
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
  select coalesce(jsonb_agg(jsonb_build_object(
      'opportunityId', e.opportunity_id, 'status', e.status,
      'amount', case when e.status in ('accrued', 'approved', 'included_in_payroll', 'paid', 'reversed') then e.amount end,
      'competenceMonth', e.competence_month, 'method', e.rule_snapshot ->> 'method'
    ) order by e.created_at desc), '[]'::jsonb)
    into v_comms
    from (
      select e0.* from public.employee_commission_entitlements e0
       where e0.employee_id = v_self.employee_id
         and (e0.status not in ('included_in_payroll', 'paid') or exists (
           select 1 from public.payroll_competence_lines l
            where l.commission_entitlement_id = e0.id and l.visible_to_employee
         ))
       order by e0.created_at desc limit 50
    ) e;
  return jsonb_build_object(
    'employeeStatus', v_self.employee_status, 'readOnly', v_self.employee_status <> 'active',
    'profile', v_profile, 'competences', v_items, 'commissions', coalesce(v_comms, '[]'::jsonb),
    'total', v_total, 'limit', p_limit, 'offset', p_offset, 'commissionStatus', 'ledger'
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
  select c.id, c.competence_month, c.status, c.version, c.paid_on into v_comp
  from public.payroll_competences c
  where c.employee_id = v_self.employee_id and c.is_current and c.competence_month = p_competence_month;
  if v_comp.id is null then raise exception 'employee_portal_not_found' using errcode = 'P0001'; end if;
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
  return jsonb_build_object(
    'competenceMonth', v_comp.competence_month, 'status', v_comp.status, 'version', v_comp.version,
    'paidOn', v_comp.paid_on, 'components', v_components,
    'commissionStatus', case when v_components ? 'commission' then 'listed' else 'none' end,
    'total', jsonb_build_object('kind', case when v_comp.status in ('closed', 'paid') then 'closed' else 'expected' end, 'amount', v_total),
    'lines', v_lines
  );
end;
$$;

create or replace function public.employee_portal_line_visible(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive chain as (
    select l.id, l.line_type, l.compensation_profile_id, l.reversal_of_line_id, l.visible_to_employee, 0 depth
    from public.payroll_competence_lines l where l.id = p_line_id
    union all
    select o.id, o.line_type, o.compensation_profile_id, o.reversal_of_line_id, o.visible_to_employee, c.depth + 1
    from chain c join public.payroll_competence_lines o on o.id = c.reversal_of_line_id
    where c.line_type = 'reversal' and c.depth < 5
  )
  select coalesce((
    select case
      when c.line_type = 'commission' then coalesce(c.visible_to_employee, false)
      when c.line_type in ('other_earning', 'discount', 'adjustment') then true
      when c.line_type = 'base_salary' then coalesce(p.salary_enabled and p.show_salary, false)
      when c.line_type = 'meal' then coalesce(p.meal_enabled and p.show_meal, false)
      when c.line_type = 'transport' then coalesce(p.transport_enabled and p.show_transport, false)
      when c.line_type = 'fuel' then coalesce(p.fuel_enabled and p.show_fuel, false)
      else false end
    from chain c left join public.employee_compensation_profiles p on p.id = c.compensation_profile_id
    where c.line_type <> 'reversal'
    order by c.depth desc limit 1
  ), false);
$$;

revoke all on function public.admin_approve_commission_rule(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_activate_commission_rule(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_approve_commission_entitlement(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_include_commission_in_payroll(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_reconcile_employee_commissions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_register_payroll_payment(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_reverse_payroll_payment(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_commission_entitlements(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_commission_rule(jsonb) to authenticated;
grant execute on function public.admin_activate_commission_rule(jsonb) to authenticated;
grant execute on function public.admin_approve_commission_entitlement(jsonb) to authenticated;
grant execute on function public.admin_include_commission_in_payroll(jsonb) to authenticated;
grant execute on function public.admin_reconcile_employee_commissions(jsonb) to authenticated;
grant execute on function public.admin_register_payroll_payment(jsonb) to authenticated;
grant execute on function public.admin_reverse_payroll_payment(jsonb) to authenticated;
grant execute on function public.admin_list_commission_entitlements(jsonb) to authenticated;
revoke all on function public.admin_calculate_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_close_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_reopen_payroll_competence(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_payroll_competence(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_calculate_payroll_competence(jsonb) to authenticated;
grant execute on function public.admin_close_payroll_competence(jsonb) to authenticated;
grant execute on function public.admin_reopen_payroll_competence(jsonb) to authenticated;
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

