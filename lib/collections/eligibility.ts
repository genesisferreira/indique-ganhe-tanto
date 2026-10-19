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

function utcCivilDate(year: number, month: number, day: number): Date | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null
  }
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null
  }
  return utc
}

/**
 * Vencimento fail-closed. Aceita somente:
 * - YYYY-MM-DD (civil UTC);
 * - YYYY-MM-DD HH:mm:ss ou YYYY-MM-DDTHH:mm:ss sem fuso (civil UTC, hora ignorada —
 *   formato observado nos filtros Controllr de invoice_date_due);
 * - ISO-8601 com Z ou offset.
 * Ausente, tipo inválido, calendário impossível ou texto ambíguo → null.
 * Não usa emissão, crédito, pagamento, atualização nem a data atual.
 */
export function parseInvoiceDueDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (civil) {
    return utcCivilDate(Number(civil[1]), Number(civil[2]), Number(civil[3]))
  }

  const civilTime =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed)
  if (civilTime) {
    const hour = Number(civilTime[4])
    const minute = Number(civilTime[5])
    const second = Number(civilTime[6])
    if (hour > 23 || minute > 59 || second > 59) return null
    return utcCivilDate(Number(civilTime[1]), Number(civilTime[2]), Number(civilTime[3]))
  }

  const withZone =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      trimmed
    )
  if (!withZone) return null
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) return null
  const instant = new Date(parsed)
  return utcCivilDate(
    instant.getUTCFullYear(),
    instant.getUTCMonth() + 1,
    instant.getUTCDate()
  )
}

/**
 * Dias de atraso server-side a partir de invoice_date_due (UTC date).
 * O ERP não envia days_overdue — este cálculo é a fonte operacional.
 * A descoberta de atrasados usa calendário civil America/Sao_Paulo; esta regra
 * permanece em UTC e pode divergir perto da meia-noite. Não misturar as duas.
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

export function isCollectionOverdueEligible(
  daysOverdue: number | null | undefined,
  minimumDaysOverdue: number = COLLECTION_OVERDUE_THRESHOLD_DAYS
): boolean {
  if (daysOverdue == null || !Number.isFinite(daysOverdue)) return false
  const min =
    Number.isInteger(minimumDaysOverdue) && minimumDaysOverdue >= 1
      ? minimumDaysOverdue
      : COLLECTION_OVERDUE_THRESHOLD_DAYS
  return daysOverdue >= min
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
  minimumDaysOverdue?: number
  collectionsEnabled?: boolean
}): boolean {
  if (input.collectionsEnabled === false) return false
  if (!collectionCaseIdentityKey({ invoicePk: input.invoicePk })) return false
  if (input.isPaid) return false
  return isCollectionOverdueEligible(input.daysOverdue, input.minimumDaysOverdue)
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
