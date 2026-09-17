import "server-only"

import { asRecord, asString, getOpsDb } from "@/lib/collections/db"
import type { DiscoveryClaimResult, DiscoveryStore, DiscoveryWriteResult } from "@/lib/collections/discovery-store"
import {
  COLLECTION_DISCOVERY_LEASE_MS,
  COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
  COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
  COLLECTION_DISCOVERY_TIMEZONE,
  emptyDiscoveryReconciliationFields,
  type CollectionDiscoveryCounters,
  type CollectionDiscoveryRun,
  type CollectionDiscoveryStatus,
} from "@/lib/collections/discovery-contract"

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
    coverageProven: false,
    uniqueOrderProven: false,
    phase: row.phase === "reconciliation" ? "reconciliation" : defaults.phase,
    reconcileCursorInvoicePk: asString(row.reconcileCursorInvoicePk),
    reconcileScannedCount: Number(row.reconcileScannedCount ?? defaults.reconcileScannedCount),
    reconcileClosedCount: Number(row.reconcileClosedCount ?? defaults.reconcileClosedCount),
    reconcileSkippedCount: Number(row.reconcileSkippedCount ?? defaults.reconcileSkippedCount),
  }
}

export function createOpsDiscoveryStore(): DiscoveryStore {
  const db = getOpsDb()
  return {
    async claimOrStart(input) {
      const { data, error } = await db.rpc("claim_collection_discovery_run", {
        p_owner: input.owner,
        p_lease_ms: input.leaseMs ?? COLLECTION_DISCOVERY_LEASE_MS,
        p_query_contract_version: COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
        p_reference_instant: input.referenceInstant.toISOString(),
        p_reference_date: input.referenceDate,
        p_discovery_timezone: COLLECTION_DISCOVERY_TIMEZONE,
        p_pagination_strategy: COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
        p_run_id: input.runId ?? null,
      })
      const payload = asRecord(data)
      if (error || !payload) {
        return { ok: false, code: "invalid_input" } satisfies DiscoveryClaimResult
      }
      if (payload.ok !== true) {
        const code = String(payload.code ?? "invalid_input")
        if (
          code === "busy" ||
          code === "incompatible_contract" ||
          code === "run_not_resumable" ||
          code === "not_found" ||
          code === "invalid_input"
        ) {
          return { ok: false, code }
        }
        return { ok: false, code: "invalid_input" }
      }
      const run = asRun(payload.run)
      if (!run) return { ok: false, code: "invalid_input" }
      return {
        ok: true,
        code: payload.created === true ? "created" : "claimed",
        created: payload.created === true,
        run,
      }
    },
    async advance(input: {
      runId: string
      owner: string
      generation: number
      now: Date
      cursorLastInvoicePk: string | null
      counters: CollectionDiscoveryCounters
      lastErrorClass?: string | null
    }) {
      const { data, error } = await db.rpc("advance_collection_discovery_checkpoint", {
        p_run_id: input.runId,
        p_owner: input.owner,
        p_generation: input.generation,
        p_cursor_last_invoice_pk: input.cursorLastInvoicePk,
        p_scanned_pages: input.counters.scannedPages,
        p_scanned_invoices: input.counters.scannedInvoices,
        p_created_count: input.counters.createdCount,
        p_updated_count: input.counters.updatedCount,
        p_skipped_count: input.counters.skippedCount,
        p_assigned_count: input.counters.assignedCount,
        p_unassigned_count: input.counters.unassignedCount,
        p_error_count: input.counters.errorCount,
        p_reported_total: input.counters.reportedTotal,
        p_last_error_class: input.lastErrorClass ?? null,
      })
      const payload = asRecord(data)
      if (error || payload?.ok !== true) {
        return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
      }
      const run = asRun(payload.run)
      if (!run) return { ok: false, code: "stale_lease" }
      return { ok: true, run }
    },
    async enterReconciliation(input) {
      const { data, error } = await db.rpc("enter_collection_reconciliation_phase", {
        p_run_id: input.runId,
        p_owner: input.owner,
        p_generation: input.generation,
      })
      if (missingRpc(error)) return { ok: false, code: "missing_migration" } satisfies DiscoveryWriteResult
      const payload = asRecord(data)
      if (error || payload?.ok !== true) {
        return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
      }
      const run = asRun(payload.run)
      if (!run) return { ok: false, code: "stale_lease" }
      return { ok: true, run }
    },
    async advanceReconciliation(input) {
      const { data, error } = await db.rpc("advance_collection_reconciliation_checkpoint", {
        p_run_id: input.runId,
        p_owner: input.owner,
        p_generation: input.generation,
        p_reconcile_cursor_invoice_pk: input.reconcileCursorInvoicePk,
        p_reconcile_scanned_count: input.reconcileScannedCount,
        p_reconcile_closed_count: input.reconcileClosedCount,
        p_reconcile_skipped_count: input.reconcileSkippedCount,
        p_last_error_class: input.lastErrorClass ?? null,
      })
      if (missingRpc(error)) return { ok: false, code: "missing_migration" } satisfies DiscoveryWriteResult
      const payload = asRecord(data)
      if (error || payload?.ok !== true) {
        return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
      }
      const run = asRun(payload.run)
      if (!run) return { ok: false, code: "stale_lease" }
      return { ok: true, run }
    },
    async release(input) {
      const { data, error } = await db.rpc("release_collection_discovery_run", {
        p_run_id: input.runId,
        p_owner: input.owner,
        p_generation: input.generation,
        p_status: input.status,
        p_last_error_class: input.lastErrorClass ?? null,
      })
      const payload = asRecord(data)
      if (error || payload?.ok !== true) {
        return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
      }
      const run = asRun(payload.run)
      if (!run) return { ok: false, code: "stale_lease" }
      return { ok: true, run }
    },
  }
}
