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
 * Hobby + Fluid Compute no projeto v0-indique-ganhe-tanto:
 * default/teto da plataforma = 300s.
 * Sprint 3.1E-BG: a rota declara 240s; deadline lógico = 240s - 20s de margem
 * de plataforma = 220s. Login 30s, listagem 70s (headers + corpo, deadline
 * único que não reinicia após os headers), reserva persist/release 12s.
 * Sem retry de list/detail. maxSegments=5 e capacidade 15 inalterados.
 */
export const COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S = 240
export const COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_MS =
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S * 1000
export const COLLECTION_DISCOVERY_PLATFORM_MARGIN_MS = 20_000
export const COLLECTION_DISCOVERY_TIME_BUDGET_MS =
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_MS - COLLECTION_DISCOVERY_PLATFORM_MARGIN_MS
export const COLLECTION_DISCOVERY_LEASE_MS =
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_MS
/** Login observado ~24s; cap explícito para não comer a reserva de list+persist. */
export const COLLECTION_DISCOVERY_LOGIN_TIMEOUT_MS = 30_000
/**
 * Listagem observada ~24-50s (BC1/BE: continuação travou em 50s).
 * 3.1E-BG: 70s, inclui leitura do corpo; deadline não reinicia após headers.
 */
export const COLLECTION_DISCOVERY_LIST_TIMEOUT_MS = 70_000
/** Rótulos para relatório (antes/depois da 3.1E-BG). */
export const COLLECTION_DISCOVERY_BUDGET_HISTORY = {
  routeMaxDurationBeforeS: 120,
  logicalBudgetBeforeMs: 105_000,
  listTimeoutBeforeMs: 50_000,
} as const
/** 3.1E-BG: invoice_info em janelas de no máximo 2 (teto absoluto, não configurável pelo body). */
export const COLLECTION_DETAIL_CONCURRENCY_DEFAULT = 2
export const COLLECTION_DETAIL_CONCURRENCY_MAX = 2
export function resolveDetailConcurrency(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return COLLECTION_DETAIL_CONCURRENCY_DEFAULT
  return Math.max(1, Math.min(COLLECTION_DETAIL_CONCURRENCY_MAX, Math.floor(raw)))
}
export const COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH = 4
export const COLLECTION_DISCOVERY_PAGE_SIZE = OVERDUE_INVOICE_LIST_PAGE_SIZE
export const COLLECTION_DISCOVERY_SORT_FIELD = OVERDUE_INVOICE_LIST_SORT_FIELD
export const COLLECTION_DISCOVERY_SORT_DIR = OVERDUE_INVOICE_LIST_SORT_DIR
export const COLLECTION_DISCOVERY_BUDGET_MARGIN_MS = 5_000
export const COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS =
  COLLECTION_DISCOVERY_BUDGET_MARGIN_MS
/**
 * Reserva conservadora para persistir até pageSize=15 + advance + release
 * depois de uma listagem já limitada. Não inclui nova consulta ERP.
 */
export const COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS = 12_000
/** Folga mínima para o release depois da última escrita da página. */
export const COLLECTION_DISCOVERY_RELEASE_SLACK_MS = 2_000
export const COLLECTION_DISCOVERY_MIN_QUERY_TIMEOUT_MS = 1_000
export const COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS = 2

export type DiscoveryPauseStage =
  | "pre_list_budget"
  | "post_list_no_reserve"
  | "list_timeout_headers"
  | "list_timeout_body"
  | "partial_page"
  | "page_limit"
  | "page_confirmed_budget"
  | "recon_budget"
  | "zero_progress_loop"
  | "confirmed_prefix_budget"
  | "capacity_reached"
  | "full_page_confirmed"
  | "persist_error"
  | "stale_lease"
  | "detail_timeout"
  | "detail_error"

