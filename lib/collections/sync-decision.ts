import {
  collectionCaseIdentityKey,
  computeDaysOverdue,
  nextCollectionStatusOnPaidSync,
  outstandingAmountFromInvoice,
  overdueSinceFromDueDate,
  shouldOpenCollectionCase,
} from "@/lib/collections/eligibility"
import { buildAuditedErpSnapshot } from "@/lib/collections/sanitize"
import { classifyClientContractCancellation } from "@/lib/operational/cancelled"
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
  clientStatus?: unknown
  contractStatus?: unknown
}

export type ExistingCollectionCase = {
  id: string
  status: CollectionCaseStatus | string
  invoicePk: string | null
}

export type CollectionSyncSkipReason =
  | "missing_identity"
  | "not_old_enough"
  | "insufficient_financial_data"
  | "paid_without_open_case"
  | "already_paid"
  | "already_closed"
  | "collections_disabled"
  | "cancelled_contract"
  | "inconclusive"

export type CollectionSyncDecision =
  | { action: "skip"; reason: CollectionSyncSkipReason }
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
    return { action: "skip", reason: "missing_identity" }
  }
  const daysOverdue = computeDaysOverdue({
    invoiceDueDate: input.invoice.invoiceDueDate,
    now: input.now,
  })

  if (input.invoice.isPaid) {
    if (!input.existing) return { action: "skip", reason: "paid_without_open_case" }
    if (input.existing.status === "paid") {
      return { action: "skip", reason: "already_paid" }
    }
    if (input.existing.status === "closed") {
      return { action: "skip", reason: "already_closed" }
    }
    return { action: "close_paid" }
  }

  const cancellation = classifyClientContractCancellation({
    clientStatus: input.invoice.clientStatus,
    contractStatus: input.invoice.contractStatus,
  })
  if (cancellation.skipAsCancelled) {
    return { action: "skip", reason: "cancelled_contract" }
  }
  if (cancellation.skipAsInconclusive) {
    return { action: "skip", reason: "inconclusive" }
  }

  if (input.collectionsEnabled === false) {
    return { action: "skip", reason: "collections_disabled" }
  }
  if (daysOverdue == null) {
    return { action: "skip", reason: "insufficient_financial_data" }
  }
  if (
    !shouldOpenCollectionCase({
      daysOverdue,
      isPaid: false,
      invoicePk: input.invoice.invoicePk,
      minimumDaysOverdue: input.minimumDaysOverdue,
      collectionsEnabled: true,
    })
  ) {
    return { action: "skip", reason: "not_old_enough" }
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
    // Sprint 3.1E-AU: status oficial do contrato (inteiro) para o bloco; não é PII.
    contract_status:
      typeof input.invoice.contractStatus === "number" && Number.isInteger(input.invoice.contractStatus)
        ? input.invoice.contractStatus
        : null,
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
