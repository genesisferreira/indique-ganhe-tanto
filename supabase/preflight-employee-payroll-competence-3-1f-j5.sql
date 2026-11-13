-- 3.1F-J5 preflight (read-only). Sem escrita. Sem COMMIT de dados.
select 'prereq_profiles'::text as metric, (to_regclass('public.employee_compensation_profiles') is not null)::text as value
union all select 'prereq_worked_days', (to_regclass('public.employee_worked_days') is not null)::text
union all select 'prereq_competences', (to_regclass('public.payroll_competences') is not null)::text
union all select 'prereq_lines', (to_regclass('public.payroll_competence_lines') is not null)::text
union all select 'prereq_audit', (to_regclass('public.finance_audit_events') is not null)::text
union all select 'prereq_j4_save', (to_regprocedure('public.admin_save_employee_compensation_draft(jsonb)') is not null)::text
union all select 'prereq_actor', (to_regprocedure('public.finance_admin_actor_role()') is not null)::text
union all select 'prereq_profile_inactive_chk', (exists (select 1 from pg_constraint where conname='employee_compensation_profiles_foundation_inactive_chk'))::text
union all select 'prereq_rule_inactive_chk', (exists (select 1 from pg_constraint where conname='employee_commission_rules_foundation_inactive_chk'))::text
union all select 'existing_j5_approve', (to_regprocedure('public.admin_approve_employee_compensation(jsonb)') is not null)::text
union all select 'existing_j5_open', (to_regprocedure('public.admin_open_payroll_competence(jsonb)') is not null)::text
union all select 'legacy_worked_day_execute', (has_function_privilege('authenticated', 'public.record_employee_worked_day(text,uuid,date,text,boolean)', 'execute'))::text
union all select 'legacy_open_execute', (has_function_privilege('authenticated', 'public.open_payroll_competence_draft(text,uuid,date)', 'execute'))::text
union all select 'legacy_adjust_execute', (has_function_privilege('authenticated', 'public.add_manual_payroll_adjustment(text,uuid,text,numeric,text,text)', 'execute'))::text
union all select 'count_active_rules', (select count(*)::text from public.employee_commission_rules where active or status = 'active')
union all select 'count_active_profiles', (select count(*)::text from public.employee_compensation_profiles where status = 'active')
union all select 'count_entitlements', (select count(*)::text from public.employee_commission_entitlements)
union all select 'count_competences', (select count(*)::text from public.payroll_competences)
union all select 'count_lines', (select count(*)::text from public.payroll_competence_lines)
union all select 'count_worked_days', (select count(*)::text from public.employee_worked_days)
union all select 'count_paid', (select count(*)::text from public.payroll_competences where status = 'paid');
