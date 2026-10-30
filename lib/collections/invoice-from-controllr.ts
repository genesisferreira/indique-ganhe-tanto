import { extractInvoiceMonetaryFields } from "@/lib/brbyte/invoice-amount"
import { computeDaysOverdue, isControllrInvoicePaid } from "@/lib/collections/eligibility"
import { classifyInvoiceDeletedFlag } from "@/lib/collections/skip-reason"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"
import { sanitizeCustomerDocument, sanitizeCustomerName } from "@/lib/collections/sanitize"
import { coalesceControllrStatus } from "@/lib/operational/cancelled"
import type { BrbyteInvoiceListRow } from "@/types/brbyte"
import {
  FINANCIAL_PROOF_REASONS,
  emptyFinancialProofHistogram,
  incrementFinancialProofReason,
  isFinancialProofReason,
  sanitizeFinancialProofHistogram,
  sumFinancialProofHistogram,
  type FinancialProofReason,
  type FinancialProofReasonHistogram,
} from "@/lib/collections/financial-proof"

export {
  FINANCIAL_PROOF_REASONS,
  emptyFinancialProofHistogram,
  incrementFinancialProofReason,
  isFinancialProofReason,
  sanitizeFinancialProofHistogram,
  sumFinancialProofHistogram,
}
export type { FinancialProofReason, FinancialProofReasonHistogram }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function firstText(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = readText(raw[key])
    if (found) return found
  }
  return null
}

export function presentCollectionInvoiceFromListRow(
  row: BrbyteInvoiceListRow
): CollectionSyncInvoice | null {
  const invoicePk = row.invoicePk?.trim() ?? ""
  const raw = asRecord(row.raw) ?? {}
  const deletedFlag = classifyInvoiceDeletedFlag(raw)
  if (
    !invoicePk ||
    row.invoiceDeleted ||
    deletedFlag.kind === "deleted" ||
    deletedFlag.kind === "inconclusive"
  ) {
    return null
  }
  const monetary = extractInvoiceMonetaryFields(raw)
  const invoiceMsg = firstText(raw, ["invoice_msg", "invoiceMsg"])
  const invoiceDateCredit = firstText(raw, [
    "invoice_date_credit",
    "invoiceDateCredit",
  ])
  return {
    invoicePk,
    contractPk: row.contractPk ?? firstText(raw, ["contract_pk", "contractPk"]),
    clientPk: firstText(raw, ["client_pk", "clientPk", "id_cliente", "idCliente"]),
    customerName: sanitizeCustomerName(
      firstText(raw, [
        "customer_name",
        "client_name",
        "invoice_client_name",
        "nombreCliente",
        "tercero_name",
        "nombreCompleto",
      ])
    ),
    customerDocument: sanitizeCustomerDocument(
      firstText(raw, [
        "customer_document",
        "client_document",
        "invoice_doc",
        "numeroIdentificacion",
        "cpf",
        "cnpj",
      ])
    ),
    invoiceDueDate: row.invoiceDueDate,
    invoiceMsg,
    invoiceDateCredit,
    isPaid: isControllrInvoicePaid({ invoiceMsg, invoiceDateCredit }),
    invoiceAmountDocument: monetary.invoiceAmountDocument,
    invoiceAmountPaid: monetary.invoiceAmountPaid,
    clientStatus: coalesceControllrStatus(raw, ["client_status", "clientStatus"]),
    contractStatus: coalesceControllrStatus(raw, ["contract_status", "contractStatus"]),
  }
}

export function collectionInvoiceNeedsDetailFetch(input: {
  invoice: CollectionSyncInvoice
  daysOverdue: number | null
  minimumDaysOverdue: number
  hasExistingCase: boolean
}): boolean {
  if (input.hasExistingCase) {
    return (
      input.invoice.invoiceMsg == null ||
      input.invoice.invoiceAmountDocument == null
    )
  }
  if (
    input.daysOverdue == null ||
    input.daysOverdue < input.minimumDaysOverdue
  ) {
    return false
  }
  return (
    input.invoice.invoiceMsg == null ||
    input.invoice.invoiceAmountDocument == null
  )
}

export function mergeInvoiceInfoIntoSyncInvoice(input: {
  invoice: CollectionSyncInvoice
  info: {
    invoiceMsg: string | null
    invoiceDateCredit: string | null
    invoiceAmountDocument: number | null
    invoiceAmountPaid: number | null
    isPaid: boolean
  }
}): CollectionSyncInvoice {
  const invoiceMsg = input.info.invoiceMsg ?? input.invoice.invoiceMsg
  const invoiceDateCredit =
    input.info.invoiceDateCredit ?? input.invoice.invoiceDateCredit
  return {
    ...input.invoice,
    invoiceMsg,
    invoiceDateCredit,
    isPaid: isControllrInvoicePaid({
      invoiceMsg,
      invoiceDateCredit,
      isPaid: input.info.isPaid,
    }),
    invoiceAmountDocument:
      input.info.invoiceAmountDocument ?? input.invoice.invoiceAmountDocument,
    invoiceAmountPaid:
      input.info.invoiceAmountPaid ?? input.invoice.invoiceAmountPaid,
  }
}

