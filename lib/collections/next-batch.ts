/**
 * Sprint 3.1E-AU — "Carregar próxima leva" (puro, sem I/O).
 * Capacidade conta contract_pk distintos (CUSTOMER_DEDUPLICATION_SCOPE=contract_only).
 * capacity_full / busy / disabled são decididos ANTES de login ou invoice/list.
 */
import {
  CONTRACT_SCOPE_NOTICE,
  CUSTOMER_DEDUPLICATION_SCOPE,
  gateNextBatch,
  normalizeConfiguredCapacity,
} from "@/lib/collections/operational-model"

export const CONTRACT_CAPACITY_SOURCE = "contract_capacity" as const

export type NextBatchSummary = {
  /** 3.1E-AY: contrato único consumido por resumo E modal. */
  configuredCapacity: number
  activeContracts: number
  availableCapacity: number
  capacityFull: boolean
  source: typeof CONTRACT_CAPACITY_SOURCE
  configured: number
  occupying: number
  available: number
  unkeyed: number
  futurePromises: number
  futureCallbacks: number
  busy: boolean
  runStatus: string | null
  runPauseStage: string | null
  lastHealthProbe: string | null
  scope: typeof CUSTOMER_DEDUPLICATION_SCOPE
  scopeNotice: string
  erpNotice: string
}

export const NEXT_BATCH_ERP_NOTICE =
  "Ao confirmar, o CRM consulta o Controllr (somente leitura) para buscar faturas vencidas. Nenhuma mensagem é enviada."

/** Aceita objeto, array de 1 linha (PostgREST) e snake_case/camelCase. null => null (fail-closed). */
export function normalizeCapacityRow(raw: unknown): Record<string, unknown> | null {
  let r: unknown = raw
  if (Array.isArray(r)) r = r.length === 1 ? r[0] : null
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const obj = r as Record<string, unknown>
    const keys = Object.keys(obj)
    // RPC escalar em array: [{ collection_contract_capacity_summary: {...} }]
    if (keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === "object" && !("configured" in obj)) {
      return normalizeCapacityRow(obj[keys[0]])
    }
    return obj
  }
  return null
}

function pick(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k]
  return undefined
}

export function parseCapacitySummary(
  raw: unknown,
  run: { status: string | null; pauseStage: string | null } | null
): NextBatchSummary | null {
  const r = normalizeCapacityRow(raw)
  if (!r) return null
  const num = (v: unknown) => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  }
  const configuredRaw = pick(r, "configured", "configuredCapacity", "configured_capacity")
  const occupyingRaw = num(pick(r, "occupying", "activeContracts", "active_contracts"))
  if (configuredRaw === undefined || occupyingRaw === null) return null
  const configured = normalizeConfiguredCapacity(configuredRaw)
  const occupying = occupyingRaw
  const available = Math.max(0, configured - occupying)
  return {
    configuredCapacity: configured,
    activeContracts: occupying,
    availableCapacity: available,
    capacityFull: available <= 0,
    source: CONTRACT_CAPACITY_SOURCE,
    configured,
    occupying,
    available,
    unkeyed: num(r.unkeyed) ?? 0,
    futurePromises: num(pick(r, "futurePromises", "future_promises")) ?? 0,
    futureCallbacks: num(pick(r, "futureCallbacks", "future_callbacks")) ?? 0,
    busy: r.busy === true,
    runStatus: run?.status ?? null,
    runPauseStage: run?.pauseStage ?? null,
    lastHealthProbe: null,
    scope: CUSTOMER_DEDUPLICATION_SCOPE,
    scopeNotice: CONTRACT_SCOPE_NOTICE,
    erpNotice: NEXT_BATCH_ERP_NOTICE,
  }
}

/** Estado do resumo no cliente: loading != indisponível. */
export type CapacitySummaryState =
  | { status: "loading" }
  | { status: "ready"; summary: NextBatchSummary }
  | { status: "error"; message: string }

export function readCapacitySummaryResponse(httpOk: boolean, json: unknown): CapacitySummaryState {
  const j = json && typeof json === "object" ? (json as Record<string, unknown>) : null
  if (httpOk && j?.ok === true) {
    const s = j.summary as Record<string, unknown> | undefined
    if (s && s.source === CONTRACT_CAPACITY_SOURCE && typeof s.availableCapacity === "number") {
      return { status: "ready", summary: s as unknown as NextBatchSummary }
    }
  }
  return { status: "error", message: "Capacidade por contrato indisponível. Use “Atualizar resumo”." }
}

export function nextBatchConfirmMessage(available: number): string {
  return `Carregar até ${available} novos contratos elegíveis?`
}

export type NextBatchDecision =
  | { proceed: true; slots: number }
  | { proceed: false; code: "capacity_full" | "busy" | "disabled" | "in_flight"; message: string }

const MESSAGES = {
  capacity_full: "Capacidade de contratos cheia. Nenhuma consulta ao Controllr foi feita.",
  busy: "Já existe uma leva em execução. Aguarde a conclusão.",
  disabled: "Fila de Cobrança desligada nas configurações.",
  in_flight: "Já existe uma solicitação de próxima leva em andamento.",
} as const

