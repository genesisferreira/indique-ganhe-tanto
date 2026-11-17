-- 3.1F-J15B: comissão fixa idempotente para o cron, sem reward e sem percentual.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.cron_accrue_fixed_commission(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_origin text;
  v_contract text;
  v_invoice text;
  v_employee uuid;
  v_role text;
  v_attr_id uuid;
  v_partner uuid;
  v_rule public.employee_commission_rules;
  v_partner_rule public.partner_merchant_rules;
  v_amt numeric(10,2);
  v_ent uuid;
  v_key text;
begin
  if p_referral_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_referral');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.fixed.' || p_referral_id::text, 0));
  select rf.origin_kind,
         coalesce(rf.brbyte_contract_pk, rf.brbyte_id_contrato),
         rf.brbyte_first_invoice_pk
    into v_origin, v_contract, v_invoice
    from public.referrals rf
   where rf.id = p_referral_id
   for update;
  if v_origin is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_origin not in ('employee', 'partner_merchant') then
    return jsonb_build_object('ok', true, 'accrued', 0, 'code', 'not_fixed_origin');
  end if;
  if v_contract is null or v_contract !~ '^[0-9]{1,18}$' or v_invoice is null or v_invoice !~ '^[0-9]{1,18}$' then
    return jsonb_build_object('ok', true, 'accrued', 0, 'code', 'invoice_not_ready');
  end if;

  if v_origin = 'employee' then
    select a.id, a.employee_id, a.attribution_role
      into v_attr_id, v_employee, v_role
      from public.sales_opportunity_attributions a
     where a.opportunity_id = p_referral_id
       and a.attribution_role in ('technician_originator', 'external_sales_originator')
     order by a.created_at
     limit 1;
    if v_attr_id is null then
      return jsonb_build_object('ok', true, 'accrued', 0, 'code', 'attribution_missing');
    end if;
    if exists (
      select 1 from public.employee_commission_entitlements e
       where e.opportunity_id = p_referral_id
         and e.employee_id = v_employee
         and e.attribution_role = v_role
         and e.reversal_of is null
    ) then
      return jsonb_build_object('ok', true, 'accrued', 0, 'idempotent', true);
    end if;
    select * into v_rule
      from public.employee_commission_rules ru
     where ru.active and ru.status = 'active'
       and ru.method = 'fixed_amount'
       and ru.trigger_kind = 'first_valid_invoice_generated'
       and ru.attribution_role = v_role
       and ru.effective_from <= public.comp_cfg_today()
       and (ru.effective_until is null or ru.effective_until >= public.comp_cfg_today())
     order by ru.effective_from desc, ru.version desc
     limit 1;
    if v_rule.id is null then
      return jsonb_build_object('ok', true, 'accrued', 0, 'code', 'rule_inactive');
    end if;
    v_amt := public.commission_j6_calculate('fixed_amount', v_rule.fixed_amount, null, null);
    if v_amt is null or v_amt <= 0 then
      return jsonb_build_object('ok', true, 'accrued', 0, 'code', 'invalid_rule_amount');
    end if;
    v_key := left('j15b' || replace(p_referral_id::text, '-', '') || replace(v_employee::text, '-', '') || replace(v_rule.id::text, '-', ''), 128);
    begin
      insert into public.employee_commission_entitlements (
        opportunity_id, employee_id, attribution_id, rule_id, attribution_role, trigger_kind,
        triggering_contract_pk, triggering_invoice_pk, status, amount, currency, source,
        evidence_at, accrued_at, idempotency_key, rule_snapshot, evidence_snapshot
      ) values (
        p_referral_id, v_employee, v_attr_id, v_rule.id,
        v_role, 'first_valid_invoice_generated',
        v_contract, v_invoice, 'accrued', v_amt, 'BRL', 'future_invoice_evaluation',
        timezone('utc', now()), timezone('utc', now()), v_key,
        jsonb_build_object('method', 'fixed_amount', 'amount', trim(to_char(v_amt, 'FM99999990.00'))),
        jsonb_build_object('evidenceKind', 'crm_persisted', 'fullPaymentProven', false, 'invoiceDeleted', false)
      ) returning id into v_ent;
    exception when unique_violation then
      return jsonb_build_object('ok', true, 'accrued', 0, 'idempotent', true);
    end;
    perform public.payroll_j5_audit(
      'entitlement_accrued', 'employee_commission_entitlement', v_ent,
      '{}'::jsonb, jsonb_build_object('status', 'accrued', 'method', 'fixed_amount'), null, v_key
    );
    return jsonb_build_object('ok', true, 'accrued', 1, 'entitlementId', v_ent);
  end if;

  select a.partner_merchant_id into v_partner
    from public.partner_merchant_attributions a
   where a.opportunity_id = p_referral_id
   limit 1;
  if v_partner is null then
    return jsonb_build_object('ok', true, 'accrued', 0, 'code', 'attribution_missing');
  end if;
  if exists (
    select 1 from public.partner_commission_entitlements e
     where e.partner_merchant_id = v_partner
       and e.opportunity_id = p_referral_id
       and e.trigger_kind = 'invoice_generated'
  ) then
    return jsonb_build_object('ok', true, 'accrued', 0, 'idempotent', true);
  end if;
  select * into v_partner_rule
    from public.partner_merchant_rules r
   where r.partner_merchant_id = v_partner
   order by r.version desc
   limit 1;
  if v_partner_rule.id is null or v_partner_rule.kind is distinct from 'fixed_amount' or v_partner_rule.status is distinct from 'configured' then
    return jsonb_build_object('ok', true, 'accrued', 0, 'code', 'rule_inactive');
  end if;
  perform set_config('igt.partner_entitlement_reconcile', 'on', true);
  insert into public.partner_commission_entitlements (
    partner_merchant_id, opportunity_id, rule_id, trigger_kind, evidence_invoice_pk
  ) values (
    v_partner, p_referral_id, v_partner_rule.id, 'invoice_generated', v_invoice
  );
  perform set_config('igt.partner_entitlement_reconcile', 'off', true);
  perform public.partner_audit(
    'partner_entitlement_accrued', v_partner, p_referral_id, null,
    jsonb_build_object('kind', 'fixed_amount', 'trigger', 'invoice_generated', 'status', 'accrued')
  );
  return jsonb_build_object('ok', true, 'accrued', 1);
end;
$$;

revoke all on function public.cron_accrue_fixed_commission(uuid) from public, anon, authenticated;
grant execute on function public.cron_accrue_fixed_commission(uuid) to service_role;

commit;
