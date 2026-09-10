-- Sprint 1.2R-B — conflito ERP converted × trigger de atribuição comercial
--
-- Problema:
--   Sync ERP seta status=aprovada com commercial_profile_id NULL,
--   o trigger chama assign_referral_to_next_commercial e reabre
--   status para em_atendimento (desfaz a conversão no eixo CRM).
--
-- Solução:
--   Se NEW.brbyte_sync_status = 'converted', a mudança de status veio do
--   contexto ERP Controllr (mesmo UPDATE do sincronizador, ou linha já
--   convertida). Nesse caso: NÃO atribuir comercial e NÃO reabrir atendimento.
--
-- Fluxo comercial normal (aprovada sem sync converted) permanece igual.
--
-- Idempotente: CREATE OR REPLACE da mesma função; não DROP TRIGGER;
-- não altera GRANT/RLS/RPCs financeiras.
--
-- NÃO executa DISABLE TRIGGER / session_replication_role.
-- Aplicar somente com autorização em homologação/produção.
-- Ordem futura: aplicar ESTE SQL ANTES do deploy do código 1.2R-A.

begin;

create or replace function public.trg_referrals_assign_commercial_on_aprovada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sprint 1.2R-B: conversão confirmada pelo ERP/Controllr.
  -- O sincronizador grava brbyte_sync_status='converted' no mesmo UPDATE
  -- (ou a linha já está converted). Não redistribuir / não reabrir.
  if NEW.brbyte_sync_status = 'converted' then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_aprovada',
      NEW.id,
      NEW.commercial_profile_id,
      jsonb_build_object(
        'phase', 'skip_erp_converted',
        'old_status', OLD.status::text,
        'new_status', NEW.status::text,
        'brbyte_sync_status', NEW.brbyte_sync_status,
        'reason', 'erp_controllr_converted_sync'
      )
    );
    return NEW;
  end if;

  if NEW.status = 'aprovada'::public.referral_status
     and OLD.status is distinct from NEW.status
     and NEW.commercial_profile_id is null then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_aprovada',
      NEW.id,
      null,
      jsonb_build_object('phase', 'invoke_rpc', 'old_status', OLD.status::text)
    );
    perform public.assign_referral_to_next_commercial(NEW.id);
  end if;
  return NEW;
exception
  when others then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_aprovada',
      NEW.id,
      null,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return NEW;
end;
$$;

comment on function public.trg_referrals_assign_commercial_on_aprovada() is
  'Atribui comercial ao passar para aprovada, exceto quando brbyte_sync_status=converted (sync ERP Controllr / Sprint 1.2R-B).';

commit;
