-- Sprint 3.1E-AH — status terminal superseded + RPC fenced
--
-- Marca uma run defeituosa como superseded, preservando cursor, referência,
-- contadores e histórico. Não cria, altera nem fecha collection_cases.
-- Não gera evento financeiro. Não altera atribuições.
--
-- Semântica de superseded:
--   terminal, não retomável, fora do índice resumível;
--   não equivale a pagination_ended nem phases_completed;
--   não prova cobertura (coverage_proven permanece false).
--
-- Resumíveis permanecem exatamente: running, paused, failed
-- (collection_discovery_runs_resumable_uidx + claim sem run_id).
-- failed continua ocupando o slot; não use failed para esta recuperação.
--
-- Motivo controlado nesta recuperação: due_date_parser_bug.
-- Não há coluna last_error_message; last_error_class guarda o motivo.
-- Lease: lease_until (não existe lease_expires_at).
--
-- Idempotência: se a run já está superseded com a mesma generation e o
-- mesmo motivo permitido, a RPC devolve already_superseded sem reescrever.
-- Retry com expected_status=paused após sucesso cai nesse caminho.
--
-- claim: CREATE OR REPLACE só para recusar superseded por run_id
-- (run_not_resumable). Select sem run_id continua running/paused/failed.
--
-- NÃO aplica em produção nesta sprint. Sem Sync. Sem payload ERP.
-- Reaplicação: DROP CONSTRAINT IF EXISTS + CREATE OR REPLACE + REVOKE/GRANT.
--
-- Pré-requisito: patch-collection-discovery-progress-guarantee.sql
-- Acesso: service_role. Rollback: DROP FUNCTION supersede; restaurar CHECK
-- sem superseded somente se nenhuma linha tiver esse status.
--
-- Release futuro (não executar aqui):
--   1. preflight read-only da run paused, lease ausente, generation=5
--   2. aplicar só este patch
--   3. validar grants/RLS/check/index
--   4. publicar o código
--   5. uma RPC com expected_status=paused, generation=5, due_date_parser_bug
--   6. confirmar run antiga terminal e intacta
--   7. POST de Sync só em sprint posterior, sem body/runId

begin;

alter table public.collection_discovery_runs
  drop constraint if exists collection_discovery_runs_status_chk;
alter table public.collection_discovery_runs
  add constraint collection_discovery_runs_status_chk check (
    status in (
      'running',
      'paused',
      'failed',
      'pagination_ended',
      'phases_completed',
      'superseded'
    )
  );

comment on constraint collection_discovery_runs_status_chk on public.collection_discovery_runs is
  'superseded é terminal e auditável. running/paused/failed permanecem os únicos resumíveis.';

comment on index public.collection_discovery_runs_resumable_uidx is
  'No máximo uma run resumível: running, paused ou failed. superseded fica fora, como pagination_ended e phases_completed.';

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
    if v_row.status in ('pagination_ended', 'phases_completed', 'superseded') then
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

create or replace function public.supersede_collection_discovery_run(
  p_run_id uuid,
  p_expected_status text,
  p_expected_lease_generation integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.collection_discovery_runs;
begin
  if p_run_id is null
     or p_expected_status is null
     or p_expected_lease_generation is null
     or p_reason is null
     or p_reason <> 'due_date_parser_bug' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if p_expected_status not in ('paused', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(872145, 31);

  select * into v_row
  from public.collection_discovery_runs
  where id = p_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_row.status = 'superseded'
     and v_row.lease_generation = p_expected_lease_generation
     and v_row.last_error_class = p_reason then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_superseded',
      'run', public.collection_discovery_run_to_json(v_row)
    );
  end if;

  if v_row.status in ('pagination_ended', 'phases_completed', 'superseded') then
    return jsonb_build_object('ok', false, 'code', 'already_terminal');
  end if;

  if v_row.status = 'running' then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;

  if v_row.status not in ('paused', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;

  if v_row.status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'code', 'status_mismatch');
  end if;

  if v_row.lease_generation is distinct from p_expected_lease_generation then
    return jsonb_build_object('ok', false, 'code', 'generation_mismatch');
  end if;

  if v_row.lease_owner is not null then
    return jsonb_build_object('ok', false, 'code', 'active_lease');
  end if;

  if v_row.lease_until is not null and v_row.lease_until > v_now then
    return jsonb_build_object('ok', false, 'code', 'active_lease');
  end if;

  update public.collection_discovery_runs
  set status = 'superseded',
      last_error_class = p_reason,
      lease_owner = null,
      lease_until = null
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'code', 'superseded',
    'run', public.collection_discovery_run_to_json(v_row)
  );
end;
$$;

comment on function public.supersede_collection_discovery_run(uuid, text, integer, text) is
  'Encerra auditavelmente uma run paused/failed sem lease. Preserva cursor, referência e contadores. service_role apenas.';

revoke all on function public.supersede_collection_discovery_run(uuid, text, integer, text) from public;
revoke all on function public.supersede_collection_discovery_run(uuid, text, integer, text) from anon;
revoke all on function public.supersede_collection_discovery_run(uuid, text, integer, text) from authenticated;
grant execute on function public.supersede_collection_discovery_run(uuid, text, integer, text) to service_role;

revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from public;
revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from anon;
revoke all on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) from authenticated;
grant execute on function public.claim_collection_discovery_run(text, integer, text, timestamptz, date, text, text, uuid) to service_role;

commit;
