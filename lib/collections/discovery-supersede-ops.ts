import "server-only"

import { asRecord, asString, getOpsDb } from "@/lib/collections/db"
import {
  emptyDiscoveryReconciliationFields,
  type CollectionDiscoveryRun,
  type CollectionDiscoveryStatus,
  type CollectionDiscoverySupersedeReason,
} from "@/lib/collections/discovery-contract"

export type DiscoverySupersedeResult =
  | { ok: true; code: "superseded" | "already_superseded"; run: CollectionDiscoveryRun }
  | {
      ok: false
      code:
        | "invalid_input"
        | "not_found"
        | "busy"
        | "active_lease"
        | "generation_mismatch"
        | "status_mismatch"
        | "already_terminal"
        | "invalid_status"
        | "missing_migration"
    }

function missingRpc(error: { message?: string } | null | undefined): boolean {
  const message = String(error?.message ?? "")
  return /does not exist|could not find the function|schema cache/i.test(message)
}

function asRun(value: unknown): CollectionDiscoveryRun | null {
  const row = asRecord(value)
  if (!row?.id) return null
  const defaults = emptyDiscoveryReconciliationFields()
  return {
    id: String(row.id),
    queryContractVersion: String(row.queryContractVersion ?? ""),
    referenceInstant:
      typeof row.referenceInstant === "string"
        ? row.referenceInstant
        : new Date(String(row.referenceInstant)).toISOString(),
    referenceDate: String(row.referenceDate ?? "").slice(0, 10),
    discoveryTimezone: String(row.discoveryTimezone ?? ""),
    paginationStrategy: String(row.paginationStrategy ?? ""),
    cursorLastInvoicePk: asString(row.cursorLastInvoicePk),
    status: row.status as CollectionDiscoveryStatus,
    leaseOwner: asString(row.leaseOwner),
    leaseUntil:
      row.leaseUntil == null
        ? null
        : typeof row.leaseUntil === "string"
          ? row.leaseUntil
          : new Date(String(row.leaseUntil)).toISOString(),
    leaseGeneration: Number(row.leaseGeneration ?? 0),
    scannedPages: Number(row.scannedPages ?? 0),
    scannedInvoices: Number(row.scannedInvoices ?? 0),
    createdCount: Number(row.createdCount ?? 0),
    updatedCount: Number(row.updatedCount ?? 0),
    skippedCount: Number(row.skippedCount ?? 0),
    assignedCount: Number(row.assignedCount ?? 0),
    unassignedCount: Number(row.unassignedCount ?? 0),
    errorCount: Number(row.errorCount ?? 0),
    reportedTotal:
      row.reportedTotal == null || row.reportedTotal === ""
        ? null
        : Number(row.reportedTotal),
    lastErrorClass: asString(row.lastErrorClass),
    consecutiveNoProgress: Number(row.consecutiveNoProgress ?? 0),
    coverageProven: false,
    uniqueOrderProven: false,
    phase: row.phase === "reconciliation" ? "reconciliation" : defaults.phase,
    reconcileCursorInvoicePk: asString(row.reconcileCursorInvoicePk),
    reconcileScannedCount: Number(row.reconcileScannedCount ?? defaults.reconcileScannedCount),
    reconcileClosedCount: Number(row.reconcileClosedCount ?? defaults.reconcileClosedCount),
    reconcileSkippedCount: Number(row.reconcileSkippedCount ?? defaults.reconcileSkippedCount),
  }
}

/**
 * Operação administrativa interna. Não é chamada pelo runner, Sync, timeout
 * ou rota HTTP. Uso futuro: invocação fenced com service_role após autorização.
 */
export async function supersedeCollectionDiscoveryRun(input: {
  runId: string
  expectedStatus: Extract<CollectionDiscoveryStatus, "paused" | "failed">
  expectedLeaseGeneration: number
  reason: CollectionDiscoverySupersedeReason
}): Promise<DiscoverySupersedeResult> {
  const db = getOpsDb()
  const { data, error } = await db.rpc("supersede_collection_discovery_run", {
    p_run_id: input.runId,
    p_expected_status: input.expectedStatus,
    p_expected_lease_generation: input.expectedLeaseGeneration,
    p_reason: input.reason,
  })
  if (missingRpc(error)) return { ok: false, code: "missing_migration" }
  const payload = asRecord(data)
  if (error || !payload) return { ok: false, code: "invalid_input" }
  if (payload.ok !== true) {
    const code = String(payload.code ?? "invalid_input")
    if (
      code === "invalid_input" ||
      code === "not_found" ||
      code === "busy" ||
      code === "active_lease" ||
      code === "generation_mismatch" ||
      code === "status_mismatch" ||
      code === "already_terminal" ||
      code === "invalid_status"
    ) {
      return { ok: false, code }
    }
    return { ok: false, code: "invalid_input" }
  }
  const run = asRun(payload.run)
  if (!run) return { ok: false, code: "invalid_input" }
  const code = payload.code === "already_superseded" ? "already_superseded" : "superseded"
  return { ok: true, code, run }
}
