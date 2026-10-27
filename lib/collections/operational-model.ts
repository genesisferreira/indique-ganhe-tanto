/**
 * Sprint 3.1E-AU — modelo operacional CONTRATO → FATURAS (puro, sem I/O).
 *
 * LIMITAÇÃO FORMAL (CUSTOMER_DEDUPLICATION_SCOPE = contract_only):
 * - client_pk NÃO foi comprovado em invoice/list (3.1E-AS: inconclusivo);
 * - client_pk NÃO foi comprovado em invoice_info;
 * - não há consulta oficial contract→client no repositório (3.1E-AT);
 * - nunca usar nome, CPF/CNPJ, telefone, endereço ou e-mail como chave;
 * - um cliente com dois contratos pode aparecer em dois blocos;
 * - cada contrato tem no máximo um caso operacional ativo;
 * - todas as faturas do mesmo contrato aparecem juntas;
 * - nenhum contato simultâneo duplicado para o mesmo contrato.
 *
 * Identidade comprovada: invoice_pk e contract_pk.
 */
export const OPERATIONAL_UNIT = "distinct_contract" as const
export const CASE_UNIT = "contract" as const
export const INVOICE_UNIT = "invoice" as const
export const CUSTOMER_DEDUPLICATION_SCOPE = "contract_only" as const
export const COLLECTIONS_CLIENT_IDENTITY_PROVEN = false as const
export const COLLECTIONS_CLIENT_PK_REQUIRED = false as const
export const COLLECTIONS_ACTIVE_CONTRACT_CAPACITY = 15
export const COLLECTIONS_ACTIVE_CONTRACT_CAPACITY_MAX = 200
export const COLLECTIONS_BLOCK_BAND_DAYS = 15
export const COLLECTIONS_FIFTEEN_DAY_BAND_WRITES_ERP = false as const

export const CONTRACT_SCOPE_NOTICE =
  "Os atendimentos são agrupados por contrato. Clientes com mais de um contrato podem aparecer em blocos separados."

const PK = /^[1-9]\d*$/

export function parseProvenPk(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (typeof value !== "string") return null
  const t = value.trim()
  return PK.test(t) ? t : null
}

export type ContractCollectionsClass =
  | { kind: "eligible"; official: "ativado" | "bloqueado" | "outro" }
  | { kind: "cancelled_contract" }
  | { kind: "inconclusive" }

/** 1 ativado, 4 bloqueado (elegível), 5 cancelado (excluído), 0/2/3 elegíveis, resto inconclusivo. */
export function classifyContractStatusForCollections(status: unknown): ContractCollectionsClass {
  if (typeof status !== "number" || !Number.isInteger(status)) return { kind: "inconclusive" }
  if (status === 5) return { kind: "cancelled_contract" }
  if (status === 1) return { kind: "eligible", official: "ativado" }
  if (status === 4) return { kind: "eligible", official: "bloqueado" }
  if (status === 0 || status === 2 || status === 3) return { kind: "eligible", official: "outro" }
  return { kind: "inconclusive" }
}

/** Indicador de UI. Nunca altera o ERP; não substitui contract_status. */
export function contractBlockIndicator(input: {
  contractStatus: unknown
  daysOverdue: number | null
}): "Bloqueado no ERP" | "Cancelado no ERP" | "Em faixa de bloqueio" | null {
  if (input.contractStatus === 4) return "Bloqueado no ERP"
  if (input.contractStatus === 5) return "Cancelado no ERP"
  if (input.daysOverdue != null && input.daysOverdue >= COLLECTIONS_BLOCK_BAND_DAYS) {
    return "Em faixa de bloqueio"
  }
  return null
}

export type InvoicePaymentEvidence = "paid" | "open" | "absent" | "cancelled" | "inconclusive"

export type ContractInvoice = {
  invoicePk: string
  contractPk: string
  dueDate: string | null
  daysOverdue: number | null
  payment: InvoicePaymentEvidence
}

export type ContractCase = {
  contractPk: string
  invoices: ContractInvoice[]
  oldestDueDate: string | null
  maxDaysOverdue: number | null
  paidCount: number
  openCount: number
}

