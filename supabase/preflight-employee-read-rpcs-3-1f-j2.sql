-- 3.1F-J2 preflight (SOMENTE LEITURA). Executar em BEGIN READ ONLY ... ROLLBACK.
-- Não altera nada. Saída: metric/value.
select 'prereq_sales_opportunity_attributions' metric, (to_regclass('public.sales_opportunity_attributions') is not null)::text value
union all select 'prereq_employee_commission_entitlements', (to_regclass('public.employee_commission_entitlements') is not null)::text
union all select 'prereq_employee_compensation_profiles', (to_regclass('public.employee_compensation_profiles') is not null)::text
union all select 'prereq_payroll_competences', (to_regclass('public.payroll_competences') is not null)::text
union all select 'prereq_payroll_competence_lines', (to_regclass('public.payroll_competence_lines') is not null)::text
union all select 'prereq_referrals_pipeline_stage', (exists (select 1 from information_schema.columns where table_schema='public' and table_name='referrals' and column_name='pipeline_stage'))::text
union all select 'prereq_referrals_first_invoice_paid', (exists (select 1 from information_schema.columns where table_schema='public' and table_name='referrals' and column_name='first_invoice_paid'))::text
union all select 'prereq_referral_history', (to_regclass('public.referral_history') is not null)::text
union all select 'prereq_auth_uid', (to_regprocedure('auth.uid()') is not null)::text
union all select 'existing_j2_functions', (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in (
  'employee_portal_self', 'employee_portal_mask_name', 'employee_portal_line_visible', 'employee_portal_line_kind',
  'employee_sales_dashboard_summary', 'list_employee_sales', 'get_employee_sale_detail',
  'employee_compensation_summary', 'list_employee_competence_lines'))
union all select 'count_employee_commission_rules', (select count(*)::text from public.employee_commission_rules)
union all select 'count_sales_opportunity_attributions', (select count(*)::text from public.sales_opportunity_attributions)
union all select 'count_employee_commission_entitlements', (select count(*)::text from public.employee_commission_entitlements)
union all select 'count_employee_compensation_profiles', (select count(*)::text from public.employee_compensation_profiles)
union all select 'count_employee_worked_days', (select count(*)::text from public.employee_worked_days)
union all select 'count_payroll_competences', (select count(*)::text from public.payroll_competences)
union all select 'count_payroll_competence_lines', (select count(*)::text from public.payroll_competence_lines)
union all select 'count_finance_audit_events', (select count(*)::text from public.finance_audit_events);
