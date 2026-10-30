-- Sprint 3.1E-BG - Cobrança: vazão (métricas BF), salvaguarda anti-clique
-- (confirm_nonce) e RPC fenced de recuperação após zero_progress_loop.
--
-- ADITIVA e reaplicável (add column if not exists / create or replace /
-- create ... if not exists). NÃO edita as migrations BB/BD já aplicadas.
-- NÃO altera linhas de collection_batch_operations, segmentos históricos,
-- casos, eventos, faturas ou assignments. NÃO altera timeouts no banco,
-- maxSegments, capacidade ou regras financeiras.
--
-- 1. collection_batch_operation_segments: colunas novas não sobrepostas
--    (detail_wall_ms, detail_request_sum_ms, detail_max_concurrency,
--    persist_exclusive_ms) + metrics_version (1 = BD histórico, 2 = BG).
--    collection_batch_segment_proof_reasons: histograma agregado por
--    segmento (razão da allowlist fechada + contagem; append-only).
--    Linhas BD existentes são preservadas como estão (metrics_version=1).
-- 2. complete_collection_batch_segment_with_metrics: MESMA assinatura; passa
--    a gravar as colunas BG na mesma transação. persist_ms/detail_ms
--    continuam aceitos (compatibilidade de leitura e do código anterior).
-- 3. collection_batch_operations: confirm_nonce (uuid) +
--    initiation_source controlado ('admin_master_confirm'); índice único
--    (sector, confirm_nonce). Nonce é imutável após gravado.
--    create_collection_batch_operation_with_nonce: replay do mesmo nonce
--    devolve a operação existente (replay=true) sem criar outra.
--    claim_collection_batch_segment_with_nonce: só a confirmação dona
--    (mesmo nonce) continua a operação.
-- 4. collection_discovery_run_admin_audit (append-only) +
--    resume_collection_discovery_after_zero_progress(run, generation, reason).
-- 5. collection_discovery_runs: service_role perde INSERT/UPDATE/DELETE/
--    TRUNCATE diretos (somente SELECT). Toda escrita da run continua pelas
--    RPCs SECURITY DEFINER já existentes (claim/advance/release/...), que
--    não dependem do privilégio do chamador. Proíbe UPDATE direto da run.
--
-- Fencing da recuperação (documentado):
--   * mesmo advisory lock do claim (872145, 31) + SELECT ... FOR UPDATE;
--   * aceita somente lease_generation = p_expected_lease_generation;
--   * NÃO incrementa lease_generation: o próximo claim incrementa (N+1),
--     exatamente como em qualquer retomada; um claim concorrente antes da
--     recuperação já teria levado a run a N+1 => generation_mismatch;
--   * zera lease_owner/lease_until (lease ausente/expirada): worker antigo
--     com owner anterior não passa no fencing owner+generation;
--   * cursor, contadores, reference_instant/date, created_at e fase
--     preservados; status failed -> paused; consecutive_no_progress -> 0;
--     last_error_class -> null.
--   * idempotente: replay com a mesma generation após sucesso devolve
--     already_resumed (auditoria única por run+ação+generation).
--
-- Segurança: RLS ligada, zero policies, search_path fixo, EXECUTE somente
-- service_role. NÃO APLICAR REMOTAMENTE sem autorização específica.
--
-- Rollback (manual): drop das funções *_with_nonce e resume_*;
--   alter table ... drop column das colunas BG; drop table
--   collection_discovery_run_admin_audit (somente auditoria);
--   reaplicar BD para restaurar a função complete_*_with_metrics anterior;
--   grant insert, update, delete on collection_discovery_runs to service_role.

begin;

