/**
 * Sprint 3.1E-BA — continuação limitada de "Carregar próxima leva" (puro, sem I/O).
 *
 * Uma confirmação humana cria UMA operação (batchOperationId). A operação
 * executa no máximo `maxSegments` segmentos HTTP sequenciais; cada segmento
 * é uma chamada independente que retoma do cursor confirmado da mesma run.
 * Não é retry: qualquer erro/timeout encerra a operação. Sem loop ilimitado,
 * sem cron, sem continuação automática após refresh.
 *
 * Sprint 3.1E-BB: o estado da operação é DURÁVEL (PostgreSQL,
 * public.collection_batch_operations). Nada crítico vive em memória de
 * instância; o registro em Map da BA foi removido.
 */

import {
  sanitizeFinancialProofHistogram,
  type FinancialProofReasonHistogram,
} from "@/lib/collections/financial-proof"

export const NEXT_BATCH_MAX_SEGMENTS_DEFAULT = 5
export const NEXT_BATCH_MAX_SEGMENTS_HARD_CAP = 10
export const NEXT_BATCH_OPERATION_TTL_MS = 10 * 60_000

export type BatchStopReason =
  | "error"
  | "timeout"
  | "zero_progress"
  | "capacity_reached"
  | "pagination_ended"
  | "max_segments"
  | "stop_requested"
  | "busy"

export const BATCH_STOP_REASON_LABEL: Record<BatchStopReason, string> = {
  error: "Erro no segmento (sem retry).",
  timeout: "Timeout no segmento (sem retry).",
  zero_progress: "Segmento sem progresso.",
  capacity_reached: "Capacidade de contratos atingida.",
  pagination_ended: "Paginação encerrada neste recorte.",
  max_segments: "Limite de segmentos atingido.",
  stop_requested: "Parado a pedido após o segmento atual.",
  busy: "Leva/lease ativa; segmento não iniciado.",
}

export function resolveMaxSegments(raw: unknown): number {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return NEXT_BATCH_MAX_SEGMENTS_DEFAULT
  return Math.min(NEXT_BATCH_MAX_SEGMENTS_HARD_CAP, Math.floor(n))
}

/** Decide a parada após um segmento. null => pode haver próximo segmento. */
export function decideSegmentStop(input: {
  ok: boolean
  discoveryStatus: string | null
  pauseStage: string | null
  progressMade: boolean
  capacityReached: boolean
  availableAfter: number | null
}): BatchStopReason | null {
  const stage = input.pauseStage ?? ""
  if (
    stage.startsWith("list_timeout") ||
    stage === "pre_list_budget" ||
    stage === "post_list_no_reserve" ||
    stage === "detail_timeout"
  ) {
    return "timeout"
  }
  // 3.1E-BG: detalhe indisponível encerra a operação (sem retry).
  if (stage === "detail_error") return "error"
  if (!input.ok || input.discoveryStatus === "failed" || input.discoveryStatus === "busy") return "error"
  if (
    input.discoveryStatus === "pagination_ended" ||
    input.discoveryStatus === "phases_completed" ||
    input.discoveryStatus === "completed"
  ) {
    return "pagination_ended"
  }
  if (input.capacityReached || (input.availableAfter != null && input.availableAfter <= 0)) {
    return "capacity_reached"
  }
  if (!input.progressMade) return "zero_progress"
  return null
}

/** Gate antes de cada segmento (capacidade recalculada + lease). */
export function gateSegmentStart(input: {
  available: number | null
  busy: boolean
  enabled: boolean
}): { ok: true; slots: number } | { ok: false; reason: BatchStopReason } {
  if (!input.enabled) return { ok: false, reason: "error" }
  if (input.busy) return { ok: false, reason: "busy" }
  if (input.available == null) return { ok: false, reason: "error" }
  if (input.available <= 0) return { ok: false, reason: "capacity_reached" }
  return { ok: true, slots: Math.floor(input.available) }
}

