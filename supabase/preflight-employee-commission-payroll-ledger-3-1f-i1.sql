-- 3.1F-I1 — PREFLIGHT / BACKFILL REPORT (somente leitura).
-- Executar em BEGIN READ ONLY ... ROLLBACK. Retorna apenas contagens.
-- Resultado esperado antes da migration: backfill_required = 0.
-- A migration NÃO faz backfill: nenhuma regra, direito, perfil, dia trabalhado,
-- competência ou linha é criado; nenhuma linha existente é alterada.
begin read only;

select 'referrals_total' as metric, count(*)::bigint as value from public.referrals
union all select 'referrals_origin_employee', count(*) from public.referrals where origin_kind = 'employee'
union all select 'referrals_origin_legacy', count(*) from public.referrals where origin_kind = 'legacy'
union all select 'rewards_total', count(*) from public.rewards
union all select 'wallet_transactions_total', count(*) from public.wallet_transactions
union all select 'attributions_total', count(*) from public.sales_opportunity_attributions
union all select 'attributions_without_idempotency_key_after_migration',
  count(*) from public.sales_opportunity_attributions
-- Direitos/folha não existem antes da migration; após ela, todos devem ser 0.
union all select 'backfill_required', 0::bigint;

-- Pós-migration (mesma transação read-only), esperado tudo 0:
--   select count(*) from public.employee_commission_rules;           -- 0 (DEFAULT_RULES_CREATED=NO)
--   select count(*) from public.employee_commission_rules where active or status = 'active'; -- 0
--   select count(*) from public.employee_commission_entitlements;    -- 0
--   select count(*) from public.employee_compensation_profiles;      -- 0
--   select count(*) from public.employee_worked_days;                -- 0
--   select count(*) from public.payroll_competences;                 -- 0
--   select count(*) from public.payroll_competence_lines;            -- 0
--   select count(*) from public.finance_audit_events;                -- 0

rollback;
