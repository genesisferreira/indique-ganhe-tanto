/**
 * Sprint 3.1E-BB — orquestração de UM segmento por requisição sobre a
 * operação durável. Sem I/O próprio: store, resumo de capacidade, settings e
 * sync são injetados (produção: RPCs service_role; testes: PostgreSQL local).
 *
 * Invariantes:
 * - o servidor é a autoridade: maxSegments vem de env (teto 10 no banco),
 *   nextSegment vem do banco; o body não pode aumentá-los;
 * - capacidade/fila/lease revalidadas antes de CADA segmento (zero ERP se
 *   bloquear);
 * - erro/timeout encerram a operação (status failed) sem retry;
 * - a lease/fencing da discovery run continua sendo a segunda barreira.
 */
import {
  BATCH_INITIATION_SOURCE_ADMIN_CONFIRM,
  buildSegmentMetrics,
  decideSegmentStop,
  durableOperationView,
  resolveMaxSegments,
  type BatchOperationStore,
  type DurableOpResult,
  type DurableStopReason,
} from "@/lib/collections/batch-operation"
import {
  decideNextBatch,
  sanitizeNextBatchResult,
  type NextBatchRequest,
  type NextBatchSummary,
} from "@/lib/collections/next-batch"

export type NextBatchFlowDeps = {
  store: BatchOperationStore
  loadSummary: () => Promise<{ ok: true; summary: NextBatchSummary } | { ok: false; message: string }>
  loadQueueEnabled: () => Promise<boolean>
  runSegment: (input: { actorProfileId: string; contractSlots: number }) => Promise<Parameters<typeof sanitizeNextBatchResult>[0]>
  maxSegmentsEnv: unknown
  log?: (scope: string, data: Record<string, unknown>) => void
}

const MESSAGES: Record<string, string> = {
  operation_active: "Já existe uma operação de próxima leva ativa (outra aba, outra instância ou clique duplo).",
  unknown_operation: "Operação desconhecida. Confirme novamente.",
  operation_expired: "Operação expirada. Confirme novamente.",
  operation_stopped: "Operação já encerrada. Confirme novamente para outra leva.",
  segment_in_flight: "Segmento em andamento nesta operação.",
  segment_out_of_order: "Segmento fora de ordem; continuação recusada.",
  max_segments: "Limite de segmentos atingido.",
  stop_requested: "Operação parada a pedido.",
  capacity_full: "Capacidade de contratos cheia.",
  disabled: "Fila de Cobrança desligada.",
  store_unavailable: "Controle de operação indisponível (migration 3.1E-BB pendente).",
  invalid_response: "Controle de operação com resposta inválida.",
  operation_replay: "Confirmação já registrada; nenhuma operação nova foi criada.",
  nonce_mismatch: "Esta operação pertence a outra confirmação. Confirme novamente.",
}

function refusal(r: DurableOpResult, status = 409) {
  return {
    status,
    body: {
      ok: false,
      code: r.code,
      message: MESSAGES[r.code] ?? "Operação recusada.",
      ...durableOperationView(r.operation, null),
      continue: false,
    },
  }
}

