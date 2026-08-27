-- ============================================================
-- MIGRATION PENDENTE DE HOMOLOGAÇÃO
-- NÃO EXECUTAR em produção nesta etapa.
-- ============================================================
-- Pré-cadastro PF/PJ + Rede Neutra (captação sem recompensa).
--
-- Finalidade:
--   1) Nome fantasia (PJ) em referrals.referred_company_trade_name
--   2) Constraint de origem estendida para neutral_network_pre_registration
--      (reward_eligible=false + sem indicador)
--   3) Índice de apoio para métricas Rede Neutra
--
-- Compatibilidade:
--   - Coluna nullable: registros antigos intactos
--   - source=public_pre_registration permanece válido
--   - Sem backfill de public_offer_price / financeiro
--
-- Regra de reward:
--   Pré-cadastro e Rede Neutra NÃO geram reward/wallet.
--   Indique e Ganhe inalterado (1ª fatura paga).
--   A guarda no app (isReferralRewardEligible) já cobre Rede Neutra;
--   reward_eligible=false também bloqueia a RPC mark_first_invoice_*.
--
-- Reversão (quando aplicável):
--   drop index referrals_neutral_network_source_idx;
--   restaurar constraint anterior só com public_pre_registration;
--   drop column referred_company_trade_name (após confirmar ausência de uso).
-- ============================================================

begin;

alter table public.referrals
  add column if not exists referred_company_trade_name text;

comment on column public.referrals.referred_company_trade_name is
  'Nome fantasia (PJ). Razão social permanece em referred_name quando person_type=pj.';

-- Constraint: origens públicas de captação sem recompensa
alter table public.referrals
  drop constraint if exists referrals_public_pre_registration_chk;

alter table public.referrals
  add constraint referrals_public_pre_registration_chk
  check (
    (
      source is distinct from 'public_pre_registration'
      and source is distinct from 'neutral_network_pre_registration'
    )
    or (
      reward_eligible = false
      and indicator_profile_id is null
    )
  );

create index if not exists referrals_neutral_network_source_idx
  on public.referrals (created_at desc)
  where source = 'neutral_network_pre_registration';

commit;