-- ---------------------------------------------------------------------------
-- 1. Métricas BG por segmento
-- ---------------------------------------------------------------------------
create or replace function public.collection_financial_proof_reasons_valid(p jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from jsonb_each(p) e
      where e.key not in (
        'proven','missing_due_date','invalid_due_date','missing_contract_pk',
        'invalid_contract_status','missing_invoice_deleted','invalid_invoice_deleted',
        'missing_credit_field','nonempty_credit','missing_document_amount',
        'invalid_document_amount','missing_paid_amount','invalid_paid_amount',
        'paid_greater_or_equal_document','missing_invoice_message','paid_message',
        'conflicting_payment_evidence','unknown_requirement')
        or jsonb_typeof(e.value) <> 'number'
        or (e.value #>> '{}')::numeric < 0
        or (e.value #>> '{}')::numeric > 100000
        or (e.value #>> '{}')::numeric <> floor((e.value #>> '{}')::numeric)
    )
  )
$$;

alter table public.collection_batch_operation_segments
  add column if not exists detail_wall_ms integer,
  add column if not exists detail_request_sum_ms integer,
  add column if not exists detail_max_concurrency integer,
  add column if not exists persist_exclusive_ms integer,
  add column if not exists metrics_version smallint not null default 1;

alter table public.collection_batch_operation_segments
  drop constraint if exists collection_batch_operation_segments_bg_chk;
alter table public.collection_batch_operation_segments
  add constraint collection_batch_operation_segments_bg_chk check (
    coalesce(detail_wall_ms, 0) >= 0
    and coalesce(detail_request_sum_ms, 0) >= 0
    and coalesce(persist_exclusive_ms, 0) >= 0
    and (detail_max_concurrency is null or detail_max_concurrency between 0 and 2)
    and metrics_version in (1, 2));

comment on column public.collection_batch_operation_segments.persist_ms is
  'BD (metrics_version=1): laço de persistência INCLUINDO preparação/detalhe. Histórico; não reescrito. BG grava null.';
comment on column public.collection_batch_operation_segments.persist_exclusive_ms is
  'BG: somente leituras/escritas de persistência (sem detalhe/classificação).';
comment on column public.collection_batch_operation_segments.detail_wall_ms is
  'BG: tempo em que o laço ficou bloqueado aguardando invoice_info (wall, exclusivo).';
comment on column public.collection_batch_operation_segments.detail_request_sum_ms is
  'BG: soma das durações individuais de invoice_info (com paralelismo 2 pode exceder detail_wall_ms).';

-- Histograma agregado por segmento (append-only): uma linha por razão da
-- allowlist fechada. Sem JSON livre, sem IDs, sem valores financeiros.
create table if not exists public.collection_batch_segment_proof_reasons (
  id bigint generated always as identity primary key,
  operation_id uuid not null references public.collection_batch_operations(id) on delete restrict,
  segment_ordinal integer not null,
  reason text not null,
  row_count integer not null,
  created_at timestamptz not null default now(),
  constraint collection_batch_segment_proof_reasons_uniq unique (operation_id, segment_ordinal, reason),
  constraint collection_batch_segment_proof_reasons_ordinal_chk check (segment_ordinal between 1 and 10),
  constraint collection_batch_segment_proof_reasons_count_chk check (row_count between 1 and 100000),
  constraint collection_batch_segment_proof_reasons_reason_chk check (reason in (
    'proven','missing_due_date','invalid_due_date','missing_contract_pk',
    'invalid_contract_status','missing_invoice_deleted','invalid_invoice_deleted',
    'missing_credit_field','nonempty_credit','missing_document_amount',
    'invalid_document_amount','missing_paid_amount','invalid_paid_amount',
    'paid_greater_or_equal_document','missing_invoice_message','paid_message',
    'conflicting_payment_evidence','unknown_requirement'))
);

alter table public.collection_batch_segment_proof_reasons enable row level security;
revoke all on table public.collection_batch_segment_proof_reasons from public, anon, authenticated;
revoke all on table public.collection_batch_segment_proof_reasons from service_role;
grant select, insert on table public.collection_batch_segment_proof_reasons to service_role;

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
  v_fpr jsonb := null;
  v_kv record;
  v_is_bg boolean;
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
  -- Histograma: chave fora da allowlist / valor inválido => recusado (null).
  if jsonb_typeof(v_m -> 'financialProofReasons') = 'object'
     and public.collection_financial_proof_reasons_valid(v_m -> 'financialProofReasons') then
    v_fpr := v_m -> 'financialProofReasons';
  end if;
  v_is_bg := v_m ? 'persistExclusiveMs' or v_m ? 'detailWallMs' or v_m ? 'financialProofReasons';

  insert into public.collection_batch_operation_segments (
    operation_id, segment_ordinal, started_at, completed_at, outcome, stop_reason, pause_stage,
    total_ms, login_ms, list_ms, list_requests, classification_ms, detail_lookups,
    detail_skipped_by_list, detail_ms, persist_ms, checkpoint_ms, release_ms,
    rows_scanned, confirmed_prefix_rows, new_contracts, existing_contract_invoices,
    invoices_attached, skipped_total, cursor_advanced, capacity_before, capacity_after,
    detail_wall_ms, detail_request_sum_ms, detail_max_concurrency, persist_exclusive_ms,
    metrics_version)
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
    public.collection_batch_metric_int(v_m, 'capacityAfter', 15),
    public.collection_batch_metric_int(v_m, 'detailWallMs', v_ms),
    public.collection_batch_metric_int(v_m, 'detailRequestSumMs', v_ms),
    public.collection_batch_metric_int(v_m, 'detailMaxConcurrency', 2),
    public.collection_batch_metric_int(v_m, 'persistExclusiveMs', v_ms),
    case when v_is_bg then 2 else 1 end);

  -- Histograma (mesma transação). Inválido inteiro => nada gravado.
  if v_fpr is not null then
    for v_kv in select e.key, (e.value #>> '{}')::numeric as n from jsonb_each(v_fpr) e loop
      if v_kv.n > 0 then
        insert into public.collection_batch_segment_proof_reasons (operation_id, segment_ordinal, reason, row_count)
        values (p_operation_id, p_segment, v_kv.key, v_kv.n::integer);
      end if;
    end loop;
  end if;

  return v_res || jsonb_build_object('metricsRecorded', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. confirm_nonce + initiation_source
-- ---------------------------------------------------------------------------
alter table public.collection_batch_operations
  add column if not exists confirm_nonce uuid,
  add column if not exists initiation_source text;

alter table public.collection_batch_operations
  drop constraint if exists collection_batch_operations_initiation_source_chk;
alter table public.collection_batch_operations
  add constraint collection_batch_operations_initiation_source_chk check (
    initiation_source is null or initiation_source = 'admin_master_confirm');

create unique index if not exists collection_batch_operations_sector_nonce_uidx
  on public.collection_batch_operations (sector, confirm_nonce)
  where confirm_nonce is not null;

-- Nonce/origem imutáveis depois de gravados.
create or replace function public.collection_batch_operations_nonce_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.confirm_nonce is not null
     and new.confirm_nonce is distinct from old.confirm_nonce then
    raise exception 'confirm_nonce is immutable' using errcode = '23514';
  end if;
  if old.initiation_source is not null
     and new.initiation_source is distinct from old.initiation_source then
    raise exception 'initiation_source is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_collection_batch_operations_nonce_immutable on public.collection_batch_operations;
create trigger trg_collection_batch_operations_nonce_immutable
  before update on public.collection_batch_operations
  for each row execute function public.collection_batch_operations_nonce_immutable();

create or replace function public.create_collection_batch_operation_with_nonce(
  p_sector text,
  p_max_segments integer,
  p_configured_capacity integer,
  p_available integer,
  p_queue_enabled boolean,
  p_created_by uuid,
  p_client_operation_nonce uuid,
  p_initiation_source text,
  p_ttl_seconds integer default 600,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing public.collection_batch_operations;
  v_res jsonb;
  v_id uuid;
  v_op public.collection_batch_operations;
begin
  if p_sector is distinct from 'collections' then
    return jsonb_build_object('ok', false, 'code', 'invalid_sector');
  end if;
  if p_client_operation_nonce is null or p_initiation_source is distinct from 'admin_master_confirm' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtext('collection_batch_operations:' || p_sector));

  -- Replay da MESMA confirmação (duplo clique, reenvio): devolve a existente.
  select * into v_existing from public.collection_batch_operations
   where sector = p_sector and confirm_nonce = p_client_operation_nonce;
  if found then
    return jsonb_build_object('ok', true, 'code', 'replay', 'replay', true,
      'operation', public.collection_batch_operation_view(v_existing));
  end if;

  v_res := public.create_collection_batch_operation(
    p_sector, p_max_segments, p_configured_capacity, p_available, p_queue_enabled,
    p_created_by, p_ttl_seconds, p_now);
  if coalesce(v_res ->> 'code', '') <> 'created' then
    return v_res;
  end if;
  v_id := (v_res -> 'operation' ->> 'id')::uuid;
  update public.collection_batch_operations
     set confirm_nonce = p_client_operation_nonce,
         initiation_source = p_initiation_source
   where id = v_id
  returning * into v_op;
  return jsonb_build_object('ok', true, 'code', 'created',
    'operation', public.collection_batch_operation_view(v_op));
end;
$$;

create or replace function public.claim_collection_batch_segment_with_nonce(
  p_operation_id uuid,
  p_segment integer,
  p_client_operation_nonce uuid,
  p_ttl_seconds integer default 600,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_op public.collection_batch_operations;
begin
  select * into v_op from public.collection_batch_operations
   where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_operation');
  end if;
  if p_client_operation_nonce is null
     or v_op.confirm_nonce is null
     or v_op.confirm_nonce is distinct from p_client_operation_nonce then
    return jsonb_build_object('ok', false, 'code', 'nonce_mismatch',
      'operation', public.collection_batch_operation_view(v_op));
  end if;
  return public.claim_collection_batch_segment(p_operation_id, p_segment, p_ttl_seconds, p_now);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Auditoria administrativa + RPC fenced de recuperação
-- ---------------------------------------------------------------------------
create table if not exists public.collection_discovery_run_admin_audit (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.collection_discovery_runs(id) on delete restrict,
  action text not null,
  reason text not null,
  lease_generation integer not null,
  before_state jsonb not null,
  after_state jsonb not null,
  actor_role text not null default current_user,
  created_at timestamptz not null default now(),
  constraint collection_discovery_run_admin_audit_action_chk check (action in ('resume_after_zero_progress')),
  constraint collection_discovery_run_admin_audit_reason_chk check (reason in ('erp_list_timeout_remediated')),
  constraint collection_discovery_run_admin_audit_state_chk check (
    jsonb_typeof(before_state) = 'object' and jsonb_typeof(after_state) = 'object'),
  constraint collection_discovery_run_admin_audit_once_uniq unique (run_id, action, lease_generation)
);

alter table public.collection_discovery_run_admin_audit enable row level security;
revoke all on table public.collection_discovery_run_admin_audit from public, anon, authenticated;
revoke all on table public.collection_discovery_run_admin_audit from service_role;
grant select on table public.collection_discovery_run_admin_audit to service_role;

-- Estado sanitizado (sem PII; cursor só como hash + presença).
create or replace function public.collection_discovery_run_audit_state(r public.collection_discovery_runs)
returns jsonb
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status', r.status,
    'phase', r.phase,
    'leaseGeneration', r.lease_generation,
    'leasePresent', r.lease_owner is not null,
    'consecutiveNoProgress', r.consecutive_no_progress,
    'lastErrorClass', r.last_error_class,
    'cursorPresent', r.cursor_last_invoice_pk is not null,
    'cursorHash', case when r.cursor_last_invoice_pk is null then null else md5(r.cursor_last_invoice_pk) end,
    'scannedPages', r.scanned_pages,
    'scannedInvoices', r.scanned_invoices,
    'createdCount', r.created_count,
    'updatedCount', r.updated_count,
    'skippedCount', r.skipped_count,
    'assignedCount', r.assigned_count,
    'unassignedCount', r.unassigned_count,
    'errorCount', r.error_count,
    'referenceInstant', r.reference_instant,
    'referenceDate', r.reference_date,
    'createdAt', r.created_at
  )
$$;

create or replace function public.resume_collection_discovery_after_zero_progress(
  p_run_id uuid,
  p_expected_lease_generation integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now(); -- timestamptz absoluto (timezone('utc',now()) seria timestamp sem tz e deslocaria pelo TimeZone da sessão)
  v_row public.collection_discovery_runs;
  v_before jsonb;
  v_after jsonb;
begin
  if p_run_id is null
     or p_expected_lease_generation is null
     or p_reason is null
     or p_reason <> 'erp_list_timeout_remediated' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Mesmo lock do claim/supersede: serializa com qualquer retomada.
  perform pg_advisory_xact_lock(872145, 31);

  select * into v_row
  from public.collection_discovery_runs
  where id = p_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Idempotência: mesma run + generation já recuperada e ainda pausada.
  if exists (
    select 1 from public.collection_discovery_run_admin_audit a
     where a.run_id = v_row.id
       and a.action = 'resume_after_zero_progress'
       and a.lease_generation = p_expected_lease_generation
  ) then
    if v_row.status = 'paused' and v_row.lease_generation = p_expected_lease_generation then
      return jsonb_build_object('ok', true, 'code', 'already_resumed', 'replay', true,
        'run', public.collection_discovery_run_to_json(v_row));
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_resumed_state_changed');
  end if;

  if v_row.status is distinct from 'failed' then
    return jsonb_build_object('ok', false, 'code', 'status_mismatch');
  end if;
  if v_row.phase is distinct from 'discovery' then
    return jsonb_build_object('ok', false, 'code', 'phase_mismatch');
  end if;
  if v_row.last_error_class is distinct from 'zero_progress_loop' then
    return jsonb_build_object('ok', false, 'code', 'error_class_mismatch');
  end if;
  if coalesce(v_row.consecutive_no_progress, 0) < 2 then
    return jsonb_build_object('ok', false, 'code', 'no_progress_mismatch');
  end if;
  if v_row.lease_generation is distinct from p_expected_lease_generation then
    return jsonb_build_object('ok', false, 'code', 'generation_mismatch');
  end if;
  if v_row.lease_until is not null and v_row.lease_until > v_now then
    return jsonb_build_object('ok', false, 'code', 'active_lease');
  end if;

  v_before := public.collection_discovery_run_audit_state(v_row);

  update public.collection_discovery_runs
     set status = 'paused',
         consecutive_no_progress = 0,
         last_error_class = null,
         lease_owner = null,
         lease_until = null
   where id = v_row.id
  returning * into v_row;

  v_after := public.collection_discovery_run_audit_state(v_row);

  insert into public.collection_discovery_run_admin_audit
    (run_id, action, reason, lease_generation, before_state, after_state, actor_role)
  values
    (v_row.id, 'resume_after_zero_progress', p_reason, p_expected_lease_generation,
     v_before, v_after, session_user);

  return jsonb_build_object('ok', true, 'code', 'resumed',
    'run', public.collection_discovery_run_to_json(v_row));
end;
$$;

comment on function public.resume_collection_discovery_after_zero_progress(uuid, integer, text) is
  'BG: failed/zero_progress_loop -> paused na MESMA run (generation exata, lease ausente/expirada). Preserva cursor, contadores, referência e created_at. Não cria run; não toca casos/eventos/faturas/assignments. Auditada e idempotente. service_role apenas.';

-- ---------------------------------------------------------------------------
-- 4. Proíbe escrita direta na run (somente RPCs SECURITY DEFINER)
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on table public.collection_discovery_runs from service_role;
grant select on table public.collection_discovery_runs to service_role;

-- ---------------------------------------------------------------------------
-- 5. Grants das funções
-- ---------------------------------------------------------------------------
revoke all on function public.collection_financial_proof_reasons_valid(jsonb) from public, anon, authenticated;
revoke all on function public.complete_collection_batch_segment_with_metrics(uuid, integer, boolean, text, jsonb, jsonb, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.collection_batch_operations_nonce_immutable() from public, anon, authenticated;
revoke all on function public.create_collection_batch_operation_with_nonce(text, integer, integer, integer, boolean, uuid, uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_collection_batch_segment_with_nonce(uuid, integer, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.collection_discovery_run_audit_state(public.collection_discovery_runs) from public, anon, authenticated;
revoke all on function public.resume_collection_discovery_after_zero_progress(uuid, integer, text) from public, anon, authenticated;

grant execute on function public.collection_financial_proof_reasons_valid(jsonb) to service_role;
grant execute on function public.complete_collection_batch_segment_with_metrics(uuid, integer, boolean, text, jsonb, jsonb, integer, timestamptz) to service_role;
grant execute on function public.collection_batch_operations_nonce_immutable() to service_role;
grant execute on function public.create_collection_batch_operation_with_nonce(text, integer, integer, integer, boolean, uuid, uuid, text, integer, timestamptz) to service_role;
grant execute on function public.claim_collection_batch_segment_with_nonce(uuid, integer, uuid, integer, timestamptz) to service_role;
grant execute on function public.collection_discovery_run_audit_state(public.collection_discovery_runs) to service_role;
grant execute on function public.resume_collection_discovery_after_zero_progress(uuid, integer, text) to service_role;

commit;
