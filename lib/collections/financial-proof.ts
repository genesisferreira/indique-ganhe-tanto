/**
 * Sprint 3.1E-BF/BG — allowlist fechada das razões primárias de prova
 * financeira da listagem. Puro (sem I/O), seguro para cliente e servidor.
 * Sem valores, identificadores, payloads ou texto livre.
 */
export const FINANCIAL_PROOF_REASONS = [
  "proven",
  "missing_due_date",
  "invalid_due_date",
  "missing_contract_pk",
  "invalid_contract_status",
  "missing_invoice_deleted",
  "invalid_invoice_deleted",
  "missing_credit_field",
  "nonempty_credit",
  "missing_document_amount",
  "invalid_document_amount",
  "missing_paid_amount",
  "invalid_paid_amount",
  "paid_greater_or_equal_document",
  "missing_invoice_message",
  "paid_message",
  "conflicting_payment_evidence",
  "unknown_requirement",
] as const

export type FinancialProofReason = (typeof FINANCIAL_PROOF_REASONS)[number]
export type FinancialProofReasonHistogram = Partial<Record<FinancialProofReason, number>>

const FINANCIAL_PROOF_REASON_SET = new Set<string>(FINANCIAL_PROOF_REASONS)

export function isFinancialProofReason(value: unknown): value is FinancialProofReason {
  return typeof value === "string" && FINANCIAL_PROOF_REASON_SET.has(value)
}

export function emptyFinancialProofHistogram(): FinancialProofReasonHistogram {
  return {}
}

export function incrementFinancialProofReason(
  histogram: FinancialProofReasonHistogram,
  reason: FinancialProofReason
): void {
  const key: FinancialProofReason = isFinancialProofReason(reason) ? reason : "unknown_requirement"
  histogram[key] = (histogram[key] ?? 0) + 1
}

/** Recusa chaves fora da allowlist e valores não inteiros não negativos. */
export function sanitizeFinancialProofHistogram(raw: unknown): FinancialProofReasonHistogram | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out: FinancialProofReasonHistogram = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isFinancialProofReason(k)) return null
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100_000) return null
    if (v > 0) out[k] = v
  }
  return out
}

export function sumFinancialProofHistogram(h: FinancialProofReasonHistogram): number {
  return Object.values(h).reduce<number>((a, b) => a + (b ?? 0), 0)
}

