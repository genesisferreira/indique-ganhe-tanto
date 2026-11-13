-- Sprint 3.1F-J7 — ativacao controlada SOMENTE de comissao fixa.
-- Evidencia: fatura valida persistida (contrato + invoice_pk) na oportunidade employee.
-- Sem ordem da primeira fatura, sem valor, sem pagamento, sem invoice/list, sem ERP, sem cron.
-- percentage e first_invoice_value permanecem bloqueadas. Sem rewards/wallet.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.admin_activate_commission_rule(jsonb)') is null
     or to_regprocedure('public.admin_reconcile_employee_commissions(jsonb)') is null
     or to_regprocedure('public.commission_j6_method_activatable(text)') is null
     or to_regprocedure('public.commission_j6_calculate(text,numeric,numeric,numeric)') is null
     or to_regclass('public.employee_commission_entitlements') is null
     or to_regclass('public.employee_commission_reconcile_runs') is null then
    raise exception 'j7_prerequisite_missing: aplicar 3.1F-J6 antes';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referrals' and column_name = 'brbyte_id_contrato'
  ) then
    raise exception 'j7_prerequisite_missing: identidade de contrato persistida ausente';
  end if;
end$$;

alter table public.referrals add column if not exists brbyte_contract_pk text;
alter table public.referrals add column if not exists brbyte_first_invoice_pk text;
alter table public.referrals add column if not exists brbyte_first_invoice_payload jsonb;

