import {
  COLLECTION_OPEN_STATUSES,
  COLLECTION_OVERDUE_THRESHOLD_DAYS,
  type CollectionCaseStatus,
} from "@/types/collections"

/** Pago no Controllr: invoice_msg === "paid" E invoice_date_credit presente. */
export function isControllrInvoicePaid(input: {
  invoiceMsg?: string | null
  invoiceDateCredit?: string | null
  isPaid?: boolean | null
}): boolean {
  if (input.isPaid === true) return true
  const msg = input.invoiceMsg?.trim().toLowerCase() ?? ""
  return msg === "paid" && Boolean(input.invoiceDateCredit?.trim())
}

export function parseInvoiceDueDate(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null
  const parsed = Date.parse(value.trim())
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed)
}

/**
 * Dias de atraso server-side a partir de invoice_due_date (UTC date).
 * O ERP não envia days_overdue — este cálculo é a fonte operacional.
 */
export function computeDaysOverdue(input: {
  invoiceDueDate: string | null | undefined
  now?: Date
}): number | null {
  const due = parseInvoiceDueDate(input.invoiceDueDate)
  if (!due) return null
  const now = input.now ?? new Date()
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const diffDays = Math.floor((nowUtc - dueUtc) / 86_400_000)
  return diffDays
}

export function isCollectionOverdueEligible(daysOverdue: number | null | undefined): boolean {
  if (daysOverdue == null || !Number.isFinite(daysOverdue)) return false
  return daysOverdue >= COLLECTION_OVERDUE_THRESHOLD_DAYS
}

export function collectionCaseIdentityKey(input: {
  invoicePk?: string | null
  contractPk?: string | null
}): { kind: "invoice"; invoicePk: string } | null {
  const invoicePk = input.invoicePk?.trim() ?? ""
  if (!invoicePk) return null
  return { kind: "invoice", invoicePk }
}

export function shouldOpenCollectionCase(input: {
  daysOverdue: number | null | undefined
  isPaid: boolean
  invoicePk?: string | null
}): boolean {
  if (!collectionCaseIdentityKey({ invoicePk: input.invoicePk })) return false
  if (input.isPaid) return false
  return isCollectionOverdueEligible(input.daysOverdue)
}

export function isCollectionStatusOpen(
  status: CollectionCaseStatus | string | null | undefined
): boolean {
  return (COLLECTION_OPEN_STATUSES as readonly string[]).includes(status ?? "")
}

export function shouldCloseCollectionCaseAsPaid(input: {
  isPaid: boolean
  currentStatus: CollectionCaseStatus | string | null | undefined
}): boolean {
  if (!input.isPaid) return false
  if (input.currentStatus === "paid" || input.currentStatus === "closed") return false
  return true
}

export function nextCollectionStatusOnPaidSync(
  currentStatus: CollectionCaseStatus | string | null | undefined
): CollectionCaseStatus | null {
  if (!shouldCloseCollectionCaseAsPaid({ isPaid: true, currentStatus })) return null
  return "paid"
}

export function outstandingAmountFromInvoice(input: {
  invoiceAmountDocument?: number | null
  invoiceAmountPaid?: number | null
}): number | null {
  const document = input.invoiceAmountDocument
  if (typeof document !== "number" || !Number.isFinite(document) || document < 0) {
    return null
  }
  const paid =
    typeof input.invoiceAmountPaid === "number" && Number.isFinite(input.invoiceAmountPaid)
      ? Math.max(0, input.invoiceAmountPaid)
      : 0
  const outstanding = document - paid
  return outstanding > 0 ? outstanding : 0
}

export function overdueSinceFromDueDate(invoiceDueDate: string | null | undefined): string | null {
  const due = parseInvoiceDueDate(invoiceDueDate)
  if (!due) return null
  return due.toISOString().slice(0, 10)
}