export function decideNextBatch(input: {
  summary: Pick<NextBatchSummary, "available" | "busy">
  enabled: boolean
  inFlight: boolean
}): NextBatchDecision {
  if (input.inFlight) return { proceed: false, code: "in_flight", message: MESSAGES.in_flight }
  const gate = gateNextBatch({
    available: input.summary.available,
    activeRun: input.summary.busy,
    enabled: input.enabled,
  })
  if (!gate.ok) return { proceed: false, code: gate.code, message: MESSAGES[gate.code] }
  return { proceed: true, slots: gate.slots }
}

/** Corpo aceito: nada além de confirm=true. runId é recusado/ignorado. */
export function readNextBatchBody(body: unknown): { ok: true } | { ok: false; message: string } {
  const r = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if ("runId" in r) return { ok: false, message: "runId não é aceito. O servidor escolhe a execução." }
  if (r.confirm !== true) return { ok: false, message: "Confirmação obrigatória." }
  return { ok: true }
}

/** Resposta agregada e sanitizada (sem IDs, sem PII). */
export function sanitizeNextBatchResult(r: {
  ok: boolean
  discoveryStatus?: string | null
  pauseStage?: string | null
  contractsAdmitted?: number
  capacityReached?: boolean
  scannedPages?: number
  scannedInvoices?: number
  created?: number
  updated?: number
  skippedThisBatch?: number
  assigned?: number
  unassigned?: number
  errors?: number
  message?: string
  progressMade?: boolean
  segmentScannedInvoices?: number
  segmentCreated?: number
  segmentUpdated?: number
  stageTimings?: Record<string, number | null> | null
}) {
  return {
    ok: r.ok,
    discoveryStatus: r.discoveryStatus ?? null,
    pauseStage: r.pauseStage ?? null,
    contractsAdmitted: r.contractsAdmitted ?? 0,
    capacityReached: r.capacityReached === true,
    scannedPages: r.scannedPages ?? 0,
    scannedInvoices: r.scannedInvoices ?? 0,
    casesCreated: r.created ?? 0,
    invoicesUpdatedOrAttached: r.updated ?? 0,
    skippedThisBatch: r.skippedThisBatch ?? 0,
    assigned: r.assigned ?? 0,
    unassigned: r.unassigned ?? 0,
    errors: r.errors ?? 0,
    scope: CUSTOMER_DEDUPLICATION_SCOPE,
    message: r.message ?? null,
    progressMade: r.progressMade === true,
    segmentScannedInvoices: r.segmentScannedInvoices ?? 0,
    segmentCreated: r.segmentCreated ?? 0,
    segmentUpdated: r.segmentUpdated ?? 0,
    stageTimings: sanitizeStageTimings(r.stageTimings),
  }
}

/** Sprint 3.1E-BA: só números (durações/contagens). Nada de IDs/PII. */
export function sanitizeStageTimings(raw: unknown): Record<string, number | null> | null {
  if (!raw || typeof raw !== "object") return null
  const out: Record<string, number | null> = {}
  for (const key of [
    "loginMs", "listMs", "listRequests", "classificationMs", "detailLookups", "detailSkippedByList",
    "detailMs", "persistMs", "checkpointMs", "checkpoints", "releaseMs", "totalMs",
  ]) {
    const v = (raw as Record<string, unknown>)[key]
    out[key] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null
  }
  return out
}

/** Sprint 3.1E-BA: start (confirmação humana), continue (segmento N) ou stop. */
export type NextBatchRequest =
  | { kind: "start" }
  | { kind: "continue"; batchOperationId: string; segment: number }
  | { kind: "stop"; batchOperationId: string }

const OP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readNextBatchRequest(
  body: unknown
): { ok: true; request: NextBatchRequest } | { ok: false; message: string } {
  const r = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if ("runId" in r) return { ok: false, message: "runId não é aceito. O servidor escolhe a execução." }
  // 3.1E-BB: limites vêm do servidor/banco; o body nunca pode aumentá-los.
  if ("maxSegments" in r || "max_segments" in r || "nextSegment" in r || "ttl" in r) {
    return { ok: false, message: "maxSegments/nextSegment/ttl são definidos pelo servidor." }
  }
  if (r.batchOperationId === undefined) {
    const base = readNextBatchBody(body)
    return base.ok ? { ok: true, request: { kind: "start" } } : base
  }
  if (typeof r.batchOperationId !== "string" || !OP_ID.test(r.batchOperationId)) {
    return { ok: false, message: "batchOperationId inválido." }
  }
  if (r.stop === true) return { ok: true, request: { kind: "stop", batchOperationId: r.batchOperationId } }
  const seg = r.segment
  if (typeof seg !== "number" || !Number.isInteger(seg) || seg < 2) {
    return { ok: false, message: "Segmento de continuação inválido." }
  }
  return { ok: true, request: { kind: "continue", batchOperationId: r.batchOperationId, segment: seg } }
}
