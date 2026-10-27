import "server-only"

import { awaitQuery, getOpsDb } from "@/lib/collections/db"
import {
  decideNextBatch,
  parseCapacitySummary,
  sanitizeNextBatchResult,
  type NextBatchSummary,
} from "@/lib/collections/next-batch"
import { syncCollectionsFromControllr } from "@/lib/collections/sync"
import { loadCollectionOperationalSettings } from "@/lib/operational/settings.service"

const LOG_TAG = "[collections:next-batch]"

/** Guarda de processo contra clique duplo (o lease da run protege entre instâncias). */
let inFlight = false

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
    return { ok: false, message: "Capacidade por contrato indisponível (migration 3.1E-AU pendente)." }
  }
  const run = await loadRunSummary()
  return { ok: true, summary: parseCapacitySummary(data, run) }
}

export async function runNextBatch(input: { actorProfileId: string }) {
  if (inFlight) {
    return { status: 409, body: { ok: false, code: "in_flight", message: "Já existe uma solicitação de próxima leva em andamento." } }
  }
  inFlight = true
  try {
    const settings = await loadCollectionOperationalSettings()
    const loaded = await loadNextBatchSummary()
    if (!loaded.ok) return { status: 503, body: { ok: false, code: "unavailable", message: loaded.message } }
    const decision = decideNextBatch({
      summary: loaded.summary,
      enabled: settings.isEnabled !== false,
      inFlight: false,
    })
    if (!decision.proceed) {
      // capacity_full / busy / disabled: zero login, zero invoice/list.
      console.log(LOG_TAG, { scope: "gate", code: decision.code })
      return {
        status: decision.code === "busy" ? 409 : 200,
        body: { ok: false, code: decision.code, message: decision.message, summary: loaded.summary },
      }
    }
    const result = await syncCollectionsFromControllr({
      actorProfileId: input.actorProfileId,
      runId: null,
      contractSlots: decision.slots,
    })
    const sanitized = sanitizeNextBatchResult(result)
    console.log(LOG_TAG, {
      scope: "result",
      ok: sanitized.ok,
      discoveryStatus: sanitized.discoveryStatus,
      pauseStage: sanitized.pauseStage,
      contractsAdmitted: sanitized.contractsAdmitted,
      capacityReached: sanitized.capacityReached,
      errors: sanitized.errors,
    })
    return { status: result.ok ? 200 : 502, body: { ...sanitized, code: result.ok ? "loaded" : "failed" } }
  } finally {
    inFlight = false
  }
}