// ---------------------------------------------------------------------------
// Sprint 3.1E-BB: operação DURÁVEL (PostgreSQL). Nenhum estado crítico em
// memória de instância: create/claim/complete/stop/expire são RPCs atômicas
// em public.collection_batch_operations. Este módulo só tipa e lê respostas.
// ---------------------------------------------------------------------------

export const BATCH_OPERATION_ACTIVE_STATUSES = ["ready", "segment_running", "awaiting_next"] as const
export type DurableBatchStatus =
  | "ready"
  | "segment_running"
  | "awaiting_next"
  | "capacity_reached"
  | "pagination_ended"
  | "max_segments"
  | "stopped"
  | "failed"
  | "expired"
  | "completed"

export type DurableStopReason = BatchStopReason | "expired" | "unavailable" | "disabled"

export type DurableSegmentSummary = {
  segment: number
  ok: boolean
  scannedInvoices: number
  newContracts: number
  existingContractInvoices: number
  durationMs: number
  pauseStage: string | null
  stopReason: DurableStopReason | null
}

export type DurableBatchOperation = {
  id: string
  status: DurableBatchStatus
  active: boolean
  maxSegments: number
  segmentsStarted: number
  segmentsCompleted: number
  nextSegment: number
  segmentInFlight: number | null
  stopRequested: boolean
  stopReason: DurableStopReason | null
  expiresAt: string | null
  totals: { scannedInvoices: number; newContracts: number; existingContractInvoices: number; durationMs: number }
  segments: DurableSegmentSummary[]
}

/** 3.1E-BG: origem controlada pelo servidor; nunca lida do body. */
export const BATCH_INITIATION_SOURCE_ADMIN_CONFIRM = "admin_master_confirm" as const
export type BatchInitiationSource = typeof BATCH_INITIATION_SOURCE_ADMIN_CONFIRM

export const CLIENT_OPERATION_NONCE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isClientOperationNonce(v: unknown): v is string {
  return typeof v === "string" && CLIENT_OPERATION_NONCE_RE.test(v)
}

export type DurableOpResult = {
  ok: boolean
  code: string
  segment?: number
  replay?: boolean
  operation: DurableBatchOperation | null
}

/** Porta para o armazenamento durável (produção: RPCs Supabase/service_role). */
export interface BatchOperationStore {
  create(input: {
    maxSegments: number
    configuredCapacity: number
    available: number | null
    queueEnabled: boolean
    createdBy: string | null
    /**
     * 3.1E-BG: UUID gerado uma vez por confirmação; unique(setor, nonce).
     * Opcional só no tipo (stores BB/BD legados de teste); o fluxo SEMPRE envia
     * e a RPC de produção recusa ausência (invalid_input).
     */
    clientOperationNonce?: string
    /** 3.1E-BG: definido SOMENTE pelo servidor. */
    initiationSource?: BatchInitiationSource
  }): Promise<DurableOpResult>
  /** 3.1E-BG: o nonce deve coincidir com o da operação (RPC: nonce_mismatch). */
  claim(operationId: string, segment: number, clientOperationNonce?: string): Promise<DurableOpResult>
  complete(input: {
    operationId: string
    segment: number
    ok: boolean
    stopReason: DurableStopReason | null
    summary: { scannedInvoices: number; newContracts: number; existingContractInvoices: number; durationMs: number; pauseStage: string | null }
    /** 3.1E-BD: métricas sanitizadas gravadas na MESMA transação do complete. */
    metrics?: SegmentMetrics
  }): Promise<DurableOpResult>
  requestStop(operationId: string): Promise<DurableOpResult>
  get(operationId: string | null): Promise<DurableOpResult>
}

