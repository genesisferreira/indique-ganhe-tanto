/**
 * SOMENTE DESENHO do sync em lotes — não há runner, lock real nem chamada ERP.
 * As funções abaixo calculam orçamento de tempo; não sincronizam cobrança.
 */
export const COLLECTION_BATCH_VERCEL_LIMIT_MS = 300_000
export const COLLECTION_BATCH_TIME_BUDGET_MS = 240_000
export const COLLECTION_BATCH_LOCK_KEY = "collections_controllr_invoice_sync"
export const COLLECTION_BATCH_DEFAULT_PAGE_SIZE = 20

export type CollectionBatchCoverage =
  | "not_started"
  | "partial"
  | "complete"
  | "failed"

export type CollectionBatchCheckpoint = {
  formatIndex: 0 | 1 | 2
  nextStart: number
  pageSize: number
  reportedTotal: number | null
  collectedCount: number
  lastSuccessfulPageAt: string | null
  coverage: CollectionBatchCoverage
  lastErrorClass: string | null
}

export type CollectionBatchRunStatus = {
  runId: string
  lockedUntil: string | null
  phase: "collect" | "distribute" | "idle"
  checkpoint: CollectionBatchCheckpoint
}

export function collectionBatchRemainingBudgetMs(input: {
  startedAtMs: number
  nowMs: number
  budgetMs?: number
}): number {
  const budget = input.budgetMs ?? COLLECTION_BATCH_TIME_BUDGET_MS
  return Math.max(0, budget - (input.nowMs - input.startedAtMs))
}

export function collectionBatchShouldStopForTime(input: {
  remainingMs: number
  lastPageDurationMs: number
}): boolean {
  return input.remainingMs < input.lastPageDurationMs + 5_000
}

/**
 * Coleta: avançar nextStart só após página HTTP 200 + shape válido.
 * Persistência de casos por invoice_pk único (já existente) — retomada
 * reprocessa a mesma página com update, sem create duplicado.
 * Distribuição: assign_sector_work_item numa fase posterior, mesmo lote
 * ou run seguinte, sem reconciliação por ausência até coverage=complete.
 * Concorrência: lock advisory/row em COLLECTION_BATCH_LOCK_KEY; segundo
 * POST retorna 409 se lockedUntil > now.
 * Erros: gravar lastErrorClass sanitizado e o cursor; não esgotar 300 s
 * com 3 formatos × 2 retries — um formato confirmado pelo probe, uma
 * tentativa por página, abortar o lote ao estourar o orçamento.
 */
export const COLLECTION_BATCH_DESIGN_RULES = [
  "cursor = nextStart + formatIndex confirmado pelo probe",
  "stop se remainingMs < lastPageDurationMs + 5000",
  "não fechar casos ausentes enquanto coverage !== complete",
  "collect e distribute são fases distintas",
  "lock impede dois runners",
] as const
