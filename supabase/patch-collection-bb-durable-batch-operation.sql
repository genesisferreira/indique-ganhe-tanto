-- Sprint 3.1E-BB - Cobrança: operação durável de "Carregar próxima leva".
--
-- Substitui o registro em memória da 3.1E-BA (Map por processo) por uma
-- operação persistente e atômica, reconhecida por qualquer instância serverless.
--
-- ADITIVA e reaplicável (create ... if not exists / create or replace).
-- NÃO toca collection_discovery_runs, casos, faturas, eventos ou assignments.
-- NÃO armazena cliente, contrato, invoice_pk, PII, payload ERP, valores
-- financeiros ou tokens: apenas contadores inteiros e códigos de parada.
-- A lease/fencing da discovery run continua sendo a segunda barreira.
--
-- Segurança: RLS ligada, sem policies (nenhum acesso anon/authenticated),
-- funções SECURITY INVOKER executáveis apenas por service_role (backend Admin
-- Master). Nenhum SECURITY DEFINER.
--
-- NÃO APLICAR REMOTAMENTE sem autorização específica.
-- Rollback: drop das funções abaixo + drop table public.collection_batch_operations
-- (a tabela só contém controle de operação; nenhum dado operacional).

begin;

create table if not exists public.collection_batch_operations (
  id uuid primary key default gen_random_uuid(),
  sector text not null,
  status text not null default 'ready',
  max_segments integer not null,
  segments_started integer not null default 0,
  segments_completed integer not null default 0,
  next_segment integer not null default 1,
  segment_in_flight integer,
  configured_capacity integer not null,
  stop_requested boolean not null default false,
  stop_reason text,
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  aggregate_counters jsonb not null default '{}'::jsonb,
  last_segment_summary jsonb,
  constraint collection_batch_operations_sector_chk check (sector = 'collections'),
  constraint collection_batch_operations_status_chk check (status in (
    'ready','segment_running','awaiting_next','capacity_reached','pagination_ended',
    'max_segments','stopped','failed','expired','completed')),
  constraint collection_batch_operations_max_chk check (max_segments between 1 and 10),
  constraint collection_batch_operations_counts_chk check (
    segments_started between 0 and max_segments
    and segments_completed between 0 and segments_started
    and next_segment = segments_completed + 1),
  constraint collection_batch_operations_inflight_chk check (
    (status = 'segment_running' and segment_in_flight = segments_started
       and segments_started = segments_completed + 1)
    or (status <> 'segment_running' and segment_in_flight is null)),
  constraint collection_batch_operations_capacity_chk check (configured_capacity between 1 and 15),
  constraint collection_batch_operations_stop_reason_chk check (stop_reason is null or stop_reason in (
    'error','timeout','zero_progress','capacity_reached','pagination_ended','max_segments',
    'stop_requested','busy','expired','unavailable','disabled')),
  constraint collection_batch_operations_terminal_chk check (
    (status in ('ready','segment_running','awaiting_next')) = (completed_at is null)),
  constraint collection_batch_operations_json_chk check (
    jsonb_typeof(aggregate_counters) = 'object'
    and (last_segment_summary is null or jsonb_typeof(last_segment_summary) = 'object'))
);

-- No máximo UMA operação ativa por setor (duas abas, clique duplo, duas instâncias).
create unique index if not exists collection_batch_operations_one_active_uidx
  on public.collection_batch_operations (sector)
  where status in ('ready','segment_running','awaiting_next');

create index if not exists collection_batch_operations_sector_created_idx
  on public.collection_batch_operations (sector, created_at desc);

alter table public.collection_batch_operations enable row level security;
revoke all on table public.collection_batch_operations from public, anon, authenticated;
grant select, insert, update on table public.collection_batch_operations to service_role;

-- Visão sanitizada (sem created_by).
create or replace function public.collection_batch_operation_view(op public.collection_batch_operations)
returns jsonb
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', op.id,
    'status', op.status,
    'maxSegments', op.max_segments,
    'segmentsStarted', op.segments_started,
    'segmentsCompleted', op.segments_completed,
    'nextSegment', op.next_segment,
    'segmentInFlight', op.segment_in_flight,
    'configuredCapacity', op.configured_capacity,
    'stopRequested', op.stop_requested,
    'stopReason', op.stop_reason,
    'expiresAt', op.expires_at,
    'createdAt', op.created_at,
    'updatedAt', op.updated_at,
    'completedAt', op.completed_at,
    'aggregateCounters', op.aggregate_counters,
    'lastSegmentSummary', op.last_segment_summary,
    'active', op.status in ('ready','segment_running','awaiting_next')
  )
