-- Sprint 3.1E-A — identidade operacional `funcionario`
--
-- Adiciona valor ao enum public.user_role.
-- NÃO migra usuários existentes.
-- NÃO transforma comerciais em funcionario.
-- NÃO executar automaticamente em produção por esta sprint.
--
-- PostgreSQL: ADD VALUE IF NOT EXISTS (PG 9.1+ / Supabase PG 15).
-- O novo valor não é usado neste arquivo (não pode ser referenciado
-- na mesma transação em algumas versões).

alter type public.user_role add value if not exists 'funcionario';

comment on type public.user_role is
  'Identidade global da conta. funcionario = colaborador operacional; memberships definem setores. comercial permanece legado 2.1B.';
