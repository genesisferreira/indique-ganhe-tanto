-- Sprint 3.1E-BD - Cobrança: hardening pós-MVP (permissões + métricas por segmento).
--
-- ADITIVA e reaplicável. NÃO edita a migration BB já aplicada.
-- NÃO altera collection_batch_operations (linhas), discovery run, casos,
-- faturas, eventos ou assignments. NÃO altera timeouts, maxSegments,
-- capacidade ou regras financeiras.
--
-- 1. collection_batch_operations: remove DELETE/TRUNCATE/REFERENCES/TRIGGER
--    concedidos pelo default da plataforma ao service_role. service_role fica
--    somente com SELECT, INSERT, UPDATE. public/anon/authenticated sem acesso.
-- 2. public.collection_batch_operation_segments: histórico append-only de
--    métricas SANITIZADAS por segmento (um registro por operação+ordinal).
--    Somente inteiros/booleanos/códigos [a-z_]. Sem cliente, contrato, fatura,
--    caso, nomes, documentos, telefones, valores, payload ERP, cookies,
--    tokens, headers ou mensagens brutas de erro.
-- 3. public.complete_collection_batch_segment_with_metrics: conclui o
--    segmento (delegando à RPC BB, mesma transação) e grava as métricas na
--    MESMA transação. Replay do mesmo ordinal: não duplica, não soma,
--    devolve replay=true e preserva o primeiro resumo.
--
-- Segurança: RLS ligada, zero policies, SECURITY INVOKER, search_path fixo,
-- EXECUTE somente service_role.
--
-- NÃO APLICAR REMOTAMENTE sem autorização específica.
-- Rollback: drop function public.complete_collection_batch_segment_with_metrics(...);
--           drop function public.collection_batch_metric_int(jsonb, text, integer);
--           drop table public.collection_batch_operation_segments;
--           (grants: re-grant manual, se necessário).

begin;

-- 1. Permissões mínimas na tabela de controle da operação.
alter table public.collection_batch_operations enable row level security;
revoke all on table public.collection_batch_operations from public, anon, authenticated;
revoke all on table public.collection_batch_operations from service_role;
grant select, insert, update on table public.collection_batch_operations to service_role;

-- 2. Métricas por segmento (append-only).
create table if not exists public.collection_batch_operation_segments (
  id bigint generated always as identity primary key,
  operation_id uuid not null references public.collection_batch_operations(id) on delete restrict,
  segment_ordinal integer not null,
  started_at timestamptz,
  completed_at timestamptz not null,
  outcome text not null,
  stop_reason text,
  pause_stage text,
  total_ms integer,
  login_ms integer,
  list_ms integer,
  list_requests integer,
  classification_ms integer,
  detail_lookups integer,
  detail_skipped_by_list integer,
  detail_ms integer,
  persist_ms integer,
  checkpoint_ms integer,
  release_ms integer,
  rows_scanned integer not null default 0,
  confirmed_prefix_rows integer not null default 0,
  new_contracts integer not null default 0,
  existing_contract_invoices integer not null default 0,
  invoices_attached integer not null default 0,
  skipped_total integer not null default 0,
  cursor_advanced boolean not null default false,
  capacity_before integer,
  capacity_after integer,
  created_at timestamptz not null default now(),
  constraint collection_batch_operation_segments_op_ordinal_uniq unique (operation_id, segment_ordinal),
  constraint collection_batch_operation_segments_ordinal_chk check (segment_ordinal between 1 and 10),
  constraint collection_batch_operation_segments_outcome_chk check (outcome in ('ok','failed')),
  constraint collection_batch_operation_segments_stop_reason_chk check (stop_reason is null or stop_reason in (
    'error','timeout','zero_progress','capacity_reached','pagination_ended','max_segments',
    'stop_requested','busy','expired','unavailable','disabled')),
  constraint collection_batch_operation_segments_pause_stage_chk check (
    pause_stage is null or pause_stage ~ '^[a-z_]{1,40}$'),
  constraint collection_batch_operation_segments_time_chk check (
    started_at is null or started_at <= completed_at),
  constraint collection_batch_operation_segments_nonneg_chk check (
    coalesce(total_ms, 0) >= 0 and coalesce(login_ms, 0) >= 0 and coalesce(list_ms, 0) >= 0
    and coalesce(list_requests, 0) >= 0 and coalesce(classification_ms, 0) >= 0
    and coalesce(detail_lookups, 0) >= 0 and coalesce(detail_skipped_by_list, 0) >= 0
    and coalesce(detail_ms, 0) >= 0 and coalesce(persist_ms, 0) >= 0
    and coalesce(checkpoint_ms, 0) >= 0 and coalesce(release_ms, 0) >= 0
    and rows_scanned >= 0 and confirmed_prefix_rows >= 0 and new_contracts >= 0
    and existing_contract_invoices >= 0 and invoices_attached >= 0 and skipped_total >= 0),
  constraint collection_batch_operation_segments_new_contracts_chk check (new_contracts <= 15),
  constraint collection_batch_operation_segments_capacity_chk check (
    (capacity_before is null or capacity_before between 0 and 15)
    and (capacity_after is null or capacity_after between 0 and 15))
);

create index if not exists collection_batch_operation_segments_created_idx
  on public.collection_batch_operation_segments (created_at desc);

