-- =========================================================
-- CADASTRO ASSISTIDO — FASE 1 (fundação estrutural)
-- =========================================================
-- Adiciona created_by_profile_id em referrals para separar:
--
--   indicator_profile_id  = indicador real / beneficiário da recompensa
--   created_by_profile_id = ator original que criou o registro (imutável)
--   commercial_profile_id = responsável comercial ATUAL (pode mudar no SLA)
--
-- Esses campos NÃO são equivalentes.
--
-- Compatibilidade:
--   - coluna NULLABLE (sem backfill de histórico)
--   - source 'commercial_assisted_referral' NÃO exige alteração de constraint:
--     referrals_public_pre_registration_chk só restringe sources públicos
--
-- NÃO aplica: reward, wallet, Controllr, AUTH, Sprint 1.2/1.2A.

begin;

-- Ator original da criação (comercial assistido, indicador self-serve, etc.).
-- ON DELETE SET NULL preserva a linha da referral e o histórico mesmo se o
-- profile do criador for removido (mesmo padrão de commercial_profile_id /
-- referral_history.actor_profile_id).
alter table public.referrals
  add column if not exists created_by_profile_id uuid
    references public.profiles(id) on delete set null;

comment on column public.referrals.created_by_profile_id is
  'Ator original que criou a referral (ex.: comercial no cadastro assistido). Não muda em redistribuição. Distinto de indicator_profile_id (beneficiário) e commercial_profile_id (responsável atual).';

comment on column public.referrals.indicator_profile_id is
  'Indicador dono/beneficiário da indicação e da recompensa. Distinto de created_by_profile_id e commercial_profile_id.';

comment on column public.referrals.commercial_profile_id is
  'Comercial atualmente responsável pelo lead. Pode mudar em redistribuição/SLA. Distinto de created_by_profile_id (criador original).';

create index if not exists referrals_created_by_profile_idx
  on public.referrals(created_by_profile_id);

commit;
