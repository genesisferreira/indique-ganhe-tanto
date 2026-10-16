import { parseOverdueInvoicePk } from "@/lib/brbyte/overdue-invoice-list-query"
import type { CollectionSyncDecision } from "@/lib/collections/sync-decision"

/**
 * Motivos estáveis de skip na descoberta. Sem PII, invoice_pk, case_id,
 * payload ERP ou valores financeiros.
 *
 * cancelled_client_or_contract não entra: o código local não prova o campo
 * de cancelamento de cliente/contrato (CANCELLED_SCOPE_NOT_PROVEN).
 * existing_open_unchanged não entra: caso open existente segue update_open.
 */
export const DISCOVERY_SKIP_REASONS = [
  "not_old_enough",
  "paid_without_open_case",
  "already_paid",
  "already_closed",
  "removed_or_cancelled",
  "missing_identity",
  "insufficient_financial_data",
  "paid_open_deferred",
  "reopen_deferred",
  "collections_disabled",
  "inconclusive",
] as const

export type DiscoverySkipReason = (typeof DISCOVERY_SKIP_REASONS)[number]

export type DiscoverySkipHistogram = Record<DiscoverySkipReason, number>

export function emptyDiscoverySkipHistogram(): DiscoverySkipHistogram {
  return {
    not_old_enough: 0,
    paid_without_open_case: 0,
    already_paid: 0,
    already_closed: 0,
    removed_or_cancelled: 0,
    missing_identity: 0,
    insufficient_financial_data: 0,
    paid_open_deferred: 0,
    reopen_deferred: 0,
    collections_disabled: 0,
    inconclusive: 0,
  }
}

export function isDiscoverySkipReason(value: unknown): value is DiscoverySkipReason {
  return (
    typeof value === "string" &&
    (DISCOVERY_SKIP_REASONS as readonly string[]).includes(value)
  )
}

export function incrementDiscoverySkip(
  histogram: DiscoverySkipHistogram,
  reason: DiscoverySkipReason | null | undefined
): DiscoverySkipReason {
  const key = isDiscoverySkipReason(reason) ? reason : "inconclusive"
  histogram[key] += 1
  return key
}

export function sumDiscoverySkipHistogram(histogram: DiscoverySkipHistogram): number {
  let total = 0
  for (const reason of DISCOVERY_SKIP_REASONS) {
    total += histogram[reason]
  }
  return total
}

export function sanitizeDiscoverySkipHistogram(
  histogram: DiscoverySkipHistogram
): DiscoverySkipHistogram {
  const sanitized = emptyDiscoverySkipHistogram()
  for (const reason of DISCOVERY_SKIP_REASONS) {
    const value = histogram[reason]
    sanitized[reason] = Number.isInteger(value) && value >= 0 ? value : 0
  }
  return sanitized
}

export function discoverySkipReasonFromDecision(
  decision: CollectionSyncDecision
): DiscoverySkipReason | null {
  if (decision.action === "create" || decision.action === "update_open") return null
  if (decision.action === "close_paid") return "paid_open_deferred"
  if (decision.action === "reopen") return "reopen_deferred"
  if (decision.action === "skip") return decision.reason
  return "inconclusive"
}

export type InvoiceDeletedFlag =
  | { kind: "absent" }
  | { kind: "not_deleted" }
  | { kind: "deleted" }
  | { kind: "inconclusive" }

/**
 * Remoção só com booleano literal. String/número/objeto não viram deleted
 * nem autorizam create; flags booleanas contraditórias ficam inconclusive.
 */
export function classifyInvoiceDeletedFlag(
  raw: Record<string, unknown> | null | undefined
): InvoiceDeletedFlag {
  if (!raw) return { kind: "absent" }
  let booleanValue: boolean | undefined
  for (const key of ["invoice_deleted", "invoiceDeleted"]) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (value === true || value === false) {
      if (booleanValue !== undefined && booleanValue !== value) {
        return { kind: "inconclusive" }
      }
      booleanValue = value
      continue
    }
    return { kind: "inconclusive" }
  }
  if (booleanValue === undefined) return { kind: "absent" }
  return booleanValue ? { kind: "deleted" } : { kind: "not_deleted" }
}

export function classifyUnmappedDiscoveryRow(row: {
  invoicePk?: string | null
  invoiceDeleted?: boolean
  raw?: Record<string, unknown> | null
}): DiscoverySkipReason {
  const deleted = classifyInvoiceDeletedFlag(row.raw)
  if (deleted.kind === "inconclusive") return "inconclusive"
  if (deleted.kind === "deleted" || row.invoiceDeleted === true) {
    return "removed_or_cancelled"
  }
  if (!parseOverdueInvoicePk(row.invoicePk ?? null)) return "missing_identity"
  return "inconclusive"
}
