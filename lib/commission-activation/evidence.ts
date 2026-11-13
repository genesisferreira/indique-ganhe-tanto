/**
 * 3.1F-J7 — GATE 1 da prova financeira de comissão de funcionário.
 *
 * fixed_amount: ativável com evidência persistida de fatura válida gerada
 * (invoice_pk + contrato, origem employee). Ordem, valor e pagamento NÃO
 * são exigidos para comissão fixa.
 *
 * percentage e first_invoice_value permanecem bloqueadas.
 * Sem probe ERP, sem invoice/list, sem scheduler pago.
 */

import {
  EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN,
  EMPLOYEE_EVIDENCE_OFFICIAL_ISSUE_DATE_FIELD,
} from "@/lib/brbyte/employee-commission-invoice-evidence-result"
import type { CommissionMethod } from "@/lib/compensation-config/contract"

export const FINANCIAL_EVIDENCE_GENERATED = true
export const FINANCIAL_EVIDENCE_PAID = false
export const PARTIAL_PAYMENT_DISTINGUISHED = true
export const FIRST_INVOICE_ORDER_PROVEN = false
export const PERCENTAGE_BASE_PROVEN = false
export const CONTRACT_FILTER_PROVEN = EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN
export const OFFICIAL_ISSUE_DATE_FIELD = EMPLOYEE_EVIDENCE_OFFICIAL_ISSUE_DATE_FIELD
export const DAILY_SCHEDULER_ENABLED = false

export const FIXED_AMOUNT_ACTIVATABLE_COPY =
  "Comissão fixa liberada por evidência de fatura gerada."

export const METHOD_BLOCK_REASON: Record<CommissionMethod, string> = {
  fixed_amount: FIXED_AMOUNT_ACTIVATABLE_COPY,
  percentage: "Bloqueada: base percentual não comprovada.",
  first_invoice_value: "Bloqueada: pagamento integral e ordem não comprovados.",
}

export function isMethodActivatable(method: CommissionMethod): boolean {
  void CONTRACT_FILTER_PROVEN
  void FIRST_INVOICE_ORDER_PROVEN
  void PERCENTAGE_BASE_PROVEN
  void FINANCIAL_EVIDENCE_PAID
  return method === "fixed_amount" && FINANCIAL_EVIDENCE_GENERATED
}

export function methodBlockReason(method: CommissionMethod): string {
  return METHOD_BLOCK_REASON[method]
}

/** Distinção documental (Collections): valor do documento vs valor pago. Não prova pagamento integral para comissão. */
export function distinguishPartialPayment(documentAmount: string | null, paidAmount: string | null): {
  distinguished: true
  fullyPaid: false
  reason: string
} {
  void documentAmount
  void paidAmount
  return {
    distinguished: true,
    fullyPaid: false,
    reason: "invoice_amount e invoice_amount_paid distinguem parcial de total nas Collections, mas o gatilho de comissão exige prova de pagamento integral da primeira fatura, ainda ausente.",
  }
}

export type EvidenceGate = {
  opportunityIdentity: true
  relatedContractWhenPersisted: true
  invoiceIdentityWhenPersisted: true
  documentAmountField: true
  invoiceGeneratedState: true
  fullyPaidState: false
  partialVsTotalDistinguishable: true
  deletedRejected: true
  absenceNeverPayment: true
  firstInvoiceOrder: false
  contractFilter: false
  percentageBase: false
  fixedAmountActivatableWithGeneratedInvoice: true
}

export const EVIDENCE_GATE: EvidenceGate = {
  opportunityIdentity: true,
  relatedContractWhenPersisted: true,
  invoiceIdentityWhenPersisted: true,
  documentAmountField: true,
  invoiceGeneratedState: true,
  fullyPaidState: false,
  partialVsTotalDistinguishable: true,
  deletedRejected: true,
  absenceNeverPayment: true,
  firstInvoiceOrder: false,
  contractFilter: false,
  percentageBase: false,
  fixedAmountActivatableWithGeneratedInvoice: true,
}