const STATUSES = new Set<string>([
  "ready", "segment_running", "awaiting_next", "capacity_reached", "pagination_ended",
  "max_segments", "stopped", "failed", "expired", "completed",
])
const REASONS = new Set<string>([
  "error", "timeout", "zero_progress", "capacity_reached", "pagination_ended", "max_segments",
  "stop_requested", "busy", "expired", "unavailable", "disabled",
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
const reason = (v: unknown): DurableStopReason | null => (typeof v === "string" && REASONS.has(v) ? (v as DurableStopReason) : null)

export function parseDurableOperation(raw: unknown): DurableBatchOperation | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== "string" || !UUID.test(r.id)) return null
  if (typeof r.status !== "string" || !STATUSES.has(r.status)) return null
  const agg = (r.aggregateCounters && typeof r.aggregateCounters === "object" ? r.aggregateCounters : {}) as Record<string, unknown>
  const segs = Array.isArray(agg.segments) ? agg.segments : []
  return {
    id: r.id,
    status: r.status as DurableBatchStatus,
    active: (BATCH_OPERATION_ACTIVE_STATUSES as readonly string[]).includes(r.status),
    maxSegments: int(r.maxSegments),
    segmentsStarted: int(r.segmentsStarted),
    segmentsCompleted: int(r.segmentsCompleted),
    nextSegment: int(r.nextSegment),
    segmentInFlight: typeof r.segmentInFlight === "number" ? r.segmentInFlight : null,
    stopRequested: r.stopRequested === true,
    stopReason: reason(r.stopReason),
    expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : null,
    totals: {
      scannedInvoices: int(agg.scannedInvoices),
      newContracts: int(agg.newContracts),
      existingContractInvoices: int(agg.existingContractInvoices),
      durationMs: int(agg.durationMs),
    },
    segments: segs
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        segment: int(s.segment),
        ok: s.ok === true,
        scannedInvoices: int(s.scannedInvoices),
        newContracts: int(s.newContracts),
        existingContractInvoices: int(s.existingContractInvoices),
        durationMs: int(s.durationMs),
        pauseStage: typeof s.pauseStage === "string" ? s.pauseStage : null,
        stopReason: reason(s.stopReason),
      })),
  }
}

export function parseDurableResult(raw: unknown): DurableOpResult {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    ok: r.ok === true,
    code: typeof r.code === "string" ? r.code : "invalid_response",
    segment: typeof r.segment === "number" ? r.segment : undefined,
    replay: r.replay === true,
    operation: parseDurableOperation(r.operation),
  }
}

export const DURABLE_STOP_REASON_LABEL: Record<DurableStopReason, string> = {
  ...BATCH_STOP_REASON_LABEL,
  expired: "Operação expirada (sem atividade por 10 min).",
  unavailable: "Capacidade indisponível; segmento não iniciado.",
  disabled: "Fila de Cobrança desligada; segmento não iniciado.",
}

/** Visão para a UI (sem created_by, sem IDs de cliente/contrato/fatura). */
export function durableOperationView(op: DurableBatchOperation | null, remainingSlots: number | null) {
  if (!op) return { batchOperation: null }
  return {
    batchOperationId: op.id,
    operationStatus: op.status,
    segment: op.segmentsCompleted,
    maxSegments: op.maxSegments,
    nextSegment: op.nextSegment,
    continue: op.status === "awaiting_next",
    resumable: op.status === "awaiting_next",
    stopRequested: op.stopRequested,
    stopReason: op.stopReason,
    stopReasonLabel: op.stopReason ? DURABLE_STOP_REASON_LABEL[op.stopReason] : null,
    remainingSlots,
    totals: op.totals,
    segments: op.segments,
  }
}

/**
 * Sprint 3.1E-BD — métricas duráveis por segmento (append-only no PostgreSQL,
 * public.collection_batch_operation_segments). SOMENTE números, booleano e
 * timestamp do início. Nunca IDs de cliente/contrato/fatura/caso, nomes,
 * documentos, telefones, valores, payload ERP, cookies, tokens ou mensagens.
 */
