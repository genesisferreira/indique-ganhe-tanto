/**
 * Sprint 3.1E-AW - consolidação de casos legados duplicados por contrato (puro).
 *
 * Modelo antigo: um caso por fatura. Modelo novo: um caso ATIVO por contract_pk.
 * O caso secundário vira `consolidated` (terminal), aponta para o canônico e
 * preserva seus eventos; suas faturas passam a pertencer ao canônico.
 *
 * CANONICAL_SELECTION_POLICY: grupos AUTO_ONLY -> mais antigo por created_at,
 * desempate por UUID (determinístico, interno). Nunca por valor, nome,
 * invoice_pk, funcionário, posição de query ou metadata. Atividade humana ou
 * financeira -> sem escolha automática (exige decisão explícita).
 */

export const CONSOLIDATED_STATUS = "consolidated" as const
export const CONSOLIDATION_REASON = "duplicate_invoice_cases_same_contract" as const
export const CONSOLIDATION_ASSIGNMENT_RELEASE_REASON = "contract_case_consolidated" as const
export const CONSOLIDATION_RPC = "consolidate_collection_cases_by_contract" as const
export const CANONICAL_SELECTION_POLICY = "oldest_created_at_then_uuid_auto_only" as const

export const CONSOLIDATED_HISTORY_NOTICE =
  "Histórico consolidado: outro atendimento do mesmo contrato foi incorporado a este caso."
export const CONSOLIDATED_CASE_NOTICE =
  "Este atendimento foi incorporado ao caso ativo do mesmo contrato. Somente leitura."

export type DuplicateGroupClassification =
  | "AUTO_ONLY_SAFE_TO_CONSOLIDATE"
  | "HUMAN_ACTIVITY_REQUIRES_MANUAL_CHOICE"
  | "FINANCIAL_CONFLICT"
  | "ASSIGNMENT_CONFLICT"
  | "DATA_INTEGRITY_CONFLICT"

export type DuplicateCaseFacts = {
  id: string
  createdAt: string
  status: string
  contractPk: string | null
  invoicePk: string | null
  eventTypes: string[]
  assignmentSources: string[]
  activeAssigneeKey: string | null
  contactAttempts: number
  nonOpenInvoices: number
}

const PK = /^[1-9][0-9]*$/
const AUTO_EVENTS = new Set(["created", "assigned"])

export function isConsolidated(status: string | null | undefined): boolean {
  return status === CONSOLIDATED_STATUS
}

function hasHumanActivity(c: DuplicateCaseFacts): boolean {
  return (
    c.status !== "open" ||
    c.contactAttempts > 0 ||
    c.eventTypes.some((t) => !AUTO_EVENTS.has(t)) ||
    c.assignmentSources.some((s) => s !== "auto_assign")
  )
}

export function classifyDuplicateGroup(cases: DuplicateCaseFacts[]): DuplicateGroupClassification {
  if (cases.length < 2) return "DATA_INTEGRITY_CONFLICT"
  const contract = cases[0].contractPk
  if (!contract || !PK.test(contract) || cases.some((c) => c.contractPk !== contract)) return "DATA_INTEGRITY_CONFLICT"
  const invoices = cases.map((c) => c.invoicePk)
  if (invoices.some((i) => !i || !PK.test(i)) || new Set(invoices).size !== invoices.length) return "DATA_INTEGRITY_CONFLICT"
  if (cases.some((c) => c.eventTypes.includes("payment_detected") || c.nonOpenInvoices > 0)) return "FINANCIAL_CONFLICT"
  const human = cases.some(hasHumanActivity)
  if (human) {
    const assignees = new Set(cases.map((c) => c.activeAssigneeKey).filter(Boolean))
    return assignees.size > 1 ? "ASSIGNMENT_CONFLICT" : "HUMAN_ACTIVITY_REQUIRES_MANUAL_CHOICE"
  }
  return "AUTO_ONLY_SAFE_TO_CONSOLIDATE"
}

/** Canônico determinístico SOMENTE para AUTO_ONLY; caso contrário null (decisão explícita). */
export function selectCanonicalCase(cases: DuplicateCaseFacts[]): { canonicalId: string; secondaryIds: string[] } | null {
  if (classifyDuplicateGroup(cases) !== "AUTO_ONLY_SAFE_TO_CONSOLIDATE") return null
  const sorted = [...cases].sort((a, b) => {
    const ta = Date.parse(a.createdAt)
    const tb = Date.parse(b.createdAt)
    if (ta !== tb) return ta - tb
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return { canonicalId: sorted[0].id, secondaryIds: sorted.slice(1).map((c) => c.id) }
}

/** Consolidated não aparece como bloco operacional independente. */
export function operationalCases<T extends { status: string }>(items: T[]): T[] {
  return items.filter((i) => !isConsolidated(i.status))
}

/** Nenhum contato/transferência/atribuição em caso consolidado. */
export function consolidatedActionBlock(status: string | null | undefined): string | null {
  return isConsolidated(status)
    ? "Atendimento consolidado no caso ativo do mesmo contrato. Use o caso ativo."
    : null
}