$$;

-- E. Expiração no fluxo normal (sem cron). Não altera run/casos, não chama ERP.
create or replace function public.expire_collection_batch_operations(
  p_sector text default 'collections',
  p_now timestamptz default null
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_count integer;
begin
  update public.collection_batch_operations
     set status = 'expired',
         stop_reason = 'expired',
         segment_in_flight = null,
         completed_at = v_now,
         updated_at = v_now
   where sector = p_sector
     and status in ('ready','segment_running','awaiting_next')
     and expires_at <= v_now;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A. Criação (uma confirmação humana). Capacidade/fila revalidadas pelo backend
-- e passadas aqui; a função recusa sem vaga. Não chama ERP.
create or replace function public.create_collection_batch_operation(
  p_sector text,
  p_max_segments integer,
  p_configured_capacity integer,
  p_available integer,
  p_queue_enabled boolean,
  p_created_by uuid default null,
  p_ttl_seconds integer default 600,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_max integer := least(10, greatest(1, coalesce(p_max_segments, 5)));
  v_ttl integer := least(600, greatest(30, coalesce(p_ttl_seconds, 600)));
  v_active public.collection_batch_operations;
  v_op public.collection_batch_operations;
begin
  if p_sector is distinct from 'collections' then
    return jsonb_build_object('ok', false, 'code', 'invalid_sector');
  end if;
  perform pg_advisory_xact_lock(hashtext('collection_batch_operations:' || p_sector));
  perform public.expire_collection_batch_operations(p_sector, v_now);

  select * into v_active from public.collection_batch_operations
   where sector = p_sector and status in ('ready','segment_running','awaiting_next')
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'code', 'operation_active',
      'operation', public.collection_batch_operation_view(v_active));
  end if;
  if p_queue_enabled is not true then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if p_available is null or p_available <= 0 then
    return jsonb_build_object('ok', false, 'code', 'capacity_full');
  end if;

  insert into public.collection_batch_operations
    (sector, status, max_segments, configured_capacity, expires_at, created_by, created_at, updated_at)
  values
    (p_sector, 'ready', v_max, least(15, greatest(1, coalesce(p_configured_capacity, 15))),
     v_now + make_interval(secs => v_ttl), p_created_by, v_now, v_now)
  returning * into v_op;
  return jsonb_build_object('ok', true, 'code', 'created',
    'operation', public.collection_batch_operation_view(v_op));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'operation_active');
end;
$$;

