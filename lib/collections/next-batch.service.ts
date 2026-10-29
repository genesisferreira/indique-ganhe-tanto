import "server-only"

import { randomUUID } from "node:crypto"
import { awaitQuery, getOpsDb } from "@/lib/collections/db"
import {
  BATCH_STOP_REASON_LABEL,
  createBatchOperationRegistry,
  decideSegmentStop,
  resolveMaxSegments,
  type BatchOperation,
  type BatchStopReason,
} from "@/lib/collections/batch-operation"
import {
  decideNextBatch,
  parseCapacitySummary,
  sanitizeNextBatchResult,
  type NextBatchRequest,
  type NextBatchSummary,
} from "@/lib/collections/next-batch"
import { syncCollectionsFromControllr } from "@/lib/collections/sync"
import { loadCollectionOperationalSettings } from "@/lib/operational/settings.service"

const LOG_TAG = "[collections:next-batch]"

/**
 * Sprint 3.1E-BA: registro de operações (processo). Bloqueia clique duplo,
 * segunda aba e concorrência neste processo; entre instâncias a lease da run
 * (busy) continua sendo a barreira — nenhum segmento inicia com lease ativa.
 */
const registry = createBatchOperationRegistry({ newId: () => randomUUID() })

async function loadRunSummary(): Promise<{ status: string | null; pauseStage: string | null } | null> {
  const db = getOpsDb()
  const { data } = await awaitQuery<Record<string, unknown>>(
    db
      .from("collection_discovery_runs")
      .select("status, last_error_class, updated_at")
      .in("status", ["running", "paused", "failed"])
      .order("updated_at", { ascending: false })
      .limit(1)
  )
  const row = Array.isArray(data) ? data[0] : undefined
  if (!row) return null
  const cls = typeof row.last_error_class === "string" ? row.last_error_class : null
  return { status: String(row.status ?? ""), pauseStage: cls ? cls.split(":")[0] : null }
}

export async function loadNextBatchSummary(): Promise<
  { ok: true; summary: NextBatchSummary } | { ok: false; message: string }
> {
  const db = getOpsDb()
  const { data, error } = await db.rpc("collection_contract_capacity_summary", { p_now: null })
  if (error) {
    console.warn(LOG_TAG, { scope: "summary", code: typeof error.code === "string" ? error.code : "unknown" })
    return { ok: false, message: "Capacidade por contrato indisponível (migration 3.1E-AU pendente)." }
  }
  const run = await loadRunSummary().catch(() => null)
  const summary = parseCapacitySummary(data, run)
  if (!summary) {
    console.warn(LOG_TAG, { scope: "summary", code: "invalid_shape", type: Array.isArray(data) ? "array" : typeof data })
    return { ok: false, message: "Capacidade por contrato indisponível (resposta inválida)." }
  }
  return { ok: true, summary }
}

function operationView(op: BatchOperation, availableAfter: number | null) {
  const totals = op.segments.reduce(
    (acc, s) => ({
      scannedInvoices: acc.scannedInvoices + s.scannedInvoices,
      newContracts: acc.newContracts + s.newContracts,
      existingContractInvoices: acc.existingContractInvoices + s.existingContractInvoices,
    }),
    { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0 }
  )
  return {
    batchOperationId: op.id,
    segment: op.segments.length,
    maxSegments: op.maxSegments,
    continue: op.status === "active",
    stopReason: op.stopReason,
    stopReasonLabel: op.stopReason ? BATCH_STOP_REASON_LABEL[op.stopReason] : null,
    remainingSlots: availableAfter,
    totals,
    segments: op.segments.map((s) => ({ ...s })),
  }
}

const CLAIM_MESSAGES: Record<string, string> = {
  operation_active: "Já existe uma operação de próxima leva ativa (outra aba ou clique duplo).",
  unknown_operation: "Operação desconhecida ou expirada. Confirme novamente.",
  operation_stopped: "Operação já encerrada. Confirme novamente para outra leva.",
  segment_in_flight: "Segmento em andamento nesta operação.",
  segment_out_of_order: "Segmento fora de ordem; continuação recusada.",
  max_segments: "Limite de segmentos atingido.",
  stop_requested: "Operação parada a pedido.",
}

