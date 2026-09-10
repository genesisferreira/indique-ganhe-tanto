-- ============================================================
-- Hotfix P1: RPCs de SLA comercial só para service_role
--
-- Problema:
--   detect_commercial_sla_escalations()
--   redistribute_overdue_commercial_leads()
--   (e o fallback detect_overdue_commercial_leads())
--   são SECURITY DEFINER e tinham GRANT EXECUTE TO authenticated
--   sem check de role/auth.uid() no corpo.
--
-- Impacto:
--   qualquer sessão authenticated via PostgREST podia disparar
--   escalonamento/redistribuição de leads.
--
-- Correção mínima:
--   REVOKE EXECUTE de PUBLIC / anon / authenticated
--   GRANT EXECUTE somente a service_role
--   apenas se a função existir (drift: escalonamento pode faltar)
--
-- Não altera o corpo das funções.
-- Não cria / não dropa funções.
-- Cron /api/cron/commercial-sla continua via createServiceRoleClient
-- e já faz fallback se detect_commercial_sla_escalations() não existir.
--
-- Idempotente: re-executar REVOKE/GRANT é seguro.
-- Ausência de uma RPC: no-op, sem 42883.
-- ============================================================

begin;

do $sla_rpc_grants$
begin
  -- Escalonamento (patch-commercial-sla-escalation.sql) — opcional
  if to_regprocedure('public.detect_commercial_sla_escalations()') is not null then
    execute 'revoke all on function public.detect_commercial_sla_escalations() from public';
    execute 'revoke all on function public.detect_commercial_sla_escalations() from anon';
    execute 'revoke all on function public.detect_commercial_sla_escalations() from authenticated';
    execute 'grant execute on function public.detect_commercial_sla_escalations() to service_role';
  end if;

  -- Redistribuição em lote (patch-commercial-sla-redistribution.sql)
  if to_regprocedure('public.redistribute_overdue_commercial_leads()') is not null then
    execute 'revoke all on function public.redistribute_overdue_commercial_leads() from public';
    execute 'revoke all on function public.redistribute_overdue_commercial_leads() from anon';
    execute 'revoke all on function public.redistribute_overdue_commercial_leads() from authenticated';
    execute 'grant execute on function public.redistribute_overdue_commercial_leads() to service_role';
  end if;

  -- Fallback legado usado pelo cron se a RPC de escalonamento não existir
  if to_regprocedure('public.detect_overdue_commercial_leads()') is not null then
    execute 'revoke all on function public.detect_overdue_commercial_leads() from public';
    execute 'revoke all on function public.detect_overdue_commercial_leads() from anon';
    execute 'revoke all on function public.detect_overdue_commercial_leads() from authenticated';
    execute 'grant execute on function public.detect_overdue_commercial_leads() to service_role';
  end if;
end
$sla_rpc_grants$;

commit;
