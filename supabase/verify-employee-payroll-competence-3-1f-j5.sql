-- 3.1F-J5 verify (read-only).
select 'approve_rpc'::text as check_name,
  (to_regprocedure('public.admin_approve_employee_compensation(jsonb)') is not null
   and has_function_privilege('authenticated', 'public.admin_approve_employee_compensation(jsonb)', 'execute')
   and not has_function_privilege('anon', 'public.admin_approve_employee_compensation(jsonb)', 'execute')) as ok
union all select 'worked_days_rpc',
  (to_regprocedure('public.admin_save_employee_worked_days(jsonb)') is not null
   and has_function_privilege('authenticated', 'public.admin_save_employee_worked_days(jsonb)', 'execute'))
union all select 'open_rpc', (to_regprocedure('public.admin_open_payroll_competence(jsonb)') is not null)
union all select 'calculate_rpc', (to_regprocedure('public.admin_calculate_payroll_competence(jsonb)') is not null)
union all select 'review_rpc', (to_regprocedure('public.admin_review_payroll_competence(jsonb)') is not null)
union all select 'adjust_rpc', (to_regprocedure('public.admin_add_payroll_manual_line(jsonb)') is not null)
union all select 'close_rpc', (to_regprocedure('public.admin_close_payroll_competence(jsonb)') is not null)
union all select 'reopen_rpc', (to_regprocedure('public.admin_reopen_payroll_competence(jsonb)') is not null)
union all select 'legacy_still_revoked',
  (not has_function_privilege('authenticated', 'public.record_employee_worked_day(text,uuid,date,text,boolean)', 'execute')
   and not has_function_privilege('authenticated', 'public.open_payroll_competence_draft(text,uuid,date)', 'execute')
   and not has_function_privilege('authenticated', 'public.add_manual_payroll_adjustment(text,uuid,text,numeric,text,text)', 'execute')
   and not has_function_privilege('authenticated', 'public.create_commission_rule_draft(text,uuid,text,text,text,numeric,numeric,text,date,date)', 'execute')
   and not has_function_privilege('authenticated', 'public.version_commission_rule_draft(text,uuid,text,text,numeric,numeric,text,date,date)', 'execute')
   and not has_function_privilege('authenticated', 'public.configure_employee_compensation_draft(text,uuid,date,date,numeric,numeric,numeric,text,numeric,text,boolean,boolean,boolean,boolean)', 'execute'))
union all select 'one_approved_index', (exists (select 1 from pg_class where relname='employee_compensation_profiles_one_approved_uidx'))
union all select 'no_pay_chk', (exists (select 1 from pg_constraint where conname='payroll_competences_foundation_no_pay_chk'))
union all select 'no_close_pay_chk_removed', (not exists (select 1 from pg_constraint where conname='payroll_competences_foundation_no_close_pay_chk'))
union all select 'profile_inactive_chk_kept', (exists (select 1 from pg_constraint where conname='employee_compensation_profiles_foundation_inactive_chk'))
union all select 'rule_inactive_chk_kept', (exists (select 1 from pg_constraint where conname='employee_commission_rules_foundation_inactive_chk'))
union all select 'rls_financial_tables', not exists (
  select 1 from pg_class c
  where c.oid in ('public.employee_commission_rules'::regclass, 'public.employee_compensation_profiles'::regclass,
                  'public.finance_audit_events'::regclass, 'public.employee_commission_entitlements'::regclass,
                  'public.payroll_competences'::regclass, 'public.payroll_competence_lines'::regclass,
                  'public.employee_worked_days'::regclass)
    and (not c.relrowsecurity
         or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')
         or has_table_privilege('anon', c.oid, 'select,insert,update,delete'))
)
union all select 'no_active_rules', (select count(*) = 0 from public.employee_commission_rules where active or status = 'active')
union all select 'no_active_profiles', (select count(*) = 0 from public.employee_compensation_profiles where status = 'active')
union all select 'no_entitlements', (select count(*) = 0 from public.employee_commission_entitlements)
union all select 'no_paid', (select count(*) = 0 from public.payroll_competences where status = 'paid')
union all select 'audit_has_segregation', (select pg_get_constraintdef(oid) like '%segregation_override%' from pg_constraint where conname='finance_audit_events_action_chk')
union all select 'status_has_approved', (select pg_get_constraintdef(oid) like '%approved%' from pg_constraint where conname='employee_compensation_profiles_status_chk')
union all select 'status_has_under_review', (select pg_get_constraintdef(oid) like '%under_review%' from pg_constraint where conname='payroll_competences_status_chk');
