-- 3.1F-J7 preflight (somente leitura).
select 'prereq_activate' as metric, (to_regprocedure('public.admin_activate_commission_rule(jsonb)') is not null)::text as value
union all select 'prereq_reconcile', (to_regprocedure('public.admin_reconcile_employee_commissions(jsonb)') is not null)::text
union all select 'prereq_method_gate', (to_regprocedure('public.commission_j6_method_activatable(text)') is not null)::text
union all select 'prereq_calc', (to_regprocedure('public.commission_j6_calculate(text,numeric,numeric,numeric)') is not null)::text
union all select 'prereq_contract_identity', (
  exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='referrals' and column_name='brbyte_id_contrato'))::text
union all select 'percentage_blocked', (public.commission_j6_method_activatable('percentage') = false)::text
union all select 'first_invoice_blocked', (public.commission_j6_method_activatable('first_invoice_value') = false)::text
union all select 'count_active_rules', (select count(*)::text from public.employee_commission_rules where active or status = 'active')
union all select 'count_entitlements', (select count(*)::text from public.employee_commission_entitlements)
union all select 'count_rewards', (select count(*)::text from public.rewards)
union all select 'count_wallet_tx', (select count(*)::text from public.wallet_transactions)
union all select 'eligible_employee_opportunities', (
  select count(*)::text from public.referrals rf
   where rf.origin_kind = 'employee'
     and rf.brbyte_id_contrato ~ '^[0-9]{1,20}$'
     and exists (
       select 1 from public.sales_opportunity_attributions a
        where a.opportunity_id = rf.id
          and a.attribution_role in ('technician_originator', 'external_sales_originator')
     )
);
