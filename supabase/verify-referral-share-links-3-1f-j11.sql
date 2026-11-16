-- Verificação somente leitura do motor de links 3.1F-J11.
select * from (
  select 'table_links' as check_name, exists(select 1 from information_schema.tables where table_schema='public' and table_name='referral_share_links') as ok
  union all select 'no_plain_token', not exists(select 1 from information_schema.columns where table_schema='public' and table_name='referral_share_links' and column_name='token')
  union all select 'rls_links', (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='referral_share_links')
  union all select 'one_primary', exists(select 1 from pg_indexes where schemaname='public' and indexname='referral_share_links_one_primary_uidx')
  union all select 'anon_cannot_issue', not has_function_privilege('anon','public.issue_referral_share_link(jsonb)','execute')
  union all select 'auth_can_issue', has_function_privilege('authenticated','public.issue_referral_share_link(jsonb)','execute')
  union all select 'service_cannot_submit', not has_function_privilege('service_role','public.submit_referral_share(text,text,jsonb)','execute')
  union all select 'anon_can_submit', has_function_privilege('anon','public.submit_referral_share(text,text,jsonb)','execute')
  union all select 'search_path', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='submit_referral_share' and 'search_path=public, pg_temp' = any(p.proconfig)
  )
) checks;
