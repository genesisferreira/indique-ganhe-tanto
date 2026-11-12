-- 3.1F-I1/I1B — PREFLIGHT / BACKFILL REPORT (somente leitura).
-- Executar em BEGIN READ ONLY ... ROLLBACK. Retorna apenas contagens agregadas.
-- Resultado esperado antes da migration: backfill_required = 0.
-- A migration NÃO faz backfill: nenhuma regra, direito, perfil, dia trabalhado,
-- competência ou linha é criado; nenhuma linha existente é alterada.
-- 3.1F-I1B: a migration adiciona UNIQUE (opportunity_id, employee_id) em
-- sales_opportunity_attributions; duplicidades existentes bloqueariam a criação
-- da chave e exigiriam decisão manual (NUNCA correção automática).
begin read only;

select 'referrals_total' as metric, count(*)::bigint as value from public.referrals
union all select 'referrals_origin_employee', count(*) from public.referrals where origin_kind = 'employee'
union all select 'referrals_origin_legacy', count(*) from public.referrals where origin_kind = 'legacy'
union all select 'rewards_total', count(*) from public.rewards
union all select 'wallet_transactions_total', count(*) from public.wallet_transactions
union all select 'attributions_total', count(*) from public.sales_opportunity_attributions
-- Linhas existentes que permanecerão com idempotency_key NULL (coluna nova, sem backfill).
union all select 'attributions_existing_rows_without_idempotency_key', count(*) from public.sales_opportunity_attributions
union all select 'attributions_duplicate_opportunity_role', count(*) from (
  select 1 from public.sales_opportunity_attributions
  group by opportunity_id, attribution_role having count(*) > 1
) d
union all select 'attributions_duplicate_opportunity_employee', count(*) from (
  select 1 from public.sales_opportunity_attributions
  group by opportunity_id, employee_id having count(*) > 1
) d
-- backfill_required = grupos duplicados que impediriam as chaves únicas.
union all select 'backfill_required', (
  select count(*) from (
    select 1 from public.sales_opportunity_attributions
    group by opportunity_id, employee_id having count(*) > 1
  ) d1
) + (
  select count(*) from (
    select 1 from public.sales_opportunity_attributions
    group by opportunity_id, attribution_role having count(*) > 1
  ) d2
);

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
