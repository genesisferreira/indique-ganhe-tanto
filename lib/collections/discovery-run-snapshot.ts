import "server-only"

import { asRecord, asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import type { CollectionDiscoveryRun } from "@/lib/collections/discovery-contract"
import { emptyDiscoveryReconciliationFields } from "@/lib/collections/discovery-contract"

export type DiscoveryRunReadSnapshot = {
  status: CollectionDiscoveryRun["status"]
  phase: CollectionDiscoveryRun["phase"]
  referenceInstant: string
  referenceDate: string
  cursorLastInvoicePk: string | null
  cursorMode: "absent" | "present"
  scannedPages: number
  scannedInvoices: number
  createdCount: number
  updatedCount: number
  skippedCount: number
  assignedCount: number
  unassignedCount: number
  errorCount: number
  reportedTotal: number | null
  leaseGeneration: number
  leaseOwner: string | null
  leaseUntil: string | null
  consecutiveNoProgress: number
  lastErrorClass: string | null
  updatedAt: string | null
}

export type DiscoveryRunSnapshotReadResult =
  | { ok: true; snapshot: DiscoveryRunReadSnapshot }
  | {
      ok: false
      errorClass:
        | "no_resumable_run"
        | "multiple_resumable_runs"
        | "read_failed"
        | "invalid_run_shape"
    }

const RESUMABLE_STATUSES = ["running", "paused", "failed"] as const

function asRunSnapshot(value: unknown): DiscoveryRunReadSnapshot | null {
  const row = asRecord(value)
  if (!row) return null
  const status = String(row.status ?? "")
  if (
    status !== "running" &&
    status !== "paused" &&
    status !== "failed" &&
    status !== "pagination_ended" &&
    status !== "phases_completed" &&
    status !== "superseded"
  ) {
    return null
  }
  const defaults = emptyDiscoveryReconciliationFields()
  const cursor = asString(row.cursor_last_invoice_pk ?? row.cursorLastInvoicePk)
  const referenceInstantRaw = row.reference_instant ?? row.referenceInstant
  const referenceInstant =
    typeof referenceInstantRaw === "string"
      ? referenceInstantRaw
      : referenceInstantRaw != null
        ? new Date(String(referenceInstantRaw)).toISOString()
        : ""
  const referenceDate = String(row.reference_date ?? row.referenceDate ?? "").slice(0, 10)
  if (!referenceInstant || !referenceDate) return null
  const leaseUntilRaw = row.lease_until ?? row.leaseUntil
  const updatedAtRaw = row.updated_at ?? row.updatedAt
  return {
    status: status as CollectionDiscoveryRun["status"],
    phase: row.phase === "reconciliation" ? "reconciliation" : defaults.phase,
    referenceInstant,
    referenceDate,
    cursorLastInvoicePk: cursor,
    cursorMode: cursor ? "present" : "absent",
    scannedPages: Number(row.scanned_pages ?? row.scannedPages ?? 0),
    scannedInvoices: Number(row.scanned_invoices ?? row.scannedInvoices ?? 0),
    createdCount: Number(row.created_count ?? row.createdCount ?? 0),
    updatedCount: Number(row.updated_count ?? row.updatedCount ?? 0),
    skippedCount: Number(row.skipped_count ?? row.skippedCount ?? 0),
    assignedCount: Number(row.assigned_count ?? row.assignedCount ?? 0),
    unassignedCount: Number(row.unassigned_count ?? row.unassignedCount ?? 0),
    errorCount: Number(row.error_count ?? row.errorCount ?? 0),
    reportedTotal:
      row.reported_total == null && row.reportedTotal == null
        ? null
        : Number(row.reported_total ?? row.reportedTotal),
    leaseGeneration: Number(row.lease_generation ?? row.leaseGeneration ?? 0),
    leaseOwner: asString(row.lease_owner ?? row.leaseOwner),
    leaseUntil:
      leaseUntilRaw == null
        ? null
        : typeof leaseUntilRaw === "string"
          ? leaseUntilRaw
          : new Date(String(leaseUntilRaw)).toISOString(),
    consecutiveNoProgress: Number(
      row.consecutive_no_progress ?? row.consecutiveNoProgress ?? 0
    ),
    lastErrorClass: asString(row.last_error_class ?? row.lastErrorClass),
    updatedAt:
      updatedAtRaw == null
        ? null
        : typeof updatedAtRaw === "string"
          ? updatedAtRaw
          : new Date(String(updatedAtRaw)).toISOString(),
  }
}

/**
 * Leitura estritamente sanitizada da única run resumível.
 * Não claima, não renova lease, não incrementa generation,
 * não altera consecutiveNoProgress, não libera, não cria e não avança.
 */
export async function readUniqueResumableDiscoveryRunSnapshot(): Promise<DiscoveryRunSnapshotReadResult> {
  const db = getOpsDb()
  const { data, error } = await awaitQuery(
    db
      .from("collection_discovery_runs")
      .select(
        [
          "status",
          "phase",
          "reference_instant",
          "reference_date",
          "cursor_last_invoice_pk",
          "scanned_pages",
          "scanned_invoices",
          "created_count",
          "updated_count",
          "skipped_count",
          "assigned_count",
          "unassigned_count",
          "error_count",
          "reported_total",
          "lease_generation",
          "lease_owner",
          "lease_until",
          "consecutive_no_progress",
          "last_error_class",
          "updated_at",
        ].join(",")
      )
      .in("status", [...RESUMABLE_STATUSES])
  )

  if (error) {
    return { ok: false, errorClass: "read_failed" }
  }
  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) {
    return { ok: false, errorClass: "no_resumable_run" }
  }
  if (rows.length > 1) {
    return { ok: false, errorClass: "multiple_resumable_runs" }
  }
  const snapshot = asRunSnapshot(rows[0])
  if (!snapshot) {
    return { ok: false, errorClass: "invalid_run_shape" }
  }
  return { ok: true, snapshot }
}
