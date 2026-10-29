/**
 * Sprint 3.1E-BA — continuação limitada de "Carregar próxima leva" (puro, sem I/O).
 *
 * Uma confirmação humana cria UMA operação (batchOperationId). A operação
 * executa no máximo `maxSegments` segmentos HTTP sequenciais; cada segmento
 * é uma chamada independente que retoma do cursor confirmado da mesma run.
 * Não é retry: qualquer erro/timeout encerra a operação. Sem loop ilimitado,
 * sem cron, sem continuação automática após refresh (o cliente só guarda o
 * id em memória; o servidor expira a operação por TTL).
 */

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

export type SegmentRecord = {
  segment: number
  ok: boolean
  scannedInvoices: number
  newContracts: number
  existingContractInvoices: number
  pauseStage: string | null
  durationMs: number
  stopReason: BatchStopReason | null
}

export type BatchOperation = {
  id: string
  createdAtMs: number
  lastActivityMs: number
  maxSegments: number
  status: "active" | "stopped"
  segmentInFlight: boolean
  stopRequested: boolean
  stopReason: BatchStopReason | null
  segments: SegmentRecord[]
}

export type ClaimSegmentResult =
  | { ok: true; operation: BatchOperation }
  | {
      ok: false
      code:
        | "unknown_operation"
        | "operation_stopped"
        | "segment_out_of_order"
        | "segment_in_flight"
        | "max_segments"
        | "stop_requested"
    }

export function createBatchOperationRegistry(opts: {
  now?: () => number
  newId: () => string
  ttlMs?: number
}) {
  const now = opts.now ?? Date.now
  const ttl = opts.ttlMs ?? NEXT_BATCH_OPERATION_TTL_MS
  const ops = new Map<string, BatchOperation>()

  const expire = () => {
    const t = now()
    for (const [id, op] of ops) {
      if (t - op.lastActivityMs > ttl) {
        if (op.status === "active") {
          op.status = "stopped"
          op.segmentInFlight = false
          op.stopReason = op.stopReason ?? "error"
        }
        ops.delete(id)
      }
    }
  }

  const activeOp = (): BatchOperation | null => {
    for (const op of ops.values()) if (op.status === "active") return op
    return null
  }

  return {
    /** Uma operação ativa por processo: bloqueia clique duplo e segunda aba. */
    begin(maxSegments: number): { ok: true; operation: BatchOperation } | { ok: false; code: "operation_active" } {
      expire()
      if (activeOp()) return { ok: false, code: "operation_active" }
      const t = now()
      const op: BatchOperation = {
        id: opts.newId(),
        createdAtMs: t,
        lastActivityMs: t,
        maxSegments: resolveMaxSegments(maxSegments),
        status: "active",
        segmentInFlight: false,
        stopRequested: false,
        stopReason: null,
        segments: [],
      }
      ops.set(op.id, op)
      return { ok: true, operation: op }
    },
    claimSegment(id: string, segment: number): ClaimSegmentResult {
      expire()
      const op = ops.get(id)
      if (!op) return { ok: false, code: "unknown_operation" }
      if (op.status !== "active") return { ok: false, code: "operation_stopped" }
      if (op.segmentInFlight) return { ok: false, code: "segment_in_flight" }
      if (segment !== op.segments.length + 1) return { ok: false, code: "segment_out_of_order" }
      if (op.stopRequested) {
        op.status = "stopped"
        op.stopReason = "stop_requested"
        return { ok: false, code: "stop_requested" }
      }
      if (segment > op.maxSegments) {
        op.status = "stopped"
        op.stopReason = "max_segments"
        return { ok: false, code: "max_segments" }
      }
      op.segmentInFlight = true
      op.lastActivityMs = now()
      return { ok: true, operation: op }
    },
    completeSegment(id: string, record: SegmentRecord): BatchOperation | null {
      const op = ops.get(id)
      if (!op) return null
      op.segmentInFlight = false
      op.lastActivityMs = now()
      op.segments.push(record)
      let reason = record.stopReason
      if (!reason && op.stopRequested) reason = "stop_requested"
      if (!reason && op.segments.length >= op.maxSegments) reason = "max_segments"
      if (reason) {
        op.status = "stopped"
        op.stopReason = reason
        op.segments[op.segments.length - 1] = { ...record, stopReason: reason }
      }
      return op
    },
    /** Encerra sem rodar segmento (gate de capacidade/lease antes do segmento). */
    stop(id: string, reason: BatchStopReason): BatchOperation | null {
      const op = ops.get(id)
      if (!op) return null
      op.segmentInFlight = false
      op.status = "stopped"
      op.stopReason = op.stopReason ?? reason
      return op
    },
    requestStop(id: string): BatchOperation | null {
      const op = ops.get(id)
      if (!op) return null
      op.stopRequested = true
      if (!op.segmentInFlight && op.status === "active") {
        op.status = "stopped"
        op.stopReason = "stop_requested"
      }
      return op
    },
    get(id: string): BatchOperation | null {
      return ops.get(id) ?? null
    },
    hasActive(): boolean {
      expire()
      return activeOp() != null
    },
  }
}

export type BatchOperationRegistry = ReturnType<typeof createBatchOperationRegistry>

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
  if (stage.startsWith("list_timeout") || stage === "pre_list_budget" || stage === "post_list_no_reserve") {
    return "timeout"
  }
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
