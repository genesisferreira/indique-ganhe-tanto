/**
 * 3.1F-J6 — GATE 1 da prova financeira de comissão de funcionário.
 *
 * Somente caminhos já persistidos / já documentados. Sem probe ERP, sem retry,
 * sem liberar invoice/list. Nenhuma modalidade é ativável nesta entrega.
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

export const METHOD_BLOCK_REASON: Record<CommissionMethod, string> = {
  fixed_amount:
    "Não ativável: a ordem estável da primeira fatura válida não está comprovada (campo oficial de emissão ausente; invoice/list com filtro de contrato não comprovado).",
  percentage:
    "Não ativável: a base percentual obrigatória no snapshot não foi comprovada, e a ordem da primeira fatura gerada permanece inconclusiva.",
  first_invoice_value:
    "Não ativável: pagamento integral da primeira fatura não está comprovado para comissão de funcionário (I&G usa invoice_msg+crédito, que não distingue parcial de total). Ordem da primeira fatura também inconclusiva.",
}

export function isMethodActivatable(method: CommissionMethod): boolean {
  void method
  void CONTRACT_FILTER_PROVEN
  void FIRST_INVOICE_ORDER_PROVEN
  void PERCENTAGE_BASE_PROVEN
  void FINANCIAL_EVIDENCE_PAID
  void FINANCIAL_EVIDENCE_GENERATED
  return false
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
}