const PAUSE_STAGE_SET: ReadonlySet<string> = new Set([
  "pre_list_budget",
  "post_list_no_reserve",
  "list_timeout_headers",
  "list_timeout_body",
  "partial_page",
  "page_limit",
  "page_confirmed_budget",
  "recon_budget",
  "zero_progress_loop",
  "confirmed_prefix_budget",
  "capacity_reached",
  "full_page_confirmed",
  "persist_error",
  "stale_lease",
  "detail_timeout",
  "detail_error",
])

export type CollectionDiscoveryStatus =
  | "running"
  | "paused"
  | "failed"
  | "pagination_ended"
  | "phases_completed"
  | "superseded"

/** Motivos controlados da RPC supersede_collection_discovery_run. Texto livre é recusado. */
export const COLLECTION_DISCOVERY_SUPERSEDE_REASON_DUE_DATE_PARSER_BUG =
  "due_date_parser_bug" as const

export const COLLECTION_DISCOVERY_SUPERSEDE_REASONS = [
  COLLECTION_DISCOVERY_SUPERSEDE_REASON_DUE_DATE_PARSER_BUG,
] as const

export type CollectionDiscoverySupersedeReason =
  (typeof COLLECTION_DISCOVERY_SUPERSEDE_REASONS)[number]

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
  consecutiveNoProgress: number
  coverageProven: false
  uniqueOrderProven: false
  phase: CollectionDiscoveryPhase
  reconcileCursorInvoicePk: string | null
  reconcileScannedCount: number
  reconcileClosedCount: number
  reconcileSkippedCount: number
}

/**
 * Contadores acumulados no checkpoint. Compatibilidade:
 * - scannedInvoices = rows_seen = faturas com pk válido que atravessaram o loop,
 *   inclusive quando persist() responde skipped sem INSERT/UPDATE.
 * - skippedCount = skips do loop (mapeamento nulo + persist skipped).
 * - createdCount / updatedCount = INSERT / UPDATE reais de caso.
 * Não é contagem de casos gravados. Não renomear colunas SQL.
 */
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

export function formatDiscoveryPauseClass(
  stage: DiscoveryPauseStage,
  consecutiveNoProgress: number
): string {
  if (stage === "zero_progress_loop") return "zero_progress_loop"
  return `${stage}:${Math.max(0, Math.floor(consecutiveNoProgress))}`
}

export function parseDiscoveryPauseClass(value: string | null | undefined): {
  stage: DiscoveryPauseStage | null
  consecutive: number
} {
  if (!value) return { stage: null, consecutive: 0 }
  if (value === "zero_progress_loop") {
    return { stage: "zero_progress_loop", consecutive: COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS }
  }
  const match = /^([a-z_]+):(\d+)$/.exec(value)
  if (match && PAUSE_STAGE_SET.has(match[1])) {
    return {
      stage: match[1] as DiscoveryPauseStage,
      consecutive: Number(match[2]),
    }
  }
  if (PAUSE_STAGE_SET.has(value)) {
    return { stage: value as DiscoveryPauseStage, consecutive: 1 }
  }
  return { stage: null, consecutive: 0 }
}

export function readConsecutiveNoProgress(run: {
  consecutiveNoProgress?: number | null
  lastErrorClass?: string | null
}): number {
  const stored = Number(run.consecutiveNoProgress ?? 0)
  if (Number.isFinite(stored) && stored > 0) return Math.floor(stored)
  return parseDiscoveryPauseClass(run.lastErrorClass).consecutive
}

/**
 * Timeout da listagem: reserva persist+advance+release antes de consultar.
 * null = não iniciar a listagem.
 */
export function collectionDiscoveryListTimeoutMs(input: {
  remainingMs: number
  configuredTimeoutMs: number
}): number | null {
  return collectionDiscoveryCappedTimeoutMs({
    remainingMs: input.remainingMs,
    configuredTimeoutMs: input.configuredTimeoutMs,
    persistReleaseMarginMs: COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS,
  })
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