-- B. Claim atômico do próximo segmento.
create or replace function public.claim_collection_batch_segment(
  p_operation_id uuid,
  p_segment integer,
  p_ttl_seconds integer default 600,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_ttl integer := least(600, greatest(30, coalesce(p_ttl_seconds, 600)));
  v_op public.collection_batch_operations;
begin
  select * into v_op from public.collection_batch_operations
   where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_operation');
  end if;
  if v_op.status in ('ready','segment_running','awaiting_next') and v_op.expires_at <= v_now then
    update public.collection_batch_operations
       set status = 'expired', stop_reason = 'expired', segment_in_flight = null,
           completed_at = v_now, updated_at = v_now
     where id = v_op.id returning * into v_op;
    return jsonb_build_object('ok', false, 'code', 'operation_expired',
      'operation', public.collection_batch_operation_view(v_op));
  end if;
  if v_op.status = 'segment_running' then
    return jsonb_build_object('ok', false, 'code', 'segment_in_flight',
      'operation', public.collection_batch_operation_view(v_op));
  end if;
  if v_op.status not in ('ready','awaiting_next') then
    return jsonb_build_object('ok', false, 'code', 'operation_stopped',
      'operation', public.collection_batch_operation_view(v_op));
  end if;
  if v_op.stop_requested then
    update public.collection_batch_operations
       set status = 'stopped', stop_reason = 'stop_requested', completed_at = v_now, updated_at = v_now
     where id = v_op.id returning * into v_op;
    return jsonb_build_object('ok', false, 'code', 'stop_requested',
      'operation', public.collection_batch_operation_view(v_op));
  end if;
  if p_segment is distinct from v_op.next_segment then
    return jsonb_build_object('ok', false, 'code', 'segment_out_of_order',
      'operation', public.collection_batch_operation_view(v_op));
  end if;
  if v_op.segments_started >= v_op.max_segments then
    update public.collection_batch_operations
       set status = 'max_segments', stop_reason = 'max_segments', completed_at = v_now, updated_at = v_now
     where id = v_op.id returning * into v_op;
    return jsonb_build_object('ok', false, 'code', 'max_segments',
      'operation', public.collection_batch_operation_view(v_op));
  end if;

  update public.collection_batch_operations
     set status = 'segment_running',
         segments_started = segments_started + 1,
         segment_in_flight = segments_started + 1,
         expires_at = v_now + make_interval(secs => v_ttl),
         updated_at = v_now
   where id = v_op.id
  returning * into v_op;
  return jsonb_build_object('ok', true, 'code', 'claimed', 'segment', v_op.segment_in_flight,
    'operation', public.collection_batch_operation_view(v_op));
end;
$$;

-- C. Conclusão idempotente. Nunca inicia o próximo segmento.
create or replace function public.complete_collection_batch_segment(
  p_operation_id uuid,
  p_segment integer,
  p_ok boolean,
  p_stop_reason text,
  p_summary jsonb default '{}'::jsonb,
  p_ttl_seconds integer default 600,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_ttl integer := least(600, greatest(30, coalesce(p_ttl_seconds, 600)));
  v_op public.collection_batch_operations;
  v_in jsonb := case when jsonb_typeof(p_summary) = 'object' then p_summary else '{}'::jsonb end;
  v_scanned integer := 0;
  v_new integer := 0;
  v_existing integer := 0;
  v_duration integer := 0;
  v_stage text := null;
  v_reason text := null;
  v_status text;
  v_summary jsonb;
  v_agg jsonb;
begin
  select * into v_op from public.collection_batch_operations
   where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_operation');
  end if;
  if p_segment is not null and p_segment <= v_op.segments_completed then
    return jsonb_build_object('ok', true, 'code', 'already_completed', 'replay', true,
      'operation', public.collection_batch_operation_view(v_op));
  end if;
  if v_op.status <> 'segment_running' or v_op.segment_in_flight is distinct from p_segment then
    return jsonb_build_object('ok', false, 'code',
      case when v_op.status = 'expired' then 'operation_expired' else 'segment_mismatch' end,
      'operation', public.collection_batch_operation_view(v_op));
  end if;

  -- Sanitização: apenas inteiros não negativos e um estágio [a-z_].
  if jsonb_typeof(v_in->'scannedInvoices') = 'number' then v_scanned := greatest(0, least(100000, floor((v_in->>'scannedInvoices')::numeric)::int)); end if;
  if jsonb_typeof(v_in->'newContracts') = 'number' then v_new := greatest(0, least(15, floor((v_in->>'newContracts')::numeric)::int)); end if;
  if jsonb_typeof(v_in->'existingContractInvoices') = 'number' then v_existing := greatest(0, least(100000, floor((v_in->>'existingContractInvoices')::numeric)::int)); end if;
  if jsonb_typeof(v_in->'durationMs') = 'number' then v_duration := greatest(0, least(3600000, floor((v_in->>'durationMs')::numeric)::int)); end if;
  if jsonb_typeof(v_in->'pauseStage') = 'string' and (v_in->>'pauseStage') ~ '^[a-z_]{1,40}$' then v_stage := v_in->>'pauseStage'; end if;

  if p_stop_reason in ('error','timeout','zero_progress','busy','unavailable','disabled') or p_ok is not true then
    v_status := 'failed';
    v_reason := case when p_stop_reason in ('error','timeout','zero_progress','busy','unavailable','disabled')
                     then p_stop_reason else 'error' end;
  elsif p_stop_reason = 'capacity_reached' then
    v_status := 'capacity_reached'; v_reason := 'capacity_reached';
  elsif p_stop_reason = 'pagination_ended' then
    v_status := 'pagination_ended'; v_reason := 'pagination_ended';
  elsif v_op.stop_requested then
    v_status := 'stopped'; v_reason := 'stop_requested';
  elsif v_op.segments_completed + 1 >= v_op.max_segments then
    v_status := 'max_segments'; v_reason := 'max_segments';
  else
    v_status := 'awaiting_next'; v_reason := null;
  end if;

  v_summary := jsonb_build_object('segment', p_segment, 'ok', coalesce(p_ok, false),
    'scannedInvoices', v_scanned, 'newContracts', v_new, 'existingContractInvoices', v_existing,
    'durationMs', v_duration, 'pauseStage', v_stage, 'stopReason', v_reason);
  v_agg := jsonb_build_object(
    'scannedInvoices', coalesce((v_op.aggregate_counters->>'scannedInvoices')::int, 0) + v_scanned,
    'newContracts', coalesce((v_op.aggregate_counters->>'newContracts')::int, 0) + v_new,
    'existingContractInvoices', coalesce((v_op.aggregate_counters->>'existingContractInvoices')::int, 0) + v_existing,
    'durationMs', coalesce((v_op.aggregate_counters->>'durationMs')::int, 0) + v_duration,
    'segments', coalesce(v_op.aggregate_counters->'segments', '[]'::jsonb) || jsonb_build_array(v_summary));

  update public.collection_batch_operations
     set status = v_status,
         stop_reason = v_reason,
         segments_completed = segments_completed + 1,
         next_segment = segments_completed + 2,
         segment_in_flight = null,
         aggregate_counters = v_agg,
         last_segment_summary = v_summary,
         completed_at = case when v_status = 'awaiting_next' then null else v_now end,
         expires_at = case when v_status = 'awaiting_next' then v_now + make_interval(secs => v_ttl) else expires_at end,
         updated_at = v_now
   where id = v_op.id
  returning * into v_op;
  return jsonb_build_object('ok', true, 'code', 'completed', 'replay', false,
    'operation', public.collection_batch_operation_view(v_op));
end;
$$;

-- D. Parada solicitada (persistente; vista por qualquer instância).
create or replace function public.request_collection_batch_stop(
  p_operation_id uuid,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_op public.collection_batch_operations;
begin
  select * into v_op from public.collection_batch_operations
   where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_operation');
  end if;
  if v_op.status = 'segment_running' then
    update public.collection_batch_operations
       set stop_requested = true, updated_at = v_now
     where id = v_op.id returning * into v_op;
  elsif v_op.status in ('ready','awaiting_next') then
    update public.collection_batch_operations
       set stop_requested = true, status = 'stopped', stop_reason = 'stop_requested',
           completed_at = v_now, updated_at = v_now
     where id = v_op.id returning * into v_op;
  end if;
  return jsonb_build_object('ok', true, 'code', 'stop_requested',
    'operation', public.collection_batch_operation_view(v_op));
end;
$$;

-- Consulta para refresh/nova aba: expira e devolve a operação mais recente.
create or replace function public.get_collection_batch_operation(
  p_sector text default 'collections',
  p_operation_id uuid default null,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_op public.collection_batch_operations;
begin
  perform public.expire_collection_batch_operations(p_sector, p_now);
  if p_operation_id is not null then
    select * into v_op from public.collection_batch_operations where id = p_operation_id and sector = p_sector;
  else
    select * into v_op from public.collection_batch_operations
     where sector = p_sector order by created_at desc, id desc limit 1;
  end if;
  if not found then
    return jsonb_build_object('ok', true, 'operation', null);
  end if;
  return jsonb_build_object('ok', true, 'operation', public.collection_batch_operation_view(v_op));
end;
$$;

revoke all on function public.collection_batch_operation_view(public.collection_batch_operations) from public, anon, authenticated;
revoke all on function public.expire_collection_batch_operations(text, timestamptz) from public, anon, authenticated;
revoke all on function public.create_collection_batch_operation(text, integer, integer, integer, boolean, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_collection_batch_segment(uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_collection_batch_segment(uuid, integer, boolean, text, jsonb, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.request_collection_batch_stop(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_collection_batch_operation(text, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.collection_batch_operation_view(public.collection_batch_operations) to service_role;
grant execute on function public.expire_collection_batch_operations(text, timestamptz) to service_role;
grant execute on function public.create_collection_batch_operation(text, integer, integer, integer, boolean, uuid, integer, timestamptz) to service_role;
grant execute on function public.claim_collection_batch_segment(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.complete_collection_batch_segment(uuid, integer, boolean, text, jsonb, integer, timestamptz) to service_role;
grant execute on function public.request_collection_batch_stop(uuid, timestamptz) to service_role;
grant execute on function public.get_collection_batch_operation(text, uuid, timestamptz) to service_role;

commit;
