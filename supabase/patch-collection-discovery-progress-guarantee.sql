-- Sprint 3.1E-V/W — garantia de progresso da descoberta retomável
--
-- consecutive_no_progress:
--   DEFAULT 0 (run paused pré-existente permanece retomável);
--   claim NÃO zera o contador;
--   release fenced incrementa em pausa sem progresso;
--   advance zera só com lease vigente após página confirmada.
-- Worker antigo recebe stale_lease e não incrementa/reseta.
-- zero_progress_loop marca failed; a linha retomável permanece
-- (índice único). Desbloqueio humano: status=paused,
-- consecutive_no_progress=0, last_error_class=null. Sem DROP da run.
--
-- NÃO aplica em produção nesta sprint. Sem payload ERP. Sem cron.
-- Reaplicação: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
--
-- Pré-requisito: patch-collection-discovery-reconciliation.sql
-- Acesso: service_role. Rollback: DROP COLUMN após encerrar runs.

begin;

alter table public.collection_discovery_runs
  add column if not exists consecutive_no_progress integer not null default 0;

alter table public.collection_discovery_runs
  drop constraint if exists collection_discovery_runs_no_progress_chk;

alter table public.collection_discovery_runs
  add constraint collection_discovery_runs_no_progress_chk
  check (consecutive_no_progress >= 0);

comment on column public.collection_discovery_runs.consecutive_no_progress is
  'Lotes seguidos sem avanço de cursor/página. Claim não zera. Incremento fenced no release. Sem IDs nem payload ERP.';

create or replace function public.collection_discovery_run_to_json(
  r public.collection_discovery_runs
) returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'queryContractVersion', r.query_contract_version,
    'referenceInstant', r.reference_instant,
    'referenceDate', r.reference_date,
    'discoveryTimezone', r.discovery_timezone,
    'paginationStrategy', r.pagination_strategy,
    'cursorLastInvoicePk', r.cursor_last_invoice_pk,
    'status', r.status,
    'leaseOwner', r.lease_owner,
    'leaseUntil', r.lease_until,
    'leaseGeneration', r.lease_generation,
    'scannedPages', r.scanned_pages,
    'scannedInvoices', r.scanned_invoices,
    'createdCount', r.created_count,
    'updatedCount', r.updated_count,
    'skippedCount', r.skipped_count,
    'assignedCount', r.assigned_count,
    'unassignedCount', r.unassigned_count,
    'errorCount', r.error_count,
    'reportedTotal', r.reported_total,
    'lastErrorClass', r.last_error_class,
    'consecutiveNoProgress', r.consecutive_no_progress,
    'coverageProven', r.coverage_proven,
    'uniqueOrderProven', r.unique_order_proven,
    'phase', r.phase,
    'reconcileCursorInvoicePk', r.reconcile_cursor_invoice_pk,
    'reconcileScannedCount', r.reconcile_scanned_count,
    'reconcileClosedCount', r.reconcile_closed_count,
    'reconcileSkippedCount', r.reconcile_skipped_count
  );
$$;

create or replace function public.advance_collection_discovery_checkpoint(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_cursor_last_invoice_pk text,
  p_scanned_pages integer,
  p_scanned_invoices integer,
  p_created_count integer,
  p_updated_count integer,
  p_skipped_count integer,
  p_assigned_count integer,
  p_unassigned_count integer,
  p_error_count integer,
  p_reported_total integer,
  p_last_error_class text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.collection_discovery_runs;
begin
  update public.collection_discovery_runs
  set cursor_last_invoice_pk = p_cursor_last_invoice_pk,
      scanned_pages = p_scanned_pages,
      scanned_invoices = p_scanned_invoices,
      created_count = p_created_count,
      updated_count = p_updated_count,
      skipped_count = p_skipped_count,
      assigned_count = p_assigned_count,
      unassigned_count = p_unassigned_count,
      error_count = p_error_count,
      reported_total = p_reported_total,
      last_error_class = p_last_error_class,
      consecutive_no_progress = 0
  where id = p_run_id
    and lease_owner = p_owner
    and lease_generation = p_generation
    and status = 'running'
    and lease_until is not null
    and lease_until > v_now
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_lease');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'advanced',
    'run', public.collection_discovery_run_to_json(v_row)
  );
end;
$$;

create or replace function public.release_collection_discovery_run(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_status text,
  p_last_error_class text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.collection_discovery_runs;
  v_no_progress boolean := false;
begin
  if p_status not in ('paused', 'failed', 'pagination_ended', 'phases_completed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  v_no_progress :=
    p_last_error_class = 'zero_progress_loop'
    or p_last_error_class ~ '^(pre_list_budget|post_list_no_reserve|list_timeout_headers|list_timeout_body)(:|$)';

  update public.collection_discovery_runs
  set status = p_status,
      lease_owner = null,
      lease_until = null,
      last_error_class = coalesce(p_last_error_class, last_error_class),
      consecutive_no_progress = case
        when v_no_progress then consecutive_no_progress + 1
        else consecutive_no_progress
      end
  where id = p_run_id
    and lease_owner = p_owner
    and lease_generation = p_generation
    and status = 'running'
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_lease');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'released',
    'run', public.collection_discovery_run_to_json(v_row)
  );
end;
$$;

revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from public;
revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from anon;
revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from authenticated;
grant execute on function public.collection_discovery_run_to_json(public.collection_discovery_runs) to service_role;

revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from public;
revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from anon;
revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from authenticated;
grant execute on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) to service_role;

revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from public;
revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from anon;
revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from authenticated;
grant execute on function public.release_collection_discovery_run(uuid, text, integer, text, text) to service_role;

commit;
