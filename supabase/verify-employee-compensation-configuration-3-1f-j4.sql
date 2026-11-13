-- 3.1F-J4 verify (SOMENTE LEITURA). Executar em BEGIN READ ONLY ... ROLLBACK. Saída: check_name/ok.
with fn(sig) as (values
  ('public.admin_save_commission_rule_draft(jsonb)'), ('public.admin_archive_commission_rule_draft(jsonb)'),
  ('public.admin_save_employee_compensation_draft(jsonb)'), ('public.admin_archive_employee_compensation_draft(jsonb)'),
  ('public.admin_list_commission_rules()'), ('public.admin_list_compensation_employees()'),
  ('public.admin_get_employee_compensation(uuid)'), ('public.employee_compensation_preview()')
), legacy(sig) as (values
  ('public.create_commission_rule_draft(text,uuid,text,text,text,numeric,numeric,text,date,date)'),
  ('public.version_commission_rule_draft(text,uuid,text,text,numeric,numeric,text,date,date)'),
  ('public.configure_employee_compensation_draft(text,uuid,date,date,numeric,numeric,numeric,text,numeric,text,boolean,boolean,boolean,boolean)'),
  ('public.record_employee_worked_day(text,uuid,date,text,boolean)'),
  ('public.open_payroll_competence_draft(text,uuid,date)'),
  ('public.add_manual_payroll_adjustment(text,uuid,text,numeric,text,text)')
), fin(t) as (values
  ('public.employee_commission_rules'), ('public.employee_compensation_profiles'), ('public.finance_audit_events'),
  ('public.employee_commission_entitlements'), ('public.payroll_competences'), ('public.payroll_competence_lines'),
  ('public.employee_worked_days')
)
select 'j4_functions_exist' check_name, (select count(*) from fn where to_regprocedure(sig) is not null) = 8 ok
union all select 'j4_functions_security_definer_search_path', (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']) from fn join pg_proc p on p.oid = to_regprocedure(fn.sig))
union all select 'j4_functions_authenticated_only', (select bool_and(has_function_privilege('authenticated', sig, 'execute') and not has_function_privilege('anon', sig, 'execute') and not has_function_privilege('service_role', sig, 'execute')) from fn)
union all select 'legacy_rpcs_not_client_executable', (select bool_and(not has_function_privilege('authenticated', sig, 'execute') and not has_function_privilege('anon', sig, 'execute')) from legacy)
union all select 'legacy_rpcs_preserved', (select count(*) from legacy where to_regprocedure(sig) is not null) = 6
union all select 'helpers_not_client_executable', (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'comp_cfg_%' or p.proname = 'trg_employee_commission_rules_no_overlap'))
union all select 'financial_tables_rls_on_no_client_grants', (select bool_and(c.relrowsecurity and not has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') and not has_table_privilege('anon', c.oid, 'select,insert,update,delete')) from fin join pg_class c on c.oid = to_regclass(fin.t))
union all select 'financial_tables_no_policies', not exists (select 1 from pg_policies where schemaname='public' and tablename in ('employee_commission_rules','employee_compensation_profiles','finance_audit_events','employee_commission_entitlements','payroll_competences','payroll_competence_lines','employee_worked_days'))
union all select 'foundation_gates_present', (select count(*) from pg_constraint where conname in ('employee_commission_rules_foundation_inactive_chk','employee_commission_rules_no_retroactive_chk','employee_compensation_profiles_foundation_inactive_chk','employee_commission_rules_active_status_consistent_chk')) = 4
union all select 'overlap_trigger_present', exists (select 1 from pg_trigger where tgname='trg_employee_commission_rules_no_overlap' and tgrelid='public.employee_commission_rules'::regclass and tgenabled='O')
union all select 'one_draft_index_present', to_regclass('public.employee_compensation_profiles_one_draft_uidx') is not null
union all select 'audit_action_chk_extended', (select pg_get_constraintdef(oid) like '%commission_rule_draft_archived%' and pg_get_constraintdef(oid) like '%compensation_draft_archived%' and pg_get_constraintdef(oid) like '%compensation_draft_versioned%' and pg_get_constraintdef(oid) like '%payroll_adjustment_added%' from pg_constraint where conname='finance_audit_events_action_chk')
union all select 'audit_append_only_triggers', (select count(*) from pg_trigger where tgrelid='public.finance_audit_events'::regclass and tgname in ('trg_finance_audit_events_append_only','trg_finance_audit_events_no_truncate','trg_finance_audit_events_validate_entity')) = 3
union all select 'j4_columns_present', (select count(*) from information_schema.columns where table_schema='public' and ((table_name='employee_commission_rules' and column_name in ('rule_name','description','change_reason','request_hash')) or (table_name='employee_compensation_profiles' and column_name in ('notes','change_reason','request_hash')))) = 7
union all select 'j4_columns_no_default', not exists (select 1 from information_schema.columns where table_schema='public' and column_default is not null and ((table_name='employee_commission_rules' and column_name in ('rule_name','description','change_reason','request_hash')) or (table_name='employee_compensation_profiles' and column_name in ('notes','change_reason','request_hash'))))
union all select 'money_columns_no_default', not exists (select 1 from information_schema.columns where table_schema='public' and column_default is not null and ((table_name='employee_commission_rules' and column_name in ('fixed_amount','percentage_rate')) or (table_name='employee_compensation_profiles' and column_name in ('salary_amount','meal_daily_amount','transport_amount','fuel_amount'))))
union all select 'active_rule_count_zero', not exists (select 1 from public.employee_commission_rules where active or status='active')
union all select 'active_profile_count_zero', not exists (select 1 from public.employee_compensation_profiles where status='active')
union all select 'entitlements_zero', not exists (select 1 from public.employee_commission_entitlements)
union all select 'payroll_competences_zero', not exists (select 1 from public.payroll_competences)
union all select 'payroll_lines_zero', not exists (select 1 from public.payroll_competence_lines)
union all select 'worked_days_zero', not exists (select 1 from public.employee_worked_days);