/** Agrupa faturas em um bloco por contract_pk; invoice_pk repetido não duplica. */
export function groupInvoicesByContract(rows: ContractInvoice[]): {
  cases: ContractCase[]
  inconclusive: number
} {
  const seen = new Set<string>()
  const map = new Map<string, ContractInvoice[]>()
  let inconclusive = 0
  for (const row of rows) {
    const inv = parseProvenPk(row.invoicePk)
    const con = parseProvenPk(row.contractPk)
    if (!inv || !con) {
      inconclusive += 1
      continue
    }
    if (seen.has(inv)) continue
    seen.add(inv)
    const list = map.get(con) ?? []
    list.push({ ...row, invoicePk: inv, contractPk: con })
    map.set(con, list)
  }
  const cases = [...map.entries()]
    .map(([contractPk, invoices]) => {
      invoices.sort((a, b) => (BigInt(a.invoicePk) < BigInt(b.invoicePk) ? -1 : 1))
      const dues = invoices.map((i) => i.dueDate).filter((d): d is string => !!d).sort()
      const days = invoices.map((i) => i.daysOverdue).filter((d): d is number => typeof d === "number")
      return {
        contractPk,
        invoices,
        oldestDueDate: dues[0] ?? null,
        maxDaysOverdue: days.length ? Math.max(...days) : null,
        paidCount: invoices.filter((i) => i.payment === "paid").length,
        openCount: invoices.filter((i) => i.payment !== "paid").length,
      }
    })
    .sort((a, b) => (a.oldestDueDate ?? "9999").localeCompare(b.oldestDueDate ?? "9999"))
  return { cases, inconclusive }
}

/**
 * Fechamento financeiro do caso do contrato: só quando TODAS as faturas
 * aplicáveis têm evidência positiva de pagamento. Ausência e cancelamento
 * não são pagamento.
 */
export function decideContractCaseClosure(
  invoices: Array<{ payment: InvoicePaymentEvidence }>
):
  | { action: "close_paid" }
  | { action: "keep_open"; pending: number }
  | { action: "route_cancellation_flow"; pending: number } {
  if (invoices.length === 0) return { action: "keep_open", pending: 0 }
  const pending = invoices.filter((i) => i.payment !== "paid").length
  if (pending === 0) return { action: "close_paid" }
  if (invoices.some((i) => i.payment === "cancelled")) {
    return { action: "route_cancellation_flow", pending }
  }
  return { action: "keep_open", pending }
}

/** Chave idempotente de payment_detected por fatura. */
export function paymentDetectedIdempotencyKey(caseId: string, invoicePk: string): string {
  return `payment_detected:${caseId}:${invoicePk}`
}

export type CapacityOccupant = {
  /** chave operacional: contract_pk comprovado. Nunca PII. */
  contractPk: string | null
  state:
    | "awaiting_first_contact"
    | "open"
    | "in_contact"
    | "unresolved"
    | "promise"
    | "callback"
    | "paid"
    | "cancelled"
    | "closed"
    | "escalated_out"
  dueAt?: string | null
}

export function occupiesCapacity(o: CapacityOccupant, now: Date): boolean {
  switch (o.state) {
    case "awaiting_first_contact":
    case "open":
    case "in_contact":
    case "unresolved":
      return true
    case "promise":
    case "callback": {
      const t = o.dueAt ? Date.parse(o.dueAt) : NaN
      // futura e válida não ocupa; vencida, ausente ou inválida ocupa
      return !(Number.isFinite(t) && t > now.getTime())
    }
    default:
      return false
  }
}

/** Mapeia status real de collection_cases para estado de capacidade. */
export function capacityStateFromCaseStatus(status: string): CapacityOccupant["state"] {
  switch (status) {
    case "open":
      return "open"
    case "in_contact":
      return "in_contact"
    case "unresolved":
      return "unresolved"
    case "promise_to_pay":
      return "promise"
    case "paid":
      return "paid"
    case "escalated_retention":
      return "escalated_out"
    default:
      return "closed"
  }
}

export function normalizeConfiguredCapacity(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return COLLECTIONS_ACTIVE_CONTRACT_CAPACITY
  return Math.min(n, COLLECTIONS_ACTIVE_CONTRACT_CAPACITY_MAX)
}

/**
 * availableCapacity = max(0, configuredCapacity - distinctActiveContracts).
 * Casos sem contract_pk válido contam individualmente (conservador, sem PII).
 */
export function computeCapacity(input: {
  configured?: number
  occupants: CapacityOccupant[]
  now: Date
}): {
  configured: number
  occupying: number
  available: number
  unkeyed: number
  futurePromises: number
  futureCallbacks: number
} {
  const configured = normalizeConfiguredCapacity(input.configured ?? COLLECTIONS_ACTIVE_CONTRACT_CAPACITY)
  const keys = new Set<string>()
  let unkeyed = 0
  let futurePromises = 0
  let futureCallbacks = 0
  for (const o of input.occupants) {
    if (!occupiesCapacity(o, input.now)) {
      if (o.state === "promise") futurePromises += 1
      if (o.state === "callback") futureCallbacks += 1
      continue
    }
    const k = parseProvenPk(o.contractPk)
    if (!k) unkeyed += 1
    else keys.add(k)
  }
  const occupying = keys.size + unkeyed
  return {
    configured,
    occupying,
    available: Math.max(0, configured - occupying),
    unkeyed,
    futurePromises,
    futureCallbacks,
  }
}

