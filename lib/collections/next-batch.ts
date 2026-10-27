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

export type NextBatchSummary = {
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

export function parseCapacitySummary(
  raw: unknown,
  run: { status: string | null; pauseStage: string | null } | null
): NextBatchSummary {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const configured = normalizeConfiguredCapacity(r.configured)
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
  const occupying = num(r.occupying)
  return {
    configured,
    occupying,
    available: Math.max(0, configured - occupying),
    unkeyed: num(r.unkeyed),
    futurePromises: num(r.futurePromises),
    futureCallbacks: num(r.futureCallbacks),
    busy: r.busy === true,
    runStatus: run?.status ?? null,
    runPauseStage: run?.pauseStage ?? null,
    lastHealthProbe: null,
    scope: CUSTOMER_DEDUPLICATION_SCOPE,
    scopeNotice: CONTRACT_SCOPE_NOTICE,
    erpNotice: NEXT_BATCH_ERP_NOTICE,
  }
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
  }
}
