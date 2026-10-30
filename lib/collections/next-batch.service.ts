import "server-only"

import { awaitQuery, getOpsDb } from "@/lib/collections/db"
import { executeNextBatchRequest, type NextBatchFlowDeps } from "@/lib/collections/batch-operation-flow"
import { createRpcBatchOperationStore } from "@/lib/collections/batch-operation-store"
import { durableOperationView } from "@/lib/collections/batch-operation"
import {
  parseCapacitySummary,
  type NextBatchRequest,
  type NextBatchSummary,
} from "@/lib/collections/next-batch"
import { syncCollectionsFromControllr } from "@/lib/collections/sync"
import { loadCollectionOperationalSettings } from "@/lib/operational/settings.service"

const LOG_TAG = "[collections:next-batch]"

/**
 * Sprint 3.1E-BB: a operação (batchOperationId, segmentos, TTL, stop) é
 * DURÁVEL no PostgreSQL (collection_batch_operations) — sem Map/lock em
 * memória. Qualquer instância serverless enxerga a mesma operação; a lease
 * da discovery run continua sendo a segunda barreira (busy).
 */
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

function productionDeps(): NextBatchFlowDeps {
  return {
    store: createRpcBatchOperationStore(),
    loadSummary: loadNextBatchSummary,
    loadQueueEnabled: async () => (await loadCollectionOperationalSettings()).isEnabled !== false,
    runSegment: (i) =>
      syncCollectionsFromControllr({ actorProfileId: i.actorProfileId, runId: null, contractSlots: i.contractSlots }),
    maxSegmentsEnv: process.env.COLLECTIONS_NEXT_BATCH_MAX_SEGMENTS,
    log: (scope, data) => console.log(LOG_TAG, { scope, ...data }),
  }
}

/** Estado da operação mais recente (refresh/nova aba). Nunca continua sozinho. */
export async function loadBatchOperationState(): Promise<Record<string, unknown> | null> {
  const r = await createRpcBatchOperationStore().get(null)
  if (!r.ok || !r.operation) return null
  return durableOperationView(r.operation, null)
}

export async function runNextBatchOperation(input: {
  actorProfileId: string
  request: NextBatchRequest
}): Promise<{ status: number; body: Record<string, unknown> }> {
  // Gate de capacidade/lease (decideNextBatch) roda em executeNextBatchRequest
  // antes de cada segmento (ver batch-operation-flow.ts).
  return executeNextBatchRequest(productionDeps(), input)
}

// 3.1E-BG: removido o atalho runNextBatch (criava operação sem nonce).
