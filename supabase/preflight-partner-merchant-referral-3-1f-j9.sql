-- 3.1F-J9 preflight somente leitura. Não cria objeto e não grava.
-- Não consulta tabelas do módulo (ainda podem não existir).
select 'prereq_origin_kind' as metric,
  (exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referrals' and column_name = 'origin_kind'
  ))::text as value
union all
select 'prereq_invoice_pk', (
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referrals' and column_name = 'brbyte_first_invoice_pk'
  )
)::text
union all
select 'prereq_phone_fn', (to_regprocedure('public.employee_opportunity_normalize_phone(text)') is not null)::text
union all
select 'prereq_eligibility_fn', (to_regprocedure('public.referral_is_financially_eligible(public.referrals)') is not null)::text
union all
select 'origin_values_known', (
  not exists (
    select 1 from public.referrals
    where origin_kind not in (
      'indicator','assisted_indicator','web_preregistration','neutral_network','employee','legacy','partner_merchant'
    )
  )
)::text
union all
select 'partner_table_absent_or_present', (to_regclass('public.partner_merchants') is not null)::text
union all
select 'rewards', (select count(*)::text from public.rewards)
union all
select 'wallet_transactions', (select count(*)::text from public.wallet_transactions);