export const SEGMENT_METRIC_NUMBER_KEYS = [
  "totalMs", "loginMs", "listMs", "listRequests", "classificationMs", "detailLookups",
  "detailSkippedByList", "detailMs", "persistMs", "checkpointMs", "releaseMs",
  "rowsScanned", "confirmedPrefixRows", "newContracts", "existingContractInvoices",
  "invoicesAttached", "skippedTotal", "capacityBefore", "capacityAfter",
  // 3.1E-BG: métricas não sobrepostas (ver DiscoveryStageTimings).
  "detailWallMs", "detailRequestSumMs", "detailMaxConcurrency", "persistExclusiveMs",
] as const

export type SegmentMetrics = {
  startedAt: string | null
  cursorAdvanced: boolean
  /** 3.1E-BG: histograma agregado (allowlist fechada); null se ausente/inválido. */
  financialProofReasons: FinancialProofReasonHistogram | null
} & { [K in (typeof SEGMENT_METRIC_NUMBER_KEYS)[number]]: number | null }

/** Espelha COLLECTION_DETAIL_CONCURRENCY_MAX (teto absoluto 2). */
const DETAIL_CONCURRENCY_METRIC_CAP = 2

const metricInt = (v: unknown, cap: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(cap, Math.floor(v))) : null

/**
 * Monta as métricas a partir do resultado JÁ sanitizado do segmento
 * (sanitizeNextBatchResult) e dos resumos de capacidade antes/depois.
 * Chaves extras são descartadas; somente a lista fechada sai daqui.
 */
export function buildSegmentMetrics(input: {
  startedAtMs: number | null
  totalMs: number | null
  stageTimings: Record<string, number | null> | null | undefined
  segmentScannedInvoices: number | null | undefined
  newContracts: number | null | undefined
  existingContractInvoices: number | null | undefined
  segmentCreated: number | null | undefined
  skippedThisBatch: number | null | undefined
  capacityBefore: number | null | undefined
  capacityAfter: number | null | undefined
  financialProofReasons?: unknown
}): SegmentMetrics {
  const t = (input.stageTimings ?? {}) as Record<string, unknown>
  const MS = 3_600_000
  const ROWS = 100_000
  const scanned = metricInt(input.segmentScannedInvoices, ROWS) ?? 0
  const existing = metricInt(input.existingContractInvoices, ROWS) ?? 0
  const created = metricInt(input.segmentCreated, ROWS) ?? 0
  const startedAt =
    typeof input.startedAtMs === "number" && Number.isFinite(input.startedAtMs)
      ? new Date(input.startedAtMs).toISOString()
      : null
  return {
    startedAt,
    totalMs: metricInt(input.totalMs, MS),
    loginMs: metricInt(t.loginMs, MS),
    listMs: metricInt(t.listMs, MS),
    listRequests: metricInt(t.listRequests, ROWS),
    classificationMs: metricInt(t.classificationMs, MS),
    detailLookups: metricInt(t.detailLookups, ROWS),
    detailSkippedByList: metricInt(t.detailSkippedByList, ROWS),
    detailMs: metricInt(t.detailMs, MS),
    persistMs: metricInt(t.persistMs, MS),
    checkpointMs: metricInt(t.checkpointMs, MS),
    releaseMs: metricInt(t.releaseMs, MS),
    rowsScanned: scanned,
    // Contadores da run só avançam no checkpoint do prefixo confirmado.
    confirmedPrefixRows: scanned,
    newContracts: metricInt(input.newContracts, 15) ?? 0,
    existingContractInvoices: existing,
    invoicesAttached: created + existing,
    skippedTotal: metricInt(input.skippedThisBatch, ROWS) ?? 0,
    cursorAdvanced: scanned > 0,
    capacityBefore: metricInt(input.capacityBefore, 15),
    capacityAfter: metricInt(input.capacityAfter, 15),
    detailWallMs: metricInt(t.detailWallMs, MS),
    detailRequestSumMs: metricInt(t.detailRequestSumMs, MS),
    detailMaxConcurrency: metricInt(t.detailMaxConcurrency, DETAIL_CONCURRENCY_METRIC_CAP),
    persistExclusiveMs: metricInt(t.persistExclusiveMs, MS),
    financialProofReasons: sanitizeFinancialProofHistogram(input.financialProofReasons),
  }
}
