-- Sprint 3.1E-Q — reconciliação financeira retomável de casos existentes
--
-- Lista de atrasados permanece fonte de DESCOBERTA, não prova de pagamento.
-- Fechamento exige detalhe por invoice_pk, identidade conferida no app e
-- evidência positiva (isPaid=true OU invoice_msg=paid com invoice_date_credit).
-- Removido/cancelado/não encontrado/ausente da lista NÃO vira close_paid.
--
-- NÃO aplica em produção nesta sprint. Sem dados reais de cliente.
--
-- Dependências (ordem):
--   1. supabase/schema.sql
--   2. supabase/rls-policies.sql
--   3. supabase/patch-generic-sector-assignment-engine.sql
--   4. supabase/patch-collections-retention-foundation.sql
--   5. supabase/patch-collection-discovery-checkpoint.sql
--   6. supabase/patch-collection-discovery-fenced-persist.sql
--   7. este arquivo
--
-- Sem este patch: descoberta fenced continua; RPCs de reconciliação
-- inexistem; o runner encerra a paginação sem fechar casos por detalhe.
--
-- Rollback de schema: DROP FUNCTION das RPCs novas + DROP INDEX
-- collection_case_events_payment_detected_once_uidx (após drenar runs).
-- Rollback de código NÃO desfaz casos/eventos já persistidos.

begin;

alter table public.collection_discovery_runs
  add column if not exists phase text not null default 'discovery',
  add column if not exists reconcile_cursor_invoice_pk text,
  add column if not exists reconcile_scanned_count integer not null default 0,
  add column if not exists reconcile_closed_count integer not null default 0,
  add column if not exists reconcile_skipped_count integer not null default 0;

alter table public.collection_discovery_runs
  drop constraint if exists collection_discovery_runs_status_chk;
alter table public.collection_discovery_runs
  add constraint collection_discovery_runs_status_chk check (
    status in ('running', 'paused', 'failed', 'pagination_ended', 'phases_completed')
  );

alter table public.collection_discovery_runs
  drop constraint if exists collection_discovery_runs_phase_chk;
alter table public.collection_discovery_runs
  add constraint collection_discovery_runs_phase_chk check (
    phase in ('discovery', 'reconciliation')
  );

alter table public.collection_discovery_runs
  drop constraint if exists collection_discovery_runs_counts_chk;
alter table public.collection_discovery_runs
  add constraint collection_discovery_runs_counts_chk check (
    scanned_pages >= 0
    and scanned_invoices >= 0
    and created_count >= 0
    and updated_count >= 0
    and skipped_count >= 0
    and assigned_count >= 0
    and unassigned_count >= 0
    and error_count >= 0
    and lease_generation >= 0
    and reconcile_scanned_count >= 0
    and reconcile_closed_count >= 0
    and reconcile_skipped_count >= 0
  );

comment on column public.collection_discovery_runs.phase is
  'discovery = varredura da lista de atrasados; reconciliation = detalhe de casos abertos. Conclusão operacional não prova cobertura global.';

comment on column public.collection_discovery_runs.reconcile_cursor_invoice_pk is
  'Último invoice_pk de reconciliação confirmado. Avança só após processamento persistido ou skip confirmado.';

create unique index if not exists collection_case_events_payment_detected_once_uidx
  on public.collection_case_events (case_id)
  where event_type = 'payment_detected';

comment on index public.collection_case_events_payment_detected_once_uidx is
  'Garante um único evento payment_detected por caso. Reprocessamento é idempotente.';

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
    'coverageProven', r.coverage_proven,
    'uniqueOrderProven', r.unique_order_proven,
    'phase', r.phase,
    'reconcileCursorInvoicePk', r.reconcile_cursor_invoice_pk,
    'reconcileScannedCount', r.reconcile_scanned_count,
    'reconcileClosedCount', r.reconcile_closed_count,
    'reconcileSkippedCount', r.reconcile_skipped_count
  );
$$;

