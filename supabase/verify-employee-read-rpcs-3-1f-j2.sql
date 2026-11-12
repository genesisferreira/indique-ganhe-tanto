-- 3.1F-J2 pós-validação (SOMENTE LEITURA). Executar em BEGIN READ ONLY ... ROLLBACK.
-- Todas as linhas devem ter ok = true.
with f as (
  select p.oid, p.proname, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosrc
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in (
    'employee_portal_self', 'employee_portal_mask_name', 'employee_portal_line_visible', 'employee_portal_line_kind',
    'employee_sales_dashboard_summary', 'list_employee_sales', 'get_employee_sale_detail',
    'employee_compensation_summary', 'list_employee_competence_lines')
), rpc as (
  select * from f where proname in ('employee_sales_dashboard_summary', 'list_employee_sales', 'get_employee_sale_detail',
    'employee_compensation_summary', 'list_employee_competence_lines')
), helper as (
  select * from f where proname like 'employee_portal_%'
)
select 'functions_present_9' check_name, (select count(*) = 9 from f) ok
union all select 'rpcs_search_path_public_pg_temp', (select bool_and(cfg = 'search_path=public, pg_temp') from f)
union all select 'rpcs_not_volatile', (select bool_and(provolatile in ('s', 'i')) from f)
union all select 'rpcs_execute_authenticated_only', (select bool_and(has_function_privilege('authenticated', oid, 'execute')
  and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute')) from rpc)
union all select 'rpcs_no_public_execute', (select bool_and(not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) from pg_proc p join f on f.oid = p.oid)
union all select 'helpers_no_client_or_service_execute', (select bool_and(not has_function_privilege('authenticated', oid, 'execute')
  and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute')) from helper)
union all select 'no_write_or_dynamic_sql_in_bodies', (select bool_and(prosrc !~* '\m(insert|update|delete|truncate|execute|format)\M|perform\s+public\.finance_audit_log') from f)
union all select 'no_employee_id_parameter', (select bool_and(not (pg_get_function_arguments(oid) ~* 'employee_id|profile_id')) from rpc);
