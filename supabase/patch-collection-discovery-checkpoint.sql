-- Sprint 3.1E-K — checkpoint/lease da descoberta paginada de atrasados
--
-- Tabela + RPCs de claim/advance/release com fencing (lease_generation).
-- NÃO aplica em produção nesta sprint. NÃO ativa cron. Sem dados brutos do ERP.
--
-- Acesso: service_role apenas. Sem SELECT para authenticated (não é caso operacional).
-- Rollback: DROP FUNCTION + DROP TABLE (após encerrar runs).
--
-- NÃO altera: collection_cases, rewards, wallet, vercel cron, probe, primeira fatura.

begin;

create table if not exists public.collection_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  query_contract_version text not null,
  reference_instant timestamptz not null,
  reference_date date not null,
  discovery_timezone text not null,
  pagination_strategy text not null,
  cursor_last_invoice_pk text,
  status text not null,
  lease_owner text,
  lease_until timestamptz,
  lease_generation integer not null default 0,
  scanned_pages integer not null default 0,
  scanned_invoices integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  assigned_count integer not null default 0,
  unassigned_count integer not null default 0,
  error_count integer not null default 0,
  reported_total integer,
  last_error_class text,
  coverage_proven boolean not null default false,
  unique_order_proven boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint collection_discovery_runs_status_chk check (
    status in ('running', 'paused', 'failed', 'pagination_ended')
  ),
  constraint collection_discovery_runs_strategy_chk check (
    pagination_strategy = 'keyset_invoice_pk_gt'
  ),
  constraint collection_discovery_runs_coverage_chk check (
    coverage_proven = false and unique_order_proven = false
  ),
  constraint collection_discovery_runs_counts_chk check (
    scanned_pages >= 0
    and scanned_invoices >= 0
    and created_count >= 0
    and updated_count >= 0
    and skipped_count >= 0
    and assigned_count >= 0
    and unassigned_count >= 0
    and error_count >= 0
    and lease_generation >= 0
  )
);

comment on table public.collection_discovery_runs is
  'Checkpoint retomável da descoberta de atrasados. Sem payload ERP, credenciais ou PII. coverage_proven permanece false.';

comment on column public.collection_discovery_runs.cursor_last_invoice_pk is
  'Último invoice_pk confirmado. Paginação keyset: invoice_pk > cursor. Combinação com where de Atrasado pendente de validação real.';

comment on column public.collection_discovery_runs.lease_generation is
  'Token de fencing. Worker antigo não grava se a geração mudou.';

comment on column public.collection_discovery_runs.reference_instant is
  'Instante congelado da execução; reutilizado na elegibilidade UTC entre lotes.';

drop trigger if exists trg_collection_discovery_runs_set_updated_at
  on public.collection_discovery_runs;
create trigger trg_collection_discovery_runs_set_updated_at
before update on public.collection_discovery_runs
for each row execute function public.set_updated_at();

create unique index if not exists collection_discovery_runs_resumable_uidx
  on public.collection_discovery_runs ((true))
  where status in ('running', 'paused', 'failed');

create index if not exists collection_discovery_runs_status_idx
  on public.collection_discovery_runs (status, updated_at desc);

alter table public.collection_discovery_runs enable row level security;

revoke all on table public.collection_discovery_runs from public;
revoke all on table public.collection_discovery_runs from anon;
revoke all on table public.collection_discovery_runs from authenticated;
grant all on table public.collection_discovery_runs to service_role;

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
    'uniqueOrderProven', r.unique_order_proven
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
    if v_row.status = 'pagination_ended' then
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
    lease_generation
  ) values (
    p_query_contract_version,
    p_reference_instant,
    p_reference_date,
    p_discovery_timezone,
    p_pagination_strategy,
    'running',
    p_owner,
    v_lease_until,
    1
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

comment on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) is
  'Claim atômico com fencing. Não retoma contrato incompatível. service_role only.';

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
      last_error_class = p_last_error_class
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

comment on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) is
  'Avança cursor só com lease/generation vigentes. Worker antigo recebe stale_lease.';

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
  v_now timestamptz := timezone('utc', now());
  v_row public.collection_discovery_runs;
begin
  if p_status not in ('paused', 'failed', 'pagination_ended') then
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

comment on function public.release_collection_discovery_run(uuid, text, integer, text, text) is
  'Libera lease somente pelo dono com a geração corrente.';

revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from public;
revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from anon;
revoke all on function public.collection_discovery_run_to_json(public.collection_discovery_runs) from authenticated;
grant execute on function public.collection_discovery_run_to_json(public.collection_discovery_runs) to service_role;

revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from public;
revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from anon;
revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from authenticated;
grant execute on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) to service_role;

revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from public;
revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from anon;
revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from authenticated;
grant execute on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) to service_role;

revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from public;
revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from anon;
revoke all on function public.release_collection_discovery_run(uuid, text, integer, text, text) from authenticated;
grant execute on function public.release_collection_discovery_run(uuid, text, integer, text, text) to service_role;

commit;
