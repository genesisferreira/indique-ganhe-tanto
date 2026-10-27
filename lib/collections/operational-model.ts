/**
 * Sprint 3.1E-AR — modelo operacional CONTRATO → FATURAS (puro, sem I/O).
 *
 * Identidade comprovada: invoice_pk (invoice/list + invoice_info) e
 * contract_pk (invoice/list: filtro where[contract_pk] e coluna da linha).
 * client_pk NÃO está comprovado em invoice/list nem invoice_info (o parser
 * oficial não o extrai; o normalizador de Cobrança só lê aliases não
 * comprovados). Por isso agrupamento por cliente, trava por cliente e
 * capacidade por cliente distinto ficam bloqueados por
 * COLLECTIONS_CLIENT_IDENTITY_PROVEN=false. Nunca deduplicar por
 * nome/CPF/telefone/endereço.
 */
export const COLLECTIONS_CLIENT_IDENTITY_PROVEN = false as const
export const COLLECTIONS_ACTIVE_CUSTOMER_CAPACITY = 15
export const COLLECTIONS_BLOCK_BAND_DAYS = 15

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

/** Indicador de UI. Nunca altera o ERP. */
export function contractBlockIndicator(input: {
  contractStatus: unknown
  daysOverdue: number | null
}): "Bloqueado no ERP" | "Cancelado no ERP" | "Atraso em faixa de bloqueio" | null {
  if (input.contractStatus === 4) return "Bloqueado no ERP"
  if (input.contractStatus === 5) return "Cancelado no ERP"
  if (input.daysOverdue != null && input.daysOverdue >= COLLECTIONS_BLOCK_BAND_DAYS) {
    return "Atraso em faixa de bloqueio"
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
  paidCount: number
  openCount: number
}

/** Agrupa faturas em um caso por contract_pk; invoice_pk repetido não duplica. */
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
      return {
        contractPk,
        invoices,
        oldestDueDate: dues[0] ?? null,
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
 * não são pagamento. Cancelamento encaminha ao fluxo de cancelamento sem
 * apagar dívida (fechamento operacional ≠ financeiro).
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
  /** chave operacional; só client_pk comprovado é aceito. */
  clientPk: string | null
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
      // futura e válida não ocupa; vencida ou inválida ocupa
      return !(Number.isFinite(t) && t > now.getTime())
    }
    default:
      return false
  }
}

export function computeCapacity(input: {
  configured?: number
  occupants: CapacityOccupant[]
  now: Date
}): { configured: number; occupying: number; available: number; unkeyed: number } {
  const configured = Math.max(0, Math.floor(input.configured ?? COLLECTIONS_ACTIVE_CUSTOMER_CAPACITY))
  const keys = new Set<string>()
  let unkeyed = 0
  for (const o of input.occupants) {
    if (!occupiesCapacity(o, input.now)) continue
    const k = parseProvenPk(o.clientPk)
    if (!k) unkeyed += 1
    else keys.add(k)
  }
  const occupying = keys.size + unkeyed
  return { configured, occupying, available: Math.max(0, configured - occupying), unkeyed }
}

export type NextBatchGate =
  | { ok: true; slots: number }
  | { ok: false; code: "capacity_full" | "busy" | "client_identity_unproven" }

/** Decide antes de qualquer consulta ao ERP. */
export function gateNextBatch(input: {
  available: number
  activeRun: boolean
  clientIdentityProven?: boolean
}): NextBatchGate {
  if (!(input.clientIdentityProven ?? COLLECTIONS_CLIENT_IDENTITY_PROVEN)) {
    return { ok: false, code: "client_identity_unproven" }
  }
  if (input.activeRun) return { ok: false, code: "busy" }
  if (input.available <= 0) return { ok: false, code: "capacity_full" }
  return { ok: true, slots: input.available }
}

/** Planeja lote: só clientes novos consomem vaga; cancelados nunca. */
export function planBatchSlots(input: {
  slots: number
  alreadyActiveClients: Set<string>
  rows: Array<{ clientPk: string | null; contractStatus: unknown }>
}): { admittedClients: string[]; capacityReached: boolean; cancelledSkipped: number; consumedRows: number } {
  const admitted: string[] = []
  const inBatch = new Set<string>()
  let cancelled = 0
  let consumed = 0
  for (const row of input.rows) {
    const cls = classifyContractStatusForCollections(row.contractStatus)
    const k = parseProvenPk(row.clientPk)
    const isNew = !!k && !input.alreadyActiveClients.has(k) && !inBatch.has(k)
    if (cls.kind === "eligible" && isNew && admitted.length >= input.slots) {
      return { admittedClients: admitted, capacityReached: true, cancelledSkipped: cancelled, consumedRows: consumed }
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
    admittedClients: admitted,
    capacityReached: admitted.length >= input.slots,
    cancelledSkipped: cancelled,
    consumedRows: consumed,
  }
}
