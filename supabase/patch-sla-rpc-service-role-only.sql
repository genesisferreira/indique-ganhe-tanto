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
--
-- Não altera o corpo das funções.
-- Cron /api/cron/commercial-sla continua via createServiceRoleClient.
--
-- Idempotente: re-executar REVOKE/GRANT é seguro.
-- ============================================================

begin;

-- Escalonamento (patch-commercial-sla-escalation.sql)
revoke all on function public.detect_commercial_sla_escalations() from public;
revoke all on function public.detect_commercial_sla_escalations() from anon;
revoke all on function public.detect_commercial_sla_escalations() from authenticated;
grant execute on function public.detect_commercial_sla_escalations() to service_role;

-- Redistribuição em lote (patch-commercial-sla-redistribution.sql)
revoke all on function public.redistribute_overdue_commercial_leads() from public;
revoke all on function public.redistribute_overdue_commercial_leads() from anon;
revoke all on function public.redistribute_overdue_commercial_leads() from authenticated;
grant execute on function public.redistribute_overdue_commercial_leads() to service_role;

-- Fallback legado usado pelo cron se a RPC de escalonamento não existir
revoke all on function public.detect_overdue_commercial_leads() from public;
revoke all on function public.detect_overdue_commercial_leads() from anon;
revoke all on function public.detect_overdue_commercial_leads() from authenticated;
grant execute on function public.detect_overdue_commercial_leads() to service_role;

commit;