export function shouldInspectCollectionInvoice(input: {
  invoice: CollectionSyncInvoice
  now?: Date
  minimumDaysOverdue: number
  hasExistingCase: boolean
}): boolean {
  if (input.hasExistingCase) return true
  const daysOverdue = computeDaysOverdue({
    invoiceDueDate: input.invoice.invoiceDueDate,
    now: input.now,
  })
  return daysOverdue != null && daysOverdue >= input.minimumDaysOverdue
}

/**
 * Sprint 3.1E-BF/BG — razão primária, sanitizada e determinística de a
 * listagem (invoice/list) comprovar ou não os campos financeiros.
 * Allowlist fechada; uma única razão por linha, em ordem fixa. Sem valores,
 * sem identificadores, sem texto livre. `unknown_requirement` é fail-closed
 * (exige invoice_info). Regras IDÊNTICAS à 3.1E-BA: nenhuma prova relaxada.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export function collectionListRowFinancialProof(row: BrbyteInvoiceListRow): {
  proven: boolean
  reason: FinancialProofReason
} {
  const no = (reason: FinancialProofReason) => ({ proven: false, reason })
  const raw = asRecord(row.raw)
  if (!raw || !row.invoicePk?.trim()) return no("unknown_requirement")
  // 1. vencimento
  if (!row.invoiceDueDate) return no("missing_due_date")
  if (!validIsoDate(String(row.invoiceDueDate).slice(0, 10))) return no("invalid_due_date")
  // 2. contrato
  const contractPk = row.contractPk ?? firstText(raw, ["contract_pk", "contractPk"])
  if (!contractPk || !/^[1-9]\d*$/.test(contractPk.trim())) return no("missing_contract_pk")
  if (coalesceControllrStatus(raw, ["contract_status", "contractStatus"]) == null) {
    return no("invalid_contract_status")
  }
  // 3. invoice_deleted literal false
  if (row.invoiceDeleted) return no("invalid_invoice_deleted")
  const deleted = classifyInvoiceDeletedFlag(raw).kind
  if (deleted === "absent") return no("missing_invoice_deleted")
  if (deleted !== "not_deleted") return no("invalid_invoice_deleted")
  // 4. crédito presente e vazio
  const creditKeys = ["invoice_date_credit", "invoiceDateCredit"].filter((k) =>
    Object.prototype.hasOwnProperty.call(raw, k)
  )
  if (creditKeys.length === 0) return no("missing_credit_field")
  if (creditKeys.some((k) => readText(raw[k]) != null)) return no("nonempty_credit")
  // 5. valores
  const monetary = extractInvoiceMonetaryFields(raw)
  const doc = monetary.invoiceAmountDocument
  const paid = monetary.invoiceAmountPaid
  if (doc == null) return no("missing_document_amount")
  if (typeof doc !== "number" || !Number.isFinite(doc) || doc <= 0) return no("invalid_document_amount")
  if (paid == null) return no("missing_paid_amount")
  if (typeof paid !== "number" || !Number.isFinite(paid) || paid < 0) return no("invalid_paid_amount")
  if (paid >= doc) return no("paid_greater_or_equal_document")
  // 6. mensagem (ausência não é pagamento; "paid" exige detalhe)
  const msg = firstText(raw, ["invoice_msg", "invoiceMsg"])
  if (msg && msg.toLowerCase() === "paid") return no("paid_message")
  // 7. indício explícito de pagamento conflitante => detalhe (conservador)
  for (const key of ["is_paid", "isPaid"]) {
    const v = raw[key]
    if (v === true || v === 1 || v === "1" || v === "true") return no("conflicting_payment_evidence")
  }
  return { proven: true, reason: "proven" }
}

/** Compat 3.1E-BA: booleano derivado da razão primária. */
export function collectionListRowFinancialProven(row: BrbyteInvoiceListRow): boolean {
  return collectionListRowFinancialProof(row).proven
}

export type InvoiceDetailLookupDecision = "fetch" | "skip_list_sufficient" | "skip_not_needed"

export function decideInvoiceDetailLookup(input: {
  needsDetailByRule: boolean
  listFinancialProven: boolean
}): InvoiceDetailLookupDecision {
  if (!input.needsDetailByRule) return "skip_not_needed"
  if (input.listFinancialProven) return "skip_list_sufficient"
  return "fetch"
}
