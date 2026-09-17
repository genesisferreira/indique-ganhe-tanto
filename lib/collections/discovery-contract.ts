import {
  OVERDUE_DISCOVERY_BUSINESS_TIMEZONE,
  OVERDUE_INVOICE_LIST_PAGE_SIZE,
  OVERDUE_INVOICE_LIST_SORT_DIR,
  OVERDUE_INVOICE_LIST_SORT_FIELD,
} from "@/lib/brbyte/overdue-invoice-list-query"

/** Contrato da consulta de atrasados usada pelo runner retomável. */
export const COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION =
  "overdue-invoice-list.keyset.v1" as const

export const COLLECTION_DISCOVERY_PAGINATION_STRATEGY =
  "keyset_invoice_pk_gt" as const

export const COLLECTION_DISCOVERY_TIMEZONE = OVERDUE_DISCOVERY_BUSINESS_TIMEZONE

export const COLLECTION_DISCOVERY_LIVE_QUERY_COMBINATION_VALIDATED = false

/**
 * Orçamento derivado do maxDuration da rota Node no Vercel (60s, padrão Pro),
 * não do desenho 240s em batch-sync-design.ts (nunca ligado ao runner).
 */
export const COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S = 60
export const COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_MS =
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S * 1000
export const COLLECTION_DISCOVERY_TIME_BUDGET_MS = 45_000
export const COLLECTION_DISCOVERY_LEASE_MS =
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_MS
export const COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH = 4
export const COLLECTION_DISCOVERY_PAGE_SIZE = OVERDUE_INVOICE_LIST_PAGE_SIZE
export const COLLECTION_DISCOVERY_SORT_FIELD = OVERDUE_INVOICE_LIST_SORT_FIELD
export const COLLECTION_DISCOVERY_SORT_DIR = OVERDUE_INVOICE_LIST_SORT_DIR
export const COLLECTION_DISCOVERY_BUDGET_MARGIN_MS = 5_000
export const COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS =
  COLLECTION_DISCOVERY_BUDGET_MARGIN_MS
export const COLLECTION_DISCOVERY_MIN_QUERY_TIMEOUT_MS = 1_000

export type CollectionDiscoveryStatus =
  | "running"
  | "paused"
  | "failed"
  | "pagination_ended"
  | "phases_completed"

export type CollectionDiscoveryPhase = "discovery" | "reconciliation"

export type CollectionDiscoveryRun = {
  id: string
  queryContractVersion: string
  referenceInstant: string
  referenceDate: string
  discoveryTimezone: string
  paginationStrategy: string
  cursorLastInvoicePk: string | null
  status: CollectionDiscoveryStatus
  leaseOwner: string | null
  leaseUntil: string | null
  leaseGeneration: number
  scannedPages: number
  scannedInvoices: number
  createdCount: number
  updatedCount: number
  skippedCount: number
  assignedCount: number
  unassignedCount: number
  errorCount: number
  reportedTotal: number | null
  lastErrorClass: string | null
  coverageProven: false
  uniqueOrderProven: false
  phase: CollectionDiscoveryPhase
  reconcileCursorInvoicePk: string | null
  reconcileScannedCount: number
  reconcileClosedCount: number
  reconcileSkippedCount: number
}

export type CollectionDiscoveryCounters = {
  scannedPages: number
  scannedInvoices: number
  createdCount: number
  updatedCount: number
  skippedCount: number
  assignedCount: number
  unassignedCount: number
  errorCount: number
  reportedTotal: number | null
}

export function emptyDiscoveryCounters(): CollectionDiscoveryCounters {
  return {
    scannedPages: 0,
    scannedInvoices: 0,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    assignedCount: 0,
    unassignedCount: 0,
    errorCount: 0,
    reportedTotal: null,
  }
}

export function emptyDiscoveryReconciliationFields(): {
  phase: CollectionDiscoveryPhase
  reconcileCursorInvoicePk: null
  reconcileScannedCount: number
  reconcileClosedCount: number
  reconcileSkippedCount: number
} {
  return {
    phase: "discovery",
    reconcileCursorInvoicePk: null,
    reconcileScannedCount: 0,
    reconcileClosedCount: 0,
    reconcileSkippedCount: 0,
  }
}

export function sanitizeDiscoveryErrorClass(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().slice(0, 80)
  if (!trimmed) return null
  if (/cookie|password|authorization|bearer|secret/i.test(trimmed)) {
    return "sanitized_error"
  }
  return trimmed
}

export function collectionDiscoveryRemainingBudgetMs(input: {
  startedAtMs: number
  nowMs: number
  budgetMs?: number
}): number {
  const budget = input.budgetMs ?? COLLECTION_DISCOVERY_TIME_BUDGET_MS
  return Math.max(0, budget - (input.nowMs - input.startedAtMs))
}

export function collectionDiscoveryShouldStopForTime(input: {
  remainingMs: number
  lastPageDurationMs: number
  marginMs?: number
}): boolean {
  const margin = input.marginMs ?? COLLECTION_DISCOVERY_BUDGET_MARGIN_MS
  return input.remainingMs < input.lastPageDurationMs + margin
}

/**
 * Timeout de consulta/hidratação limitado ao orçamento restante,
 * preservando margem para persistir e liberar a lease.
 * null = não iniciar a operação (pausar).
 * AbortSignal só deixa de aguardar a resposta; não cancela o ERP remoto.
 */
export function collectionDiscoveryCappedTimeoutMs(input: {
  remainingMs: number
  configuredTimeoutMs: number
  persistReleaseMarginMs?: number
  minTimeoutMs?: number
}): number | null {
  const margin =
    input.persistReleaseMarginMs ?? COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS
  const minTimeout = input.minTimeoutMs ?? COLLECTION_DISCOVERY_MIN_QUERY_TIMEOUT_MS
  const available = input.remainingMs - margin
  if (available < minTimeout) return null
  const configured = Math.max(1, input.configuredTimeoutMs)
  return Math.min(configured, available)
}
