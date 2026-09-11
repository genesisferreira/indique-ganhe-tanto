/** Snapshot de documento: só o necessário para operação, sem PII completa. */
export function sanitizeCustomerDocument(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const digits = value.replace(/\D/g, "")
  if (!digits) return null
  if (digits.length <= 4) return `****${digits}`
  return `***${digits.slice(-4)}`
}

export function sanitizeCustomerName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  return trimmed.slice(0, 180)
}

export function sanitizeContactNotes(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  return trimmed.slice(0, 500)
}

export function buildAuditedErpSnapshot(input: {
  invoicePk?: string | null
  contractPk?: string | null
  clientPk?: string | null
  invoiceDueDate?: string | null
  invoiceMsg?: string | null
  invoiceDateCredit?: string | null
  isPaid?: boolean
  invoiceAmountDocument?: number | null
  invoiceAmountPaid?: number | null
  daysOverdue?: number | null
}): Record<string, unknown> {
  return {
    invoice_pk: input.invoicePk ?? null,
    contract_pk: input.contractPk ?? null,
    client_pk: input.clientPk ?? null,
    invoice_due_date: input.invoiceDueDate ?? null,
    invoice_msg: input.invoiceMsg ?? null,
    invoice_date_credit: input.invoiceDateCredit ?? null,
    is_paid: input.isPaid === true,
    invoice_amount_document: input.invoiceAmountDocument ?? null,
    invoice_amount_paid: input.invoiceAmountPaid ?? null,
    days_overdue: input.daysOverdue ?? null,
    source: "controllr_invoice_list_info",
  }
}
