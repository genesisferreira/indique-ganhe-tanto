import {
  collectionCaseIdentityKey,
  computeDaysOverdue,
  nextCollectionStatusOnPaidSync,
  outstandingAmountFromInvoice,
  overdueSinceFromDueDate,
  shouldOpenCollectionCase,
} from "@/lib/collections/eligibility"
import { buildAuditedErpSnapshot } from "@/lib/collections/sanitize"
import type { CollectionCaseStatus } from "@/types/collections"

export type CollectionSyncInvoice = {
  invoicePk: string
  contractPk: string | null
  clientPk: string | null
  customerName: string | null
  customerDocument: string | null
  invoiceDueDate: string | null
  invoiceMsg: string | null
  invoiceDateCredit: string | null
  isPaid: boolean
  invoiceAmountDocument: number | null
  invoiceAmountPaid: number | null
}

export type ExistingCollectionCase = {
  id: string
  status: CollectionCaseStatus | string
  invoicePk: string | null
}

export type CollectionSyncDecision =
  | { action: "skip"; reason: "no_invoice_pk" | "not_overdue" | "paid_no_case" | "already_paid" | "already_closed" }
  | { action: "create" }
  | { action: "update_open" }
  | { action: "reopen" }
  | { action: "close_paid" }

export function decideCollectionSyncAction(input: {
  invoice: CollectionSyncInvoice
  existing: ExistingCollectionCase | null
  now?: Date
  minimumDaysOverdue?: number
  collectionsEnabled?: boolean
}): CollectionSyncDecision {
  if (!collectionCaseIdentityKey({ invoicePk: input.invoice.invoicePk })) {
    return { action: "skip", reason: "no_invoice_pk" }
  }
  const daysOverdue = computeDaysOverdue({
    invoiceDueDate: input.invoice.invoiceDueDate,
    now: input.now,
  })
  const eligible = shouldOpenCollectionCase({
    daysOverdue,
    isPaid: input.invoice.isPaid,
    invoicePk: input.invoice.invoicePk,
    minimumDaysOverdue: input.minimumDaysOverdue,
    collectionsEnabled: input.collectionsEnabled,
  })

  if (input.invoice.isPaid) {
    if (!input.existing) return { action: "skip", reason: "paid_no_case" }
    if (input.existing.status === "paid" || input.existing.status === "closed") {
      return { action: "skip", reason: "already_paid" }
    }
    return { action: "close_paid" }
  }

  if (!eligible) {
    return { action: "skip", reason: "not_overdue" }
  }

  if (!input.existing) return { action: "create" }
  if (input.existing.status === "escalated_retention") return { action: "update_open" }
  if (input.existing.status === "paid" || input.existing.status === "closed") {
    return { action: "reopen" }
  }
  return { action: "update_open" }
}

export function buildCollectionCaseWriteModel(input: {
  invoice: CollectionSyncInvoice
  now?: Date
}) {
  const daysOverdue = computeDaysOverdue({
    invoiceDueDate: input.invoice.invoiceDueDate,
    now: input.now,
  })
  return {
    client_pk: input.invoice.clientPk,
    contract_pk: input.invoice.contractPk,
    invoice_pk: input.invoice.invoicePk,
    customer_name: input.invoice.customerName,
    customer_document: input.invoice.customerDocument,
    days_overdue: daysOverdue ?? 0,
    overdue_since: overdueSinceFromDueDate(input.invoice.invoiceDueDate),
    outstanding_amount: outstandingAmountFromInvoice({
      invoiceAmountDocument: input.invoice.invoiceAmountDocument,
      invoiceAmountPaid: input.invoice.invoiceAmountPaid,
    }),
    erp_snapshot: buildAuditedErpSnapshot({
      invoicePk: input.invoice.invoicePk,
      contractPk: input.invoice.contractPk,
      clientPk: input.invoice.clientPk,
      invoiceDueDate: input.invoice.invoiceDueDate,
      invoiceMsg: input.invoice.invoiceMsg,
      invoiceDateCredit: input.invoice.invoiceDateCredit,
      isPaid: input.invoice.isPaid,
      invoiceAmountDocument: input.invoice.invoiceAmountDocument,
      invoiceAmountPaid: input.invoice.invoiceAmountPaid,
      daysOverdue,
    }),
  }
}

export { nextCollectionStatusOnPaidSync }
