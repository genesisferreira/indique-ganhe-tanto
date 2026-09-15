import { extractInvoiceMonetaryFields } from "@/lib/brbyte/invoice-amount"
import { computeDaysOverdue, isControllrInvoicePaid } from "@/lib/collections/eligibility"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"
import { sanitizeCustomerDocument, sanitizeCustomerName } from "@/lib/collections/sanitize"
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
  if (!invoicePk || row.invoiceDeleted) return null
  const raw = asRecord(row.raw) ?? {}
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
