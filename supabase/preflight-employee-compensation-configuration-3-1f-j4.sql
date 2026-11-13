-- 3.1F-J4 preflight (SOMENTE LEITURA). Executar em BEGIN READ ONLY ... ROLLBACK. Saída: metric/value.
select 'prereq_employee_commission_rules' metric, (to_regclass('public.employee_commission_rules') is not null)::text value
union all select 'prereq_employee_compensation_profiles', (to_regclass('public.employee_compensation_profiles') is not null)::text
union all select 'prereq_finance_audit_events', (to_regclass('public.finance_audit_events') is not null)::text
union all select 'prereq_finance_admin_actor_role', (to_regprocedure('public.finance_admin_actor_role()') is not null)::text
union all select 'prereq_finance_audit_log', (to_regprocedure('public.finance_audit_log(text,text,uuid,jsonb,jsonb,text,text)') is not null)::text
union all select 'prereq_employee_portal_self', (to_regprocedure('public.employee_portal_self()') is not null)::text
union all select 'prereq_rules_foundation_inactive_chk', (exists (select 1 from pg_constraint where conname='employee_commission_rules_foundation_inactive_chk'))::text
union all select 'prereq_rules_no_retroactive_chk', (exists (select 1 from pg_constraint where conname='employee_commission_rules_no_retroactive_chk'))::text
union all select 'prereq_profiles_foundation_inactive_chk', (exists (select 1 from pg_constraint where conname='employee_compensation_profiles_foundation_inactive_chk'))::text
union all select 'prereq_audit_action_chk', (exists (select 1 from pg_constraint where conname='finance_audit_events_action_chk'))::text
union all select 'existing_j4_functions', (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname in (
  'admin_save_commission_rule_draft','admin_archive_commission_rule_draft','admin_save_employee_compensation_draft',
  'admin_archive_employee_compensation_draft','admin_list_commission_rules','admin_list_compensation_employees',
  'admin_get_employee_compensation','employee_compensation_preview','trg_employee_commission_rules_no_overlap'))
union all select 'existing_j4_columns', (select count(*)::text from information_schema.columns where table_schema='public'
  and ((table_name='employee_commission_rules' and column_name in ('rule_name','description','change_reason','request_hash'))
    or (table_name='employee_compensation_profiles' and column_name in ('notes','change_reason','request_hash'))))
union all select 'existing_j4_one_draft_index', (to_regclass('public.employee_compensation_profiles_one_draft_uidx') is not null)::text
union all select 'legacy_rule_rpc_authenticated_execute', (has_function_privilege('authenticated','public.create_commission_rule_draft(text,uuid,text,text,text,numeric,numeric,text,date,date)','execute'))::text
union all select 'legacy_competence_rpc_authenticated_execute', (has_function_privilege('authenticated','public.open_payroll_competence_draft(text,uuid,date)','execute'))::text
union all select 'count_employee_commission_rules', (select count(*)::text from public.employee_commission_rules)
union all select 'count_employee_commission_entitlements', (select count(*)::text from public.employee_commission_entitlements)
union all select 'count_employee_compensation_profiles', (select count(*)::text from public.employee_compensation_profiles)
union all select 'count_employee_worked_days', (select count(*)::text from public.employee_worked_days)
union all select 'count_payroll_competences', (select count(*)::text from public.payroll_competences)
union all select 'count_payroll_competence_lines', (select count(*)::text from public.payroll_competence_lines)
union all select 'count_finance_audit_events', (select count(*)::text from public.finance_audit_events)
union all select 'active_commission_rules', (select count(*)::text from public.employee_commission_rules where active or status = 'active')
union all select 'active_compensation_profiles', (select count(*)::text from public.employee_compensation_profiles where status = 'active');
