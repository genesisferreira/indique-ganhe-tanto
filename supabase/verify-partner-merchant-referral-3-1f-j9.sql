-- 3.1F-J9 verify de catálogo, RLS e grants. Somente leitura.
select * from (
  select 'table_partner_merchants' as check_name, to_regclass('public.partner_merchants') is not null as ok
  union all select 'table_links', to_regclass('public.partner_merchant_links') is not null
  union all select 'table_attributions', to_regclass('public.partner_merchant_attributions') is not null
  union all select 'table_rules', to_regclass('public.partner_merchant_rules') is not null
  union all select 'table_entitlements', to_regclass('public.partner_commission_entitlements') is not null
  union all select 'no_plaintext_token_column', not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_merchant_links' and column_name in ('token', 'raw_token', 'public_token')
  )
  union all select 'token_hash_unique', exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'partner_merchant_links_hash_uidx'
  )
  union all select 'one_primary_link', exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'partner_merchant_links_one_primary_uidx'
  )
  union all select 'fixed_once_index', exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'partner_commission_entitlements_fixed_once_uidx'
  )
  union all select 'rls_merchants', (select relrowsecurity from pg_class where oid = 'public.partner_merchants'::regclass)
  union all select 'rls_links', (select relrowsecurity from pg_class where oid = 'public.partner_merchant_links'::regclass)
  union all select 'rls_rules', (select relrowsecurity from pg_class where oid = 'public.partner_merchant_rules'::regclass)
  union all select 'rls_entitlements', (select relrowsecurity from pg_class where oid = 'public.partner_commission_entitlements'::regclass)
  union all select 'rls_rate', (select relrowsecurity from pg_class where oid = 'public.partner_public_rate_buckets'::regclass)
  union all select 'anon_cannot_admin', not has_function_privilege('anon', 'public.admin_save_partner_merchant(jsonb)', 'execute')
  union all select 'anon_can_submit', has_function_privilege('anon', 'public.submit_partner_merchant_referral(text,text,jsonb)', 'execute')
  union all select 'anon_cannot_read_links', not has_table_privilege('anon', 'public.partner_merchant_links', 'select')
  union all select 'authenticated_cannot_write_merchants', not has_table_privilege('authenticated', 'public.partner_merchants', 'insert')
    and not has_table_privilege('authenticated', 'public.partner_merchants', 'update')
    and not has_table_privilege('authenticated', 'public.partner_merchants', 'delete')
  union all select 'service_role_no_link_select', not has_table_privilege('service_role', 'public.partner_merchant_links', 'select')
  union all select 'origin_accepts_partner', pg_get_constraintdef((
    select oid from pg_constraint where conname = 'referrals_origin_kind_chk'
  )) like '%partner_merchant%'
  union all select 'partner_no_reward_chk', exists (
    select 1 from pg_constraint where conname = 'referrals_partner_origin_no_reward_chk' and convalidated
  )
  union all select 'entitlement_trigger', exists (
    select 1 from pg_trigger where tgrelid = 'public.partner_commission_entitlements'::regclass
      and tgname = 'trg_partner_entitlements_withheld' and not tgisinternal
  )
  union all select 'delete_blocked', exists (
    select 1 from pg_trigger where tgrelid = 'public.partner_merchants'::regclass
      and tgname = 'trg_partner_merchants_no_delete' and not tgisinternal
  )
  union all select 'zero_partners', (select count(*) = 0 from public.partner_merchants)
  union all select 'zero_rules', (select count(*) = 0 from public.partner_merchant_rules)
  union all select 'zero_partner_referrals', (select count(*) = 0 from public.referrals where origin_kind = 'partner_merchant')
  union all select 'zero_entitlements', (select count(*) = 0 from public.partner_commission_entitlements)
) s;
