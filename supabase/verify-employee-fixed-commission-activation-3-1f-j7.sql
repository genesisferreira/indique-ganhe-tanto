select 'fixed_activatable' as check_name, (public.commission_j6_method_activatable('fixed_amount') = true) as ok
union all select 'percentage_blocked', (public.commission_j6_method_activatable('percentage') = false)
union all select 'first_invoice_blocked', (public.commission_j6_method_activatable('first_invoice_value') = false)
union all select 'percentage_reason', (public.commission_j6_method_block_reason('percentage') = 'percentage_base_not_proven')
union all select 'first_invoice_reason', (public.commission_j6_method_block_reason('first_invoice_value') = 'full_payment_unproven')
union all select 'evidence_helper', (to_regprocedure('public.commission_j7_employee_invoice_evidence(uuid)') is not null)
union all select 'evidence_helper_revoked', (
  not has_function_privilege('anon', 'public.commission_j7_employee_invoice_evidence(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.commission_j7_employee_invoice_evidence(uuid)', 'execute')
)
union all select 'reconcile_security_definer', (
  select prosecdef and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where proname='admin_reconcile_employee_commissions' and pronamespace='public'::regnamespace)
union all select 'reconcile_grant_auth', (has_function_privilege('authenticated', 'public.admin_reconcile_employee_commissions(jsonb)', 'execute'))
union all select 'reconcile_no_anon', (not has_function_privilege('anon', 'public.admin_reconcile_employee_commissions(jsonb)', 'execute'))
union all select 'activate_security_definer', (
  select prosecdef and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where proname='admin_activate_commission_rule' and pronamespace='public'::regnamespace)
union all select 'audit_entitlement_accrued', (
  select pg_get_constraintdef(oid) like '%entitlement_accrued%'
  from pg_constraint where conname='finance_audit_events_action_chk')
union all select 'reconcile_no_invoice_list', (
  position('invoice/list' in lower(pg_get_functiondef('public.admin_reconcile_employee_commissions(jsonb)'::regprocedure))) = 0
  and position('listcontractinvoices' in lower(pg_get_functiondef('public.admin_reconcile_employee_commissions(jsonb)'::regprocedure))) = 0
)
union all select 'reconcile_no_erp_http', (
  position('http' in lower(pg_get_functiondef('public.admin_reconcile_employee_commissions(jsonb)'::regprocedure))) = 0
  and position('net.' in lower(pg_get_functiondef('public.admin_reconcile_employee_commissions(jsonb)'::regprocedure))) = 0
)
union all select 'erp_zero_chk', (exists (select 1 from pg_constraint where conname='employee_commission_reconcile_runs_erp_zero_chk'))
union all select 'zero_active_rules', ((select count(*) from public.employee_commission_rules where active or status='active') = 0)
union all select 'zero_entitlements', ((select count(*) from public.employee_commission_entitlements) = 0)
union all select 'round_fixed', (public.commission_j6_calculate('fixed_amount', 30, null, null) = 30.00)
union all select 'invoice_pk_column', (
  exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='referrals' and column_name='brbyte_first_invoice_pk'));