create or replace function public.claim_collection_discovery_run(
  p_owner text,
  p_lease_ms integer,
  p_query_contract_version text,
  p_reference_instant timestamptz,
  p_reference_date date,
  p_discovery_timezone text,
  p_pagination_strategy text,
  p_run_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_lease_until timestamptz;
  v_row public.collection_discovery_runs;
begin
  if p_owner is null or length(trim(p_owner)) = 0
     or p_lease_ms is null or p_lease_ms < 1000
     or p_query_contract_version is null
     or p_pagination_strategy is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(872145, 31);
  v_lease_until := v_now + make_interval(secs => ceil(p_lease_ms::numeric / 1000.0)::int);

  if p_run_id is not null then
    select * into v_row
    from public.collection_discovery_runs
    where id = p_run_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  else
    select * into v_row
    from public.collection_discovery_runs
    where status in ('running', 'paused', 'failed')
    for update;
  end if;

  if found then
    if v_row.query_contract_version <> p_query_contract_version
       or v_row.pagination_strategy <> p_pagination_strategy
       or v_row.discovery_timezone <> p_discovery_timezone then
      return jsonb_build_object('ok', false, 'code', 'incompatible_contract');
    end if;
    if v_row.cursor_last_invoice_pk is not null
       and v_row.cursor_last_invoice_pk !~ '^[1-9][0-9]*$' then
      return jsonb_build_object('ok', false, 'code', 'incompatible_contract');
    end if;
    if v_row.reconcile_cursor_invoice_pk is not null
       and v_row.reconcile_cursor_invoice_pk !~ '^[1-9][0-9]*$' then
      return jsonb_build_object('ok', false, 'code', 'incompatible_contract');
    end if;
    if v_row.status in ('pagination_ended', 'phases_completed') then
      return jsonb_build_object('ok', false, 'code', 'run_not_resumable');
    end if;
    if v_row.status = 'running'
       and v_row.lease_until is not null
       and v_row.lease_until > v_now
       and v_row.lease_owner is distinct from p_owner then
      return jsonb_build_object('ok', false, 'code', 'busy');
    end if;

    update public.collection_discovery_runs
    set status = 'running',
        lease_owner = p_owner,
        lease_until = v_lease_until,
        lease_generation = v_row.lease_generation + 1,
        last_error_class = null
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'ok', true,
      'code', 'claimed',
      'created', false,
      'run', public.collection_discovery_run_to_json(v_row)
    );
  end if;

  if p_run_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.collection_discovery_runs (
    query_contract_version,
    reference_instant,
    reference_date,
    discovery_timezone,
    pagination_strategy,
    status,
    lease_owner,
    lease_until,
    lease_generation,
    phase
  ) values (
    p_query_contract_version,
    p_reference_instant,
    p_reference_date,
    p_discovery_timezone,
    p_pagination_strategy,
    'running',
    p_owner,
    v_lease_until,
    1,
    'discovery'
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'code', 'created',
    'created', true,
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
begin
  if p_status not in ('paused', 'failed', 'pagination_ended', 'phases_completed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  update public.collection_discovery_runs
  set status = p_status,
      lease_owner = null,
      lease_until = null,
      last_error_class = coalesce(p_last_error_class, last_error_class)
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

create or replace function public.enter_collection_reconciliation_phase(
  p_run_id uuid,
  p_owner text,
  p_generation integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.collection_discovery_runs;
begin
  if p_run_id is null or p_owner is null or length(trim(p_owner)) = 0
     or p_generation is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  update public.collection_discovery_runs
  set phase = 'reconciliation'
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
    'code', 'entered',
    'run', public.collection_discovery_run_to_json(v_row)
  );
end;
$$;

comment on function public.enter_collection_reconciliation_phase(uuid, text, integer) is
  'Marca a fase de reconciliação só com lease vigente. Não infere pagamento. service_role only.';

create or replace function public.advance_collection_reconciliation_checkpoint(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_reconcile_cursor_invoice_pk text,
  p_reconcile_scanned_count integer,
  p_reconcile_closed_count integer,
  p_reconcile_skipped_count integer,
  p_last_error_class text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.collection_discovery_runs;
begin
  if p_reconcile_cursor_invoice_pk is not null
     and p_reconcile_cursor_invoice_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  update public.collection_discovery_runs
  set phase = 'reconciliation',
      reconcile_cursor_invoice_pk = p_reconcile_cursor_invoice_pk,
      reconcile_scanned_count = p_reconcile_scanned_count,
      reconcile_closed_count = p_reconcile_closed_count,
      reconcile_skipped_count = p_reconcile_skipped_count,
      last_error_class = coalesce(p_last_error_class, last_error_class)
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

comment on function public.advance_collection_reconciliation_checkpoint(uuid, text, integer, text, integer, integer, integer, text) is
  'Avança o cursor de reconciliação só após persistência confirmada. Worker antigo: stale_lease.';

create or replace function public.list_open_collection_cases_after(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_after_invoice_pk text,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_run public.collection_discovery_runs;
  v_limit integer;
  v_cases jsonb;
begin
  if p_run_id is null or p_owner is null or length(trim(p_owner)) = 0
     or p_generation is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if p_after_invoice_pk is not null
     and p_after_invoice_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 15), 15));

  select * into v_run
  from public.collection_discovery_runs
  where id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_run.lease_owner is distinct from p_owner
     or v_run.lease_generation is distinct from p_generation
     or v_run.status is distinct from 'running'
     or v_run.lease_until is null
     or v_run.lease_until <= v_now then
    return jsonb_build_object('ok', false, 'code', 'stale_lease');
  end if;

  select coalesce(jsonb_agg(row_json order by pk_num), '[]'::jsonb)
  into v_cases
  from (
    select jsonb_build_object(
             'id', c.id,
             'status', c.status,
             'invoicePk', c.invoice_pk
           ) as row_json,
           c.invoice_pk::numeric as pk_num
    from public.collection_cases c
    where c.invoice_pk is not null
      and c.invoice_pk ~ '^[1-9][0-9]*$'
      and c.status in ('open', 'in_contact', 'promise_to_pay', 'unresolved')
      and (
        p_after_invoice_pk is null
        or c.invoice_pk::numeric > p_after_invoice_pk::numeric
      )
    order by c.invoice_pk::numeric
    limit v_limit
  ) listed;

  return jsonb_build_object('ok', true, 'code', 'listed', 'cases', v_cases);
end;
$$;

comment on function public.list_open_collection_cases_after(uuid, text, integer, text, integer) is
  'Lista casos abertos após cursor de reconciliação. Não usa a lista de atrasados como prova de pagamento. service_role only.';

create or replace function public.reconcile_collection_case_paid(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_actor_profile_id uuid,
  p_case_id uuid,
  p_invoice_pk text,
  p_evidence jsonb default '{}'::jsonb,
  p_statement_timeout_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_run public.collection_discovery_runs;
  v_case public.collection_cases;
  v_asg public.sector_work_assignments;
  v_event_inserted boolean := false;
  v_inserted int;
begin
  if p_run_id is null or p_owner is null or length(trim(p_owner)) = 0
     or p_generation is null or p_case_id is null
     or p_invoice_pk is null or p_invoice_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if p_statement_timeout_ms is not null and p_statement_timeout_ms > 0 then
    perform set_config('statement_timeout', p_statement_timeout_ms::text, true);
  end if;

  select * into v_run
  from public.collection_discovery_runs
  where id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_run.lease_owner is distinct from p_owner
     or v_run.lease_generation is distinct from p_generation
     or v_run.status is distinct from 'running'
     or v_run.lease_until is null
     or v_run.lease_until <= v_now then
    return jsonb_build_object('ok', false, 'code', 'stale_lease');
  end if;

  select * into v_case
  from public.collection_cases
  where id = p_case_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_case.invoice_pk is distinct from p_invoice_pk then
    return jsonb_build_object('ok', false, 'code', 'identity_mismatch');
  end if;

  if v_case.status = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_paid',
      'closed', false,
      'alreadyPaid', true,
      'eventInserted', false,
      'caseId', v_case.id,
      'assigned', false
    );
  end if;

  if v_case.status not in ('open', 'in_contact', 'promise_to_pay', 'unresolved') then
    return jsonb_build_object(
      'ok', true,
      'code', 'skipped_terminal',
      'closed', false,
      'alreadyPaid', false,
      'eventInserted', false,
      'caseId', v_case.id,
      'assigned', false
    );
  end if;

  update public.collection_cases
  set status = 'paid',
      closed_at = coalesce(closed_at, v_now),
      erp_snapshot = coalesce(erp_snapshot, '{}'::jsonb) || coalesce(p_evidence, '{}'::jsonb)
  where id = v_case.id
    and status in ('open', 'in_contact', 'promise_to_pay', 'unresolved');

  if not found then
    return jsonb_build_object('ok', false, 'code', 'persist_error');
  end if;

  insert into public.collection_case_events (
    case_id,
    event_type,
    actor_profile_id,
    old_value,
    new_value,
    metadata
  )
  values (
    v_case.id,
    'payment_detected',
    p_actor_profile_id,
    jsonb_build_object('status', v_case.status),
    jsonb_build_object('status', 'paid', 'invoice_pk', p_invoice_pk),
    jsonb_build_object('source', 'collections_controllr_reconciliation')
  )
  on conflict (case_id) where event_type = 'payment_detected'
  do nothing;

  get diagnostics v_inserted = row_count;
  v_event_inserted := v_inserted > 0;

  if to_regprocedure('public.release_sector_assignment(uuid, text, uuid, text)') is not null then
    select * into v_asg
    from public.sector_work_assignments
    where work_type = 'collection_case'
      and work_id = v_case.id
      and status = 'active'
    for update;

    if found then
      perform public.release_sector_assignment(
        v_asg.id,
        'completed',
        p_actor_profile_id,
        'payment_detected'
      );
      update public.collection_cases
      set sector_assignment_id = null
      where id = v_case.id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'closed',
    'closed', true,
    'alreadyPaid', false,
    'eventInserted', v_event_inserted,
    'caseId', v_case.id,
    'assigned', false
  );