export async function executeNextBatchRequest(
  deps: NextBatchFlowDeps,
  input: { actorProfileId: string; request: NextBatchRequest }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const log = deps.log ?? (() => undefined)
  const req = input.request

  if (req.kind === "stop") {
    const r = await deps.store.requestStop(req.batchOperationId)
    if (!r.ok) return refusal(r, r.code === "unknown_operation" ? 404 : 503)
    return { status: 200, body: { ok: true, code: "stop_requested", ...durableOperationView(r.operation, null), continue: false } }
  }

  let operationId: string
  let segment: number
  const nonce = req.clientOperationNonce
  if (req.kind === "start") {
    // Revalida fila + capacidade ANTES de criar (sem ERP).
    const enabled = await deps.loadQueueEnabled()
    const pre = await deps.loadSummary()
    if (!pre.ok) return { status: 503, body: { ok: false, code: "unavailable", message: pre.message } }
    const created = await deps.store.create({
      maxSegments: resolveMaxSegments(deps.maxSegmentsEnv),
      configuredCapacity: pre.summary.configuredCapacity,
      available: pre.summary.available,
      queueEnabled: enabled,
      // Ator vem SEMPRE da sessão Admin Master (rota); nunca do body.
      createdBy: input.actorProfileId,
      clientOperationNonce: nonce,
      initiationSource: BATCH_INITIATION_SOURCE_ADMIN_CONFIRM,
    })
    // 3.1E-BG: mesma confirmação reenviada (duplo clique/replay) => devolve a
    // operação existente SEM claim e SEM novo segmento.
    if (created.ok && created.replay && created.operation) {
      return {
        status: 200,
        body: {
          ok: true,
          code: "operation_replay",
          message: MESSAGES.operation_replay,
          ...durableOperationView(created.operation, null),
          continue: false,
        },
      }
    }
    if (!created.ok || !created.operation) {
      if (created.code === "capacity_full") {
        return { status: 200, body: { ok: false, code: "capacity_full", message: MESSAGES.capacity_full, summary: pre.summary } }
      }
      return refusal(created, created.code === "store_unavailable" ? 503 : 409)
    }
    operationId = created.operation.id
    segment = created.operation.nextSegment
  } else {
    operationId = req.batchOperationId
    segment = req.segment
  }

  const claimed = await deps.store.claim(operationId, segment, nonce)
  if (!claimed.ok || typeof claimed.segment !== "number") {
    return refusal(claimed, claimed.code === "store_unavailable" ? 503 : 409)
  }
  segment = claimed.segment

  // Capacidade recalculada + lease antes de CADA segmento (zero ERP se bloquear).
  const enabled = await deps.loadQueueEnabled()
  const gateStartedAt = Date.now()
  const loaded = await deps.loadSummary()
  // 3.1E-BD: métricas de gate (sem ERP): só capacidade e tempo do gate.
  const gateMetrics = (capacity: number | null) =>
    buildSegmentMetrics({
      startedAtMs: gateStartedAt, totalMs: Math.max(0, Date.now() - gateStartedAt), stageTimings: null,
      segmentScannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, segmentCreated: 0,
      skippedThisBatch: 0, capacityBefore: capacity, capacityAfter: capacity,
    })
  if (!loaded.ok) {
    const done = await deps.store.complete({
      operationId, segment, ok: false, stopReason: "unavailable",
      summary: { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, durationMs: 0, pauseStage: null },
      metrics: gateMetrics(null),
    })
    return { status: 503, body: { ok: false, code: "unavailable", message: loaded.message, ...durableOperationView(done.operation, null) } }
  }
  const decision = decideNextBatch({ summary: loaded.summary, enabled, inFlight: false })
  if (!decision.proceed) {
    // capacity_full / busy / disabled: zero login, zero invoice/list.
    const reason: DurableStopReason =
      decision.code === "capacity_full" ? "capacity_reached" : decision.code === "disabled" ? "disabled" : "busy"
    const done = await deps.store.complete({
      operationId, segment, ok: reason === "capacity_reached", stopReason: reason,
      summary: { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, durationMs: 0, pauseStage: null },
      metrics: gateMetrics(loaded.summary.activeContracts),
    })
    log("segment-gate", { segment, reason })
    return {
      status: segment === 1 && reason === "busy" ? 409 : 200,
      body: {
        ok: segment > 1 || reason === "capacity_reached",
        code: segment === 1 ? decision.code : "stopped",
        message: decision.message,
        summary: loaded.summary,
        ...durableOperationView(done.operation, loaded.summary.available),
      },
    }
  }

  const started = Date.now()
  let stopReason: DurableStopReason | null = null
  let sanitized: ReturnType<typeof sanitizeNextBatchResult> | null = null
  try {
    const result = await deps.runSegment({ actorProfileId: input.actorProfileId, contractSlots: decision.slots })
    sanitized = sanitizeNextBatchResult(result)
  } catch {
    stopReason = "error"
  }
  const after = await deps.loadSummary().catch(() => null)
  const availableAfter = after && after.ok ? after.summary.available : null
  if (!stopReason && sanitized) {
    stopReason = decideSegmentStop({
      ok: sanitized.ok,
      discoveryStatus: sanitized.discoveryStatus,
      pauseStage: sanitized.pauseStage,
      progressMade: sanitized.progressMade,
      capacityReached: sanitized.capacityReached,
      availableAfter,
    })
  }
  const segOk = sanitized?.ok === true && stopReason !== "error" && stopReason !== "timeout"
  const done = await deps.store.complete({
    operationId,
    segment,
    ok: segOk,
    stopReason,
    summary: {
      scannedInvoices: sanitized?.segmentScannedInvoices ?? 0,
      newContracts: sanitized?.contractsAdmitted ?? 0,
      existingContractInvoices: sanitized?.segmentUpdated ?? 0,
      durationMs: Math.max(0, Date.now() - started),
      pauseStage: sanitized?.pauseStage ?? null,
    },
    metrics: buildSegmentMetrics({
      startedAtMs: started,
      totalMs: Math.max(0, Date.now() - started),
      stageTimings: sanitized?.stageTimings ?? null,
      segmentScannedInvoices: sanitized?.segmentScannedInvoices ?? 0,
      newContracts: sanitized?.contractsAdmitted ?? 0,
      existingContractInvoices: sanitized?.segmentUpdated ?? 0,
      segmentCreated: sanitized?.segmentCreated ?? 0,
      skippedThisBatch: sanitized?.skippedThisBatch ?? 0,
      capacityBefore: loaded.summary.activeContracts,
      capacityAfter: after && after.ok ? after.summary.activeContracts : null,
      financialProofReasons: sanitized?.financialProofReasons ?? null,
    }),
  })
  const view = durableOperationView(done.operation, availableAfter)
  log("segment-result", {
    segment,
    maxSegments: done.operation?.maxSegments ?? null,
    ok: sanitized?.ok ?? false,
    discoveryStatus: sanitized?.discoveryStatus ?? null,
    pauseStage: sanitized?.pauseStage ?? null,
    contractsAdmitted: sanitized?.contractsAdmitted ?? 0,
    operationStatus: done.operation?.status ?? null,
    stopReason: done.operation?.stopReason ?? null,
    stageTimings: sanitized?.stageTimings ?? null,
  })
  const okBody = sanitized?.ok === true
  return {
    status: okBody ? 200 : 502,
    body: { ...(sanitized ?? { ok: false }), ...view, code: okBody ? "loaded" : "failed" },
  }
}
