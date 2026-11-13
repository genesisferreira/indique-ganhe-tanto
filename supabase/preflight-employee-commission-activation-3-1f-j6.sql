-- 3.1F-J6 preflight (somente leitura).
select 'prereq_rules' as metric, (to_regclass('public.employee_commission_rules') is not null)::text as value
union all select 'prereq_entitlements', (to_regclass('public.employee_commission_entitlements') is not null)::text
union all select 'prereq_competences', (to_regclass('public.payroll_competences') is not null)::text
union all select 'prereq_j5_close', (to_regprocedure('public.admin_close_payroll_competence(jsonb)') is not null)::text
union all select 'prereq_j5_round', (to_regprocedure('public.payroll_j5_round(numeric)') is not null)::text
union all select 'prereq_foundation_inactive', (exists (select 1 from pg_constraint where conname='employee_commission_rules_foundation_inactive_chk'))::text
union all select 'prereq_no_pay', (exists (select 1 from pg_constraint where conname='payroll_competences_foundation_no_pay_chk'))::text
union all select 'count_active_rules', (select count(*)::text from public.employee_commission_rules where active or status = 'active')
union all select 'count_entitlements', (select count(*)::text from public.employee_commission_entitlements)
union all select 'count_paid', (select count(*)::text from public.payroll_competences where status = 'paid')
union all select 'count_rewards', (select count(*)::text from public.rewards)
union all select 'count_wallet_tx', (select count(*)::text from public.wallet_transactions)
union all select 'legacy_create_rule_execute', (
  exists (select 1 from information_schema.routine_privileges
          where routine_schema='public' and routine_name='create_commission_rule_draft'
            and grantee in ('authenticated','anon','PUBLIC') and privilege_type='EXECUTE'))::text;
