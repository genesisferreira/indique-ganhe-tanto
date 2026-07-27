/**
 * Extração do valor monetário da fatura Controllr (puro, sem I/O).
 *
 * Campos oficiais (wiki BRByte / Controllr):
 * - invoice_amount_paid — valor efetivamente pago
 * - invoice_amount_document — total do documento
 * - invoice_amount_nf — fallback de NF
 */

export function readInvoiceMoneyAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".")
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Valor usado na recompensa de 1ª mensalidade.
 * Prioriza `invoice_amount_paid` > 0; senão `invoice_amount_document` > 0.
 */
export function resolveInvoiceRewardAmount(input: {
  invoiceAmountPaid?: number | null
  invoiceAmountDocument?: number | null
}): number | null {
  const paid = input.invoiceAmountPaid
  if (typeof paid === "number" && Number.isFinite(paid) && paid > 0) {
    return paid
  }
  const document = input.invoiceAmountDocument
  if (
    typeof document === "number" &&
    Number.isFinite(document) &&
    document > 0
  ) {
    return document
  }
  return null
}

export function extractInvoiceMonetaryFields(row: Record<string, unknown>): {
  invoiceAmountPaid: number | null
  invoiceAmountDocument: number | null
  paidAmount: number | null
} {
  const invoiceAmountPaid = readInvoiceMoneyAmount(
    row.invoice_amount_paid ?? row.invoiceAmountPaid
  )
  const invoiceAmountDocument = readInvoiceMoneyAmount(
    row.invoice_amount_document ??
      row.invoiceAmountDocument ??
      row.invoice_amount_nf ??
      row.invoiceAmountNf
  )
  return {
    invoiceAmountPaid,
    invoiceAmountDocument,
    paidAmount: resolveInvoiceRewardAmount({
      invoiceAmountPaid,
      invoiceAmountDocument,
    }),
  }
}
