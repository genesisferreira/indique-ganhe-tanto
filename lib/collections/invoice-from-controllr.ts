import { extractInvoiceMonetaryFields } from "@/lib/brbyte/invoice-amount"
import { computeDaysOverdue, isControllrInvoicePaid } from "@/lib/collections/eligibility"
import { classifyInvoiceDeletedFlag } from "@/lib/collections/skip-reason"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"
import { sanitizeCustomerDocument, sanitizeCustomerName } from "@/lib/collections/sanitize"
import { coalesceControllrStatus } from "@/lib/operational/cancelled"
import type { BrbyteInvoiceListRow } from "@/types/brbyte"

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
 * Sprint 3.1E-BA — a listagem (invoice/list) já comprova os campos financeiros?
 * true só quando TODOS estão explícitos na linha: vencimento, contract_pk,
 * contract_status, invoice_deleted=false, invoice_date_credit presente e vazio,
 * valor do documento e valor pago numéricos com pago < documento (aberto ou
 * parcial) e invoice_msg diferente de "paid". Qualquer ausência, conflito ou
 * indício de pagamento total => false (invoice_info continua necessário para
 * evidência positiva/conflito). Ausência NUNCA vira pagamento.
 */
export function collectionListRowFinancialProven(row: BrbyteInvoiceListRow): boolean {
  const raw = asRecord(row.raw)
  if (!raw) return false
  if (!row.invoicePk?.trim() || row.invoiceDeleted) return false
  if (classifyInvoiceDeletedFlag(raw).kind !== "not_deleted") return false
  if (!row.invoiceDueDate) return false
  const contractPk = row.contractPk ?? firstText(raw, ["contract_pk", "contractPk"])
  if (!contractPk || !/^[1-9]\d*$/.test(contractPk.trim())) return false
  if (coalesceControllrStatus(raw, ["contract_status", "contractStatus"]) == null) return false
  const creditKeys = ["invoice_date_credit", "invoiceDateCredit"].filter((k) =>
    Object.prototype.hasOwnProperty.call(raw, k)
  )
  if (creditKeys.length === 0) return false
  if (creditKeys.some((k) => readText(raw[k]) != null)) return false
  const msg = firstText(raw, ["invoice_msg", "invoiceMsg"])
  if (msg && msg.toLowerCase() === "paid") return false
  const monetary = extractInvoiceMonetaryFields(raw)
  const doc = monetary.invoiceAmountDocument
  const paid = monetary.invoiceAmountPaid
  if (typeof doc !== "number" || !Number.isFinite(doc) || doc <= 0) return false
  if (typeof paid !== "number" || !Number.isFinite(paid) || paid < 0) return false
  if (paid >= doc) return false
  return true
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
