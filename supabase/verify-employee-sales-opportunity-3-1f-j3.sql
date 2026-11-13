-- 3.1F-J3 pós-validação (SOMENTE LEITURA). Executar em BEGIN READ ONLY ... ROLLBACK. Todas as linhas ok = true.
with f as (
  select p.oid, p.proname, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosrc
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in (
    'employee_opportunity_eligible_roles', 'employee_opportunity_form_context', 'submit_employee_sales_opportunity',
    'list_employee_sales_filtered', 'list_employee_opportunity_origins')
), rpc as (
  select * from f where proname in ('employee_opportunity_form_context', 'submit_employee_sales_opportunity',
    'list_employee_sales_filtered', 'list_employee_opportunity_origins')
)
select 'functions_present_5' check_name, (select count(*) = 5 from f) ok
union all select 'normalize_phone_present_immutable', (select count(*) = 1 from pg_proc where pronamespace='public'::regnamespace and proname='employee_opportunity_normalize_phone' and provolatile='i' and not prosecdef)
union all select 'secdef_search_path_public_pg_temp', (select bool_and(prosecdef and cfg = 'search_path=public, pg_temp') from f)
union all select 'rpcs_execute_authenticated_only', (select bool_and(has_function_privilege('authenticated', oid, 'execute')
  and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute')) from rpc)
union all select 'rpcs_no_public_execute', (select bool_and(not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) from pg_proc p join f on f.oid = p.oid)
union all select 'eligible_roles_internal_only', (select not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute') from f where proname = 'employee_opportunity_eligible_roles')
union all select 'no_employee_or_profile_id_parameter', (select bool_and(not (pg_get_function_arguments(oid) ~* 'employee_id|profile_id|amount|commission_value')) from rpc)
union all select 'only_submit_writes', (select bool_and(case when proname = 'submit_employee_sales_opportunity' then true else prosrc !~* '\m(insert|update|delete|truncate)\M' end) from f)
union all select 'submit_never_touches_financial_tables', (select prosrc !~* 'rewards|wallet_transactions|withdraw|employee_commission_entitlements|employee_commission_rules|payroll_|finance_audit_log|ensure_referral_reward|mark_first_invoice' from f where proname = 'submit_employee_sales_opportunity')
union all select 'submit_forces_employee_origin_no_reward', (select prosrc ~ $q$'employee_sales_opportunity', 'Oportunidade Funcionário', 'employee'$q$ and prosrc ~ 'null, null, false,' from f where proname = 'submit_employee_sales_opportunity')
union all select 'no_dynamic_sql_in_bodies', (select bool_and(prosrc !~* '\mexecute\M|format\s*\(') from f)
union all select 'phone_norm_index_present', (to_regclass('public.referrals_phone_norm_idx') is not null)
union all select 'h1_rpc_no_client_execute', (select not has_function_privilege('authenticated', 'public.create_employee_sales_opportunity(text,text,uuid,uuid,text,text,text,text)', 'execute') and not has_function_privilege('anon', 'public.create_employee_sales_opportunity(text,text,uuid,uuid,text,text,text,text)', 'execute'))
union all select 'employee_no_reward_chk_still_valid', (select convalidated from pg_constraint where conrelid='public.referrals'::regclass and conname='referrals_employee_origin_no_reward_chk')
union all select 'rewards_eligibility_trigger_enabled', (select tgenabled = 'O' from pg_trigger where tgrelid='public.rewards'::regclass and tgname='trg_rewards_enforce_financial_eligibility')
union all select 'attributions_immutable_trigger_enabled', (select tgenabled = 'O' from pg_trigger where tgrelid='public.sales_opportunity_attributions'::regclass and tgname='trg_sales_opportunity_attributions_immutable')
union all select 'rls_still_on_sensitive_tables', (select bool_and(relrowsecurity) from pg_class where oid in ('public.referrals'::regclass, 'public.rewards'::regclass, 'public.wallet_transactions'::regclass, 'public.sales_opportunity_attributions'::regclass, 'public.employee_commission_entitlements'::regclass, 'public.employee_commission_rules'::regclass))
union all select 'no_active_commission_rules', (select count(*) = 0 from public.employee_commission_rules where status = 'active')
union all select 'financial_tables_still_empty', (select (select count(*) from public.employee_commission_entitlements) + (select count(*) from public.employee_commission_rules) + (select count(*) from public.finance_audit_events) = 0);