export type NextBatchGate =
  | { ok: true; slots: number }
  | { ok: false; code: "capacity_full" | "busy" | "disabled" }

/** Decide ANTES de qualquer login/consulta ao ERP. */
export function gateNextBatch(input: {
  available: number
  activeRun: boolean
  enabled?: boolean
}): NextBatchGate {
  if (input.enabled === false) return { ok: false, code: "disabled" }
  if (input.activeRun) return { ok: false, code: "busy" }
  if (!(input.available > 0)) return { ok: false, code: "capacity_full" }
  return { ok: true, slots: Math.floor(input.available) }
}

/** Planeja lote: só contratos novos consomem vaga; cancelados nunca; para em capacity_reached. */
export function planBatchSlots(input: {
  slots: number
  alreadyActiveContracts: Set<string>
  rows: Array<{ contractPk: string | null; contractStatus: unknown }>
}): { admittedContracts: string[]; capacityReached: boolean; cancelledSkipped: number; consumedRows: number } {
  const admitted: string[] = []
  const inBatch = new Set<string>()
  let cancelled = 0
  let consumed = 0
  for (const row of input.rows) {
    const cls = classifyContractStatusForCollections(row.contractStatus)
    const k = parseProvenPk(row.contractPk)
    const isNew = !!k && !input.alreadyActiveContracts.has(k) && !inBatch.has(k)
    if (cls.kind === "eligible" && isNew && admitted.length >= input.slots) {
      return { admittedContracts: admitted, capacityReached: true, cancelledSkipped: cancelled, consumedRows: consumed }
    }
    consumed += 1
    if (cls.kind === "cancelled_contract") {
      cancelled += 1
      continue
    }
    if (cls.kind !== "eligible" || !k) continue
    if (isNew) {
      inBatch.add(k)
      admitted.push(k)
    }
  }
  return {
    admittedContracts: admitted,
    capacityReached: admitted.length >= input.slots,
    cancelledSkipped: cancelled,
    consumedRows: consumed,
  }
}

export type ContractCardVisualState =
  | "Ativado"
  | "Bloqueado no ERP"
  | "Em faixa de bloqueio"
  | "Cancelado no ERP"
  | "Pagamento parcial"
  | "Todas as pendências pagas"
  | "Inconclusivo"

/** Estados visuais do card (somente apresentação). */
export function contractCardStates(input: {
  contractStatus: unknown
  maxDaysOverdue: number | null
  paidCount: number
  openCount: number
}): ContractCardVisualState[] {
  const out: ContractCardVisualState[] = []
  const cls = classifyContractStatusForCollections(input.contractStatus)
  if (cls.kind === "cancelled_contract") out.push("Cancelado no ERP")
  else if (cls.kind === "eligible" && cls.official === "bloqueado") out.push("Bloqueado no ERP")
  else if (cls.kind === "eligible" && cls.official === "ativado") out.push("Ativado")
  else if (cls.kind === "inconclusive") out.push("Inconclusivo")
  if (
    cls.kind !== "cancelled_contract" &&
    input.maxDaysOverdue != null &&
    input.maxDaysOverdue >= COLLECTIONS_BLOCK_BAND_DAYS &&
    !(cls.kind === "eligible" && cls.official === "bloqueado")
  ) {
    out.push("Em faixa de bloqueio")
  }
  if (input.paidCount > 0 && input.openCount > 0) out.push("Pagamento parcial")
  if (input.paidCount > 0 && input.openCount === 0) out.push("Todas as pendências pagas")
  return out
}

export const COLLECTION_WORK_STATUS_LABEL: Record<string, string> = {
  awaiting_contact: "Aguardando contato",
  open: "Aberto",
  in_contact: "Em contato",
  promise_to_pay: "Promessa de pagamento",
  follow_up_scheduled: "Retorno agendado",
  unresolved: "Não resolvido",
  escalated: "Escalado",
  escalated_retention: "Escalado (retenção)",
  paid: "Pago",
  cancelled: "Cancelado",
  closed: "Encerrado",
}
