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
      createdBy: input.actorProfileId,
    })
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

  const claimed = await deps.store.claim(operationId, segment)
  if (!claimed.ok || typeof claimed.segment !== "number") {
    return refusal(claimed, claimed.code === "store_unavailable" ? 503 : 409)
  }
  segment = claimed.segment

  // Capacidade recalculada + lease antes de CADA segmento (zero ERP se bloquear).
  const enabled = await deps.loadQueueEnabled()
  const loaded = await deps.loadSummary()
  if (!loaded.ok) {
    const done = await deps.store.complete({
      operationId, segment, ok: false, stopReason: "unavailable",
      summary: { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, durationMs: 0, pauseStage: null },
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
