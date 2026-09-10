-- ============================================================
-- Hotfix P1: helpers SLA / assignment só para service_role
--
-- Problema:
--   10 funções SECURITY DEFINER auxiliares estavam com
--   EXECUTE para anon + authenticated (PostgREST /rest/v1/rpc).
--   Nenhuma valida auth.uid()/role no corpo.
--   Não há consumer browser/authenticated/API.
--
-- Cadeia interna (NÃO quebra com REVOKE de anon/authenticated):
--   triggers DEFINER → assign_referral_to_next_commercial
--   detect_overdue_commercial_leads → history/notify/debug
--   redistribute_overdue_commercial_leads → redistribute_single
--     → pick_next / notify / debug
--
-- Fora de escopo (já protegidas / opcional):
--   detect_overdue_commercial_leads()
--   redistribute_overdue_commercial_leads()
--   detect_commercial_sla_escalations()
--
-- Correção mínima:
--   REVOKE ALL de PUBLIC / anon / authenticated
--   GRANT EXECUTE somente a service_role
--   apenas se a assinatura EXATA existir (to_regprocedure)
--
-- Não altera corpo, owner, search_path, triggers, RLS.
-- Não cria / não dropa funções.
-- Idempotente. Ausência → no-op, sem 42883.
-- ============================================================

begin;

do $sla_helper_rpc_grants$
begin
  -- 1) Atribuição de pool (chamada por trigger DEFINER, não por PostgREST)
  if to_regprocedure('public.assign_referral_to_next_commercial(uuid)') is not null then
    execute 'revoke all on function public.assign_referral_to_next_commercial(uuid) from public';
    execute 'revoke all on function public.assign_referral_to_next_commercial(uuid) from anon';
    execute 'revoke all on function public.assign_referral_to_next_commercial(uuid) from authenticated';
    execute 'grant execute on function public.assign_referral_to_next_commercial(uuid) to service_role';
  end if;

  -- 2) Histórico SLA overdue
  if to_regprocedure('public.insert_commercial_sla_overdue_history(uuid, uuid, public.referral_status, timestamptz)') is not null then
    execute 'revoke all on function public.insert_commercial_sla_overdue_history(uuid, uuid, public.referral_status, timestamptz) from public';
    execute 'revoke all on function public.insert_commercial_sla_overdue_history(uuid, uuid, public.referral_status, timestamptz) from anon';
    execute 'revoke all on function public.insert_commercial_sla_overdue_history(uuid, uuid, public.referral_status, timestamptz) from authenticated';
    execute 'grant execute on function public.insert_commercial_sla_overdue_history(uuid, uuid, public.referral_status, timestamptz) to service_role';
  end if;

  -- 3) Debug redistribuição
  if to_regprocedure('public.log_commercial_redistribution_debug(text, uuid, uuid, jsonb)') is not null then
    execute 'revoke all on function public.log_commercial_redistribution_debug(text, uuid, uuid, jsonb) from public';
    execute 'revoke all on function public.log_commercial_redistribution_debug(text, uuid, uuid, jsonb) from anon';
    execute 'revoke all on function public.log_commercial_redistribution_debug(text, uuid, uuid, jsonb) from authenticated';
    execute 'grant execute on function public.log_commercial_redistribution_debug(text, uuid, uuid, jsonb) to service_role';
  end if;

  -- 4) Debug SLA
  if to_regprocedure('public.log_commercial_sla_debug(text, uuid, uuid, jsonb)') is not null then
    execute 'revoke all on function public.log_commercial_sla_debug(text, uuid, uuid, jsonb) from public';
    execute 'revoke all on function public.log_commercial_sla_debug(text, uuid, uuid, jsonb) from anon';
    execute 'revoke all on function public.log_commercial_sla_debug(text, uuid, uuid, jsonb) from authenticated';
    execute 'grant execute on function public.log_commercial_sla_debug(text, uuid, uuid, jsonb) to service_role';
  end if;

  -- 5) Debug assignment
  if to_regprocedure('public.log_lead_assignment_debug(text, uuid, uuid, jsonb)') is not null then
    execute 'revoke all on function public.log_lead_assignment_debug(text, uuid, uuid, jsonb) from public';
    execute 'revoke all on function public.log_lead_assignment_debug(text, uuid, uuid, jsonb) from anon';
    execute 'revoke all on function public.log_lead_assignment_debug(text, uuid, uuid, jsonb) from authenticated';
    execute 'grant execute on function public.log_lead_assignment_debug(text, uuid, uuid, jsonb) to service_role';
  end if;

  -- 6) Notificação de lead atribuído
  if to_regprocedure('public.notify_commercial_lead_assigned(uuid, uuid)') is not null then
    execute 'revoke all on function public.notify_commercial_lead_assigned(uuid, uuid) from public';
    execute 'revoke all on function public.notify_commercial_lead_assigned(uuid, uuid) from anon';
    execute 'revoke all on function public.notify_commercial_lead_assigned(uuid, uuid) from authenticated';
    execute 'grant execute on function public.notify_commercial_lead_assigned(uuid, uuid) to service_role';
  end if;

  -- 7) Notificação SLA overdue
  if to_regprocedure('public.notify_commercial_sla_overdue(uuid, uuid, uuid, timestamptz, text)') is not null then
    execute 'revoke all on function public.notify_commercial_sla_overdue(uuid, uuid, uuid, timestamptz, text) from public';
    execute 'revoke all on function public.notify_commercial_sla_overdue(uuid, uuid, uuid, timestamptz, text) from anon';
    execute 'revoke all on function public.notify_commercial_sla_overdue(uuid, uuid, uuid, timestamptz, text) from authenticated';
    execute 'grant execute on function public.notify_commercial_sla_overdue(uuid, uuid, uuid, timestamptz, text) to service_role';
  end if;

  -- 8) Notificação SLA redistribuído
  if to_regprocedure('public.notify_commercial_sla_redistributed(uuid, uuid, text, text, text, integer, text, jsonb)') is not null then
    execute 'revoke all on function public.notify_commercial_sla_redistributed(uuid, uuid, text, text, text, integer, text, jsonb) from public';
    execute 'revoke all on function public.notify_commercial_sla_redistributed(uuid, uuid, text, text, text, integer, text, jsonb) from anon';
    execute 'revoke all on function public.notify_commercial_sla_redistributed(uuid, uuid, text, text, text, integer, text, jsonb) from authenticated';
    execute 'grant execute on function public.notify_commercial_sla_redistributed(uuid, uuid, text, text, text, integer, text, jsonb) to service_role';
  end if;

  -- 9) Escolha do próximo comercial (helper de redistribuição)
  if to_regprocedure('public.pick_next_available_commercial(uuid)') is not null then
    execute 'revoke all on function public.pick_next_available_commercial(uuid) from public';
    execute 'revoke all on function public.pick_next_available_commercial(uuid) from anon';
    execute 'revoke all on function public.pick_next_available_commercial(uuid) from authenticated';
    execute 'grant execute on function public.pick_next_available_commercial(uuid) to service_role';
  end if;

  -- 10) Redistribuição de um lead
  if to_regprocedure('public.redistribute_single_commercial_lead(uuid)') is not null then
    execute 'revoke all on function public.redistribute_single_commercial_lead(uuid) from public';
    execute 'revoke all on function public.redistribute_single_commercial_lead(uuid) from anon';
    execute 'revoke all on function public.redistribute_single_commercial_lead(uuid) from authenticated';
    execute 'grant execute on function public.redistribute_single_commercial_lead(uuid) to service_role';
  end if;
end
$sla_helper_rpc_grants$;

commit;
