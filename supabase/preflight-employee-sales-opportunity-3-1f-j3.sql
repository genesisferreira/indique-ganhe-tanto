-- 3.1F-J3 preflight (SOMENTE LEITURA). Executar em BEGIN READ ONLY ... ROLLBACK. Saída: metric/value.
select 'prereq_sales_opportunity_attributions' metric, (to_regclass('public.sales_opportunity_attributions') is not null)::text value
union all select 'prereq_financial_security_audit_events', (to_regclass('public.financial_security_audit_events') is not null)::text
union all select 'prereq_employee_sector_memberships', (to_regclass('public.employee_sector_memberships') is not null)::text
union all select 'prereq_employee_portal_self', (to_regprocedure('public.employee_portal_self()') is not null)::text
union all select 'prereq_mask_name', (to_regprocedure('public.employee_portal_mask_name(text)') is not null)::text
union all select 'prereq_origin_kind_no_default', (exists (select 1 from information_schema.columns where table_schema='public' and table_name='referrals' and column_name='origin_kind' and is_nullable='NO'))::text
union all select 'prereq_employee_no_reward_chk', (exists (select 1 from pg_constraint where conrelid='public.referrals'::regclass and conname='referrals_employee_origin_no_reward_chk'))::text
union all select 'prereq_rewards_eligibility_trigger', (exists (select 1 from pg_trigger where tgrelid='public.rewards'::regclass and tgname='trg_rewards_enforce_financial_eligibility'))::text
union all select 'prereq_sector_technician_active', (exists (select 1 from public.sectors where code='technician' and is_active))::text
union all select 'prereq_sector_external_sales_active', (exists (select 1 from public.sectors where code='external_sales' and is_active))::text
union all select 'prereq_pipeline_stage_novo', (exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='pipeline_stage' and e.enumlabel='novo'))::text
union all select 'existing_j3_functions', (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname in (
  'employee_opportunity_normalize_phone','employee_opportunity_eligible_roles','employee_opportunity_form_context',
  'submit_employee_sales_opportunity','list_employee_sales_filtered','list_employee_opportunity_origins'))
union all select 'existing_j3_index', (to_regclass('public.referrals_phone_norm_idx') is not null)::text
union all select 'h1_rpc_authenticated_execute', (select has_function_privilege('authenticated','public.create_employee_sales_opportunity(text,text,uuid,uuid,text,text,text,text)','execute'))::text
union all select 'referrals_rows', (select count(*)::text from public.referrals)
union all select 'referrals_employee_origin_rows', (select count(*)::text from public.referrals where origin_kind='employee')
union all select 'count_employee_commission_rules', (select count(*)::text from public.employee_commission_rules)
union all select 'count_sales_opportunity_attributions', (select count(*)::text from public.sales_opportunity_attributions)
union all select 'count_employee_commission_entitlements', (select count(*)::text from public.employee_commission_entitlements)
union all select 'count_employee_compensation_profiles', (select count(*)::text from public.employee_compensation_profiles)
union all select 'count_employee_worked_days', (select count(*)::text from public.employee_worked_days)
union all select 'count_payroll_competences', (select count(*)::text from public.payroll_competences)
union all select 'count_payroll_competence_lines', (select count(*)::text from public.payroll_competence_lines)
union all select 'count_finance_audit_events', (select count(*)::text from public.finance_audit_events)
union all select 'active_commission_rules', (select count(*)::text from public.employee_commission_rules where status = 'active');
