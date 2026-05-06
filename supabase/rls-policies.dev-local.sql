-- =============================================================================
-- APENAS DESENVOLVIMENTO LOCAL — NÃO aplicar em produção
-- =============================================================================
-- Objetivo: permitir que um usuário com role `indicador` veja referrals do pool
-- (commercial_profile_id IS NULL) ao testar /comercial/leads, pois a política
-- permanente só libera esse pool para `comercial`.
--
-- Como usar: executar este arquivo no SQL Editor do projeto Supabase de DEV,
-- ou `supabase db execute` apontando para o banco local.
--
-- Para reverter:
--   drop policy if exists referrals_select_dev_indicator_pool on public.referrals;
-- =============================================================================

drop policy if exists referrals_select_dev_indicator_pool on public.referrals;

create policy referrals_select_dev_indicator_pool
on public.referrals
for select
to authenticated
using (
  public.is_indicator()
  and commercial_profile_id is null
);