end;
$$;

comment on function public.reconcile_collection_case_paid(uuid, text, integer, uuid, uuid, text, jsonb, integer) is
  'Fecha caso pago com lease/generation vigentes, evento único e sem nova atribuição. service_role only.';

revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from public;
revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from anon;
revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from authenticated;
grant execute on function public.collection_discovery_run_to_json(public.collection_discovery_runs) to service_role;

revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from public;
revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from anon;
revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from authenticated;
grant execute on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) to service_role;

revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from public;
revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from anon;
revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from authenticated;
grant execute on function public.release_collection_discovery_run(uuid, text, integer, text, text) to service_role;

revoke all on function public.enter_collection_reconciliation_phase(uuid, text, integer) from public;
revoke all on function public.enter_collection_reconciliation_phase(uuid, text, integer) from anon;
revoke all on function public.enter_collection_reconciliation_phase(uuid, text, integer) from authenticated;
grant execute on function public.enter_collection_reconciliation_phase(uuid, text, integer) to service_role;

revoke all on function public.advance_collection_reconciliation_checkpoint(uuid, text, integer, text, integer, integer, integer, text) from public;
revoke all on function public.advance_collection_reconciliation_checkpoint(uuid, text, integer, text, integer, integer, integer, text) from anon;
revoke all on function public.advance_collection_reconciliation_checkpoint(uuid, text, integer, text, integer, integer, integer, text) from authenticated;
grant execute on function public.advance_collection_reconciliation_checkpoint(uuid, text, integer, text, integer, integer, integer, text) to service_role;

revoke all on function public.list_open_collection_cases_after(uuid, text, integer, text, integer) from public;
revoke all on function public.list_open_collection_cases_after(uuid, text, integer, text, integer) from anon;
revoke all on function public.list_open_collection_cases_after(uuid, text, integer, text, integer) from authenticated;
grant execute on function public.list_open_collection_cases_after(uuid, text, integer, text, integer) to service_role;

revoke all on function public.reconcile_collection_case_paid(uuid, text, integer, uuid, uuid, text, jsonb, integer) from public;
revoke all on function public.reconcile_collection_case_paid(uuid, text, integer, uuid, uuid, text, jsonb, integer) from anon;
revoke all on function public.reconcile_collection_case_paid(uuid, text, integer, uuid, uuid, text, jsonb, integer) from authenticated;
grant execute on function public.reconcile_collection_case_paid(uuid, text, integer, uuid, uuid, text, jsonb, integer) to service_role;

commit;