-- GATE: somente fixed_amount. percentage / first_invoice_value continuam recusadas.
create or replace function public.commission_j6_method_activatable(p_method text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_method = 'fixed_amount';
$$;

create or replace function public.commission_j6_method_block_reason(p_method text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_method
    when 'percentage' then 'percentage_base_not_proven'
    when 'first_invoice_value' then 'full_payment_unproven'
    when 'fixed_amount' then 'ok'
    else 'method_not_activatable'
  end;
$$;

-- Evidencia persistida: oportunidade employee + contrato + invoice_pk valido e nao cancelado/excluido.
-- Nao le valor, nao le pagamento, nao consulta invoice/list.
create or replace function public.commission_j7_employee_invoice_evidence(p_opportunity uuid)
returns table(contract_pk text, invoice_pk text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(rf.brbyte_contract_pk, rf.brbyte_id_contrato) as contract_pk,
         rf.brbyte_first_invoice_pk as invoice_pk
    from public.referrals rf
   where rf.id = p_opportunity
     and rf.origin_kind = 'employee'
     and coalesce(rf.brbyte_contract_pk, rf.brbyte_id_contrato) ~ '^[0-9]{1,20}$'
     and rf.brbyte_first_invoice_pk ~ '^[0-9]{1,20}$'
     and not (
       coalesce((rf.brbyte_first_invoice_payload -> 'invoice_deleted') = 'true'::jsonb, false)
       or coalesce(rf.brbyte_first_invoice_payload ->> 'invoice_deleted' in ('true', 't', '1'), false)
       or coalesce((rf.brbyte_first_invoice_payload -> 'info' -> 'invoice_deleted') = 'true'::jsonb, false)
       or coalesce((rf.brbyte_first_invoice_payload -> 'info' ->> 'invoice_deleted') in ('true', 't', '1'), false)
       or lower(coalesce(rf.brbyte_first_invoice_payload ->> 'invoice_msg', '')) ~ '(cancel|exclu|delet)'
       or lower(coalesce(rf.brbyte_first_invoice_payload -> 'info' ->> 'invoice_msg', '')) ~ '(cancel|exclu|delet)'
     );
$$;

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
  'entitlement_accrued',
  'entitlement_approved',
  'entitlement_included'
));

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
  v_rule public.employee_commission_rules;
  v_contract_pk text;
  v_invoice_pk text;
  v_n int := 0;
  v_skip_unproven int := 0;
  v_skip_rule int := 0;
  v_skip_exist int := 0;
  v_accrued int := 0;
  v_done boolean := true;
  v_today date := public.comp_cfg_today();
  v_amt numeric(10,2);
  v_ent_id uuid;
  v_ent_key text;
  v_snap jsonb;
  v_evidence jsonb;
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
    perform pg_advisory_xact_lock(hashtextextended(
      'igt.entitlement.accrue:' || v_attr.opportunity_id::text || ':' || v_attr.employee_id::text, 0));
    if exists (
      select 1 from public.employee_commission_entitlements e
       where e.opportunity_id = v_attr.opportunity_id and e.employee_id = v_attr.employee_id
         and e.attribution_role = v_attr.attribution_role and e.reversal_of is null
    ) then
      v_skip_exist := v_skip_exist + 1;
      continue;
    end if;

    v_rule := null;
    select * into v_rule
      from public.employee_commission_rules ru
     where ru.active and ru.status = 'active'
       and ru.method = 'fixed_amount'
       and ru.trigger_kind = 'first_valid_invoice_generated'
       and ru.attribution_role = v_attr.attribution_role
       and ru.effective_from <= v_today
       and (ru.effective_until is null or ru.effective_until >= v_today)
     order by ru.effective_from desc, ru.version desc
     limit 1;
    if v_rule.id is null then
      v_skip_rule := v_skip_rule + 1;
      continue;
    end if;

    v_contract_pk := null;
    v_invoice_pk := null;
    select ev.contract_pk, ev.invoice_pk into v_contract_pk, v_invoice_pk
      from public.commission_j7_employee_invoice_evidence(v_attr.opportunity_id) ev;
    if v_invoice_pk is null or v_contract_pk is null then
      v_skip_unproven := v_skip_unproven + 1;
      continue;
    end if;

    v_amt := public.commission_j6_calculate('fixed_amount', v_rule.fixed_amount, null, null);
    if v_amt is null or v_amt <= 0 then
      v_skip_unproven := v_skip_unproven + 1;
      continue;
    end if;

    v_ent_key := left(
      'j7fix' || replace(v_attr.opportunity_id::text, '-', '')
              || replace(v_attr.employee_id::text, '-', '')
              || replace(v_rule.id::text, '-', ''),
      128
    );
    v_snap := jsonb_build_object(
      'ruleId', v_rule.id,
      'ruleVersion', v_rule.version,
      'method', v_rule.method,
      'trigger', v_rule.trigger_kind,
      'fixedAmount', trim(to_char(v_rule.fixed_amount, 'FM99999990.00')),
      'attributionRole', v_rule.attribution_role,
      'currency', v_rule.currency,
      'effectiveFrom', to_char(v_rule.effective_from, 'YYYY-MM-DD')
    );
    v_evidence := jsonb_build_object(
      'evidenceKind', 'crm_persisted',
      'evidenceSource', 'crm_persisted',
      'contractIdentityPresent', true,
      'invoiceIdentityPresent', true,
      'fullPaymentProven', false,
      'firstInvoiceOrderProven', false,
      'invoiceDeleted', false,
      'evidenceVersion', 1,
      'triggerKind', 'first_valid_invoice_generated'
    );

    begin
      insert into public.employee_commission_entitlements (
        opportunity_id, employee_id, attribution_id, rule_id, attribution_role, trigger_kind,
        triggering_contract_pk, triggering_invoice_pk, status, amount, currency, source,
        evidence_at, accrued_at, idempotency_key, rule_snapshot, evidence_snapshot
      ) values (
        v_attr.opportunity_id, v_attr.employee_id, v_attr.attribution_id, v_rule.id,
        v_attr.attribution_role, 'first_valid_invoice_generated',
        v_contract_pk, v_invoice_pk, 'accrued', v_amt, 'BRL', 'future_invoice_evaluation',
        timezone('utc', now()), timezone('utc', now()), v_ent_key, v_snap, v_evidence
      ) returning id into v_ent_id;
      perform public.payroll_j5_audit(
        'entitlement_accrued', 'employee_commission_entitlement', v_ent_id,
        '{}'::jsonb,
        jsonb_build_object('status', 'accrued', 'amount', trim(to_char(v_amt, 'FM99999990.00')), 'method', 'fixed_amount'),
        null, v_ent_key
      );
      v_accrued := v_accrued + 1;
    exception
      when unique_violation then
        v_skip_exist := v_skip_exist + 1;
    end;
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

revoke all on function public.commission_j6_method_activatable(text) from public, anon, authenticated, service_role;
revoke all on function public.commission_j6_method_block_reason(text) from public, anon, authenticated, service_role;
revoke all on function public.commission_j7_employee_invoice_evidence(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_reconcile_employee_commissions(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_reconcile_employee_commissions(jsonb) to authenticated;

commit;
