select 'foundation_inactive_dropped' as check_name, (not exists (select 1 from pg_constraint where conname='employee_commission_rules_foundation_inactive_chk')) as ok
union all select 'no_pay_dropped', (not exists (select 1 from pg_constraint where conname='payroll_competences_foundation_no_pay_chk'))
union all select 'activate_rpc', (to_regprocedure('public.admin_activate_commission_rule(jsonb)') is not null)
union all select 'approve_rule_rpc', (to_regprocedure('public.admin_approve_commission_rule(jsonb)') is not null)
union all select 'reconcile_rpc', (to_regprocedure('public.admin_reconcile_employee_commissions(jsonb)') is not null)
union all select 'pay_rpc', (to_regprocedure('public.admin_register_payroll_payment(jsonb)') is not null)
union all select 'reverse_rpc', (to_regprocedure('public.admin_reverse_payroll_payment(jsonb)') is not null)
union all select 'include_rpc', (to_regprocedure('public.admin_include_commission_in_payroll(jsonb)') is not null)
union all select 'method_gate_false', (public.commission_j6_method_activatable('fixed_amount') = false
  and public.commission_j6_method_activatable('percentage') = false
  and public.commission_j6_method_activatable('first_invoice_value') = false)
union all select 'activate_security_definer', (
  select prosecdef and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where proname='admin_activate_commission_rule' and pronamespace='public'::regnamespace)
union all select 'pay_security_definer', (
  select prosecdef and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where proname='admin_register_payroll_payment' and pronamespace='public'::regnamespace)
union all select 'activate_grant_auth', (has_function_privilege('authenticated', 'public.admin_activate_commission_rule(jsonb)', 'execute'))
union all select 'activate_no_anon', (not has_function_privilege('anon', 'public.admin_activate_commission_rule(jsonb)', 'execute'))
union all select 'pay_grant_auth', (has_function_privilege('authenticated', 'public.admin_register_payroll_payment(jsonb)', 'execute'))
union all select 'pay_no_anon', (not has_function_privilege('anon', 'public.admin_register_payroll_payment(jsonb)', 'execute'))
union all select 'legacy_create_revoked', (not exists (
  select 1 from information_schema.routine_privileges
  where routine_schema='public' and routine_name='create_commission_rule_draft'
    and grantee in ('authenticated','anon','PUBLIC') and privilege_type='EXECUTE'))
union all select 'reconcile_rls', (select relrowsecurity from pg_class where oid='public.employee_commission_reconcile_runs'::regclass)
union all select 'zero_active_rules', ((select count(*) from public.employee_commission_rules where active or status='active') = 0)
union all select 'zero_entitlements', ((select count(*) from public.employee_commission_entitlements) = 0)
union all select 'zero_paid', ((select count(*) from public.payroll_competences where status='paid') = 0)
union all select 'round_half_away', (public.commission_j6_calculate('percentage', null, 0.020000, 0.25) = 0.01
  and public.commission_j6_calculate('fixed_amount', 30, null, null) = 30.00);