alter table public.collection_batch_operation_segments enable row level security;
revoke all on table public.collection_batch_operation_segments from public, anon, authenticated;
revoke all on table public.collection_batch_operation_segments from service_role;
grant select, insert on table public.collection_batch_operation_segments to service_role;

-- Inteiro não negativo limitado; qualquer outro tipo => null (nunca texto livre).
create or replace function public.collection_batch_metric_int(p jsonb, p_key text, p_cap integer)
returns integer
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p -> p_key) = 'number'
      then greatest(0, least(p_cap, floor(least((p ->> p_key)::numeric, p_cap::numeric))::int))
    else null
  end
$$;

-- 3. Conclusão + métricas na MESMA transação.
create or replace function public.complete_collection_batch_segment_with_metrics(
  p_operation_id uuid,
  p_segment integer,
  p_ok boolean,
  p_stop_reason text,
  p_summary jsonb default '{}'::jsonb,
  p_metrics jsonb default '{}'::jsonb,
  p_ttl_seconds integer default 600,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_m jsonb := case when jsonb_typeof(p_metrics) = 'object' then p_metrics else '{}'::jsonb end;
  v_s jsonb := case when jsonb_typeof(p_summary) = 'object' then p_summary else '{}'::jsonb end;
  v_res jsonb;
  v_op jsonb;
  v_started timestamptz := null;
  v_stage text := null;
  v_reason text := null;
  v_ms constant integer := 3600000;
  v_rows constant integer := 100000;
begin
  v_res := public.complete_collection_batch_segment(
    p_operation_id, p_segment, p_ok, p_stop_reason, v_s, p_ttl_seconds, v_now);

  -- Replay (already_completed) ou recusa: nenhuma métrica nova, nada somado.
  if coalesce(v_res ->> 'code', '') <> 'completed' then
    return v_res || jsonb_build_object('metricsRecorded', false);
  end if;

  v_op := v_res -> 'operation';
  if jsonb_typeof(v_m -> 'startedAt') = 'string'
     and (v_m ->> 'startedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    v_started := (v_m ->> 'startedAt')::timestamptz;
    if v_started > v_now or v_started < v_now - interval '1 hour' then
      v_started := null;
    end if;
  end if;
  if jsonb_typeof(v_s -> 'pauseStage') = 'string' and (v_s ->> 'pauseStage') ~ '^[a-z_]{1,40}$' then
    v_stage := v_s ->> 'pauseStage';
  end if;
  v_reason := v_op ->> 'stopReason';

  insert into public.collection_batch_operation_segments (
    operation_id, segment_ordinal, started_at, completed_at, outcome, stop_reason, pause_stage,
    total_ms, login_ms, list_ms, list_requests, classification_ms, detail_lookups,
    detail_skipped_by_list, detail_ms, persist_ms, checkpoint_ms, release_ms,
    rows_scanned, confirmed_prefix_rows, new_contracts, existing_contract_invoices,
    invoices_attached, skipped_total, cursor_advanced, capacity_before, capacity_after)
  values (
    p_operation_id, p_segment, v_started, v_now,
    case when (v_op ->> 'status') = 'failed' then 'failed' else 'ok' end,
    v_reason, v_stage,
    public.collection_batch_metric_int(v_m, 'totalMs', v_ms),
    public.collection_batch_metric_int(v_m, 'loginMs', v_ms),
    public.collection_batch_metric_int(v_m, 'listMs', v_ms),
    public.collection_batch_metric_int(v_m, 'listRequests', v_rows),
    public.collection_batch_metric_int(v_m, 'classificationMs', v_ms),
    public.collection_batch_metric_int(v_m, 'detailLookups', v_rows),
    public.collection_batch_metric_int(v_m, 'detailSkippedByList', v_rows),
    public.collection_batch_metric_int(v_m, 'detailMs', v_ms),
    public.collection_batch_metric_int(v_m, 'persistMs', v_ms),
    public.collection_batch_metric_int(v_m, 'checkpointMs', v_ms),
    public.collection_batch_metric_int(v_m, 'releaseMs', v_ms),
    coalesce(public.collection_batch_metric_int(v_m, 'rowsScanned', v_rows), 0),
    coalesce(public.collection_batch_metric_int(v_m, 'confirmedPrefixRows', v_rows), 0),
    coalesce(public.collection_batch_metric_int(v_m, 'newContracts', 15), 0),
    coalesce(public.collection_batch_metric_int(v_m, 'existingContractInvoices', v_rows), 0),
    coalesce(public.collection_batch_metric_int(v_m, 'invoicesAttached', v_rows), 0),
    coalesce(public.collection_batch_metric_int(v_m, 'skippedTotal', v_rows), 0),
    coalesce(jsonb_typeof(v_m -> 'cursorAdvanced') = 'boolean' and (v_m ->> 'cursorAdvanced')::boolean, false),
    public.collection_batch_metric_int(v_m, 'capacityBefore', 15),
    public.collection_batch_metric_int(v_m, 'capacityAfter', 15));

  return v_res || jsonb_build_object('metricsRecorded', true);
end;
$$;

revoke all on function public.collection_batch_metric_int(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.complete_collection_batch_segment_with_metrics(uuid, integer, boolean, text, jsonb, jsonb, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.collection_batch_metric_int(jsonb, text, integer) to service_role;
grant execute on function public.complete_collection_batch_segment_with_metrics(uuid, integer, boolean, text, jsonb, jsonb, integer, timestamptz) to service_role;

commit;