export async function runNextBatchOperation(input: {
  actorProfileId: string
  request: NextBatchRequest
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = input.request
  if (req.kind === "stop") {
    const op = registry.requestStop(req.batchOperationId)
    if (!op) return { status: 404, body: { ok: false, code: "unknown_operation", message: CLAIM_MESSAGES.unknown_operation } }
    return { status: 200, body: { ok: true, code: "stop_requested", ...operationView(op, null) } }
  }

  let op: BatchOperation
  if (req.kind === "start") {
    const begun = registry.begin(resolveMaxSegments(process.env.COLLECTIONS_NEXT_BATCH_MAX_SEGMENTS))
    if (!begun.ok) return { status: 409, body: { ok: false, code: begun.code, message: CLAIM_MESSAGES[begun.code] } }
    const claimed = registry.claimSegment(begun.operation.id, 1)
    if (!claimed.ok) return { status: 409, body: { ok: false, code: claimed.code, message: CLAIM_MESSAGES[claimed.code] } }
    op = claimed.operation
  } else {
    const claimed = registry.claimSegment(req.batchOperationId, req.segment)
    if (!claimed.ok) return { status: 409, body: { ok: false, code: claimed.code, message: CLAIM_MESSAGES[claimed.code] } }
    op = claimed.operation
  }
  const segment = op.segments.length + 1

  // Capacidade recalculada + lease antes de CADA segmento (zero ERP se bloquear).
  const settings = await loadCollectionOperationalSettings()
  const loaded = await loadNextBatchSummary()
  if (!loaded.ok) {
    const stopped = registry.stop(op.id, "error") ?? op
    return { status: 503, body: { ok: false, code: "unavailable", message: loaded.message, ...operationView(stopped, null) } }
  }
  const decision = decideNextBatch({
    summary: loaded.summary,
    enabled: settings.isEnabled !== false,
    inFlight: false,
  })
  if (!decision.proceed) {
    // capacity_full / busy / disabled: zero login, zero invoice/list.
    const reason: BatchStopReason =
      decision.code === "capacity_full" ? "capacity_reached" : decision.code === "disabled" ? "error" : "busy"
    const stopped = registry.stop(op.id, reason) ?? op
    console.log(LOG_TAG, { scope: "segment-gate", segment, reason })
    return {
      status: segment === 1 && reason === "busy" ? 409 : 200,
      body: {
        ok: segment > 1,
        code: segment === 1 ? decision.code : "stopped",
        message: decision.message,
        summary: loaded.summary,
        ...operationView(stopped, loaded.summary.available),
      },
    }
  }
  const gate = { slots: decision.slots }

  const started = Date.now()
  let stopReason: BatchStopReason | null = null
  let sanitized: ReturnType<typeof sanitizeNextBatchResult> | null = null
  try {
    const result = await syncCollectionsFromControllr({
      actorProfileId: input.actorProfileId,
      runId: null,
      contractSlots: gate.slots,
    })
    sanitized = sanitizeNextBatchResult(result)
  } catch {
    stopReason = "error"
  }
  const after = await loadNextBatchSummary().catch(() => null)
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
  const completed =
    registry.completeSegment(op.id, {
      segment,
      ok: sanitized?.ok === true && stopReason !== "error" && stopReason !== "timeout",
      scannedInvoices: sanitized?.segmentScannedInvoices ?? 0,
      newContracts: sanitized?.contractsAdmitted ?? 0,
      existingContractInvoices: sanitized?.segmentUpdated ?? 0,
      pauseStage: sanitized?.pauseStage ?? null,
      durationMs: Math.max(0, Date.now() - started),
      stopReason,
    }) ?? op
  const view = operationView(completed, availableAfter)
  console.log(LOG_TAG, {
    scope: "segment-result",
    segment,
    maxSegments: completed.maxSegments,
    ok: sanitized?.ok ?? false,
    discoveryStatus: sanitized?.discoveryStatus ?? null,
    pauseStage: sanitized?.pauseStage ?? null,
    contractsAdmitted: sanitized?.contractsAdmitted ?? 0,
    stopReason: completed.stopReason,
    stageTimings: sanitized?.stageTimings ?? null,
  })
  const okBody = sanitized?.ok === true
  return {
    status: okBody ? 200 : 502,
    body: { ...(sanitized ?? { ok: false }), ...view, code: okBody ? "loaded" : "failed" },
  }
}

/** Compat (3.1E-AU): um clique = operação nova, primeiro segmento. */
export async function runNextBatch(input: { actorProfileId: string }) {
  return runNextBatchOperation({ actorProfileId: input.actorProfileId, request: { kind: "start" } })
}
