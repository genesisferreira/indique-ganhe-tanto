import {
  COLLECTION_INVOICE_LIST_MAX_PAGES,
  collectInvoiceListPages,
  type CollectedInvoiceList,
} from "@/lib/brbyte/invoice-list-pagination"

/** Limit observado no Controllr para invoice/list de atrasados. pageSize=100 não está validado. */
export const OVERDUE_INVOICE_LIST_PAGE_SIZE = 15
export const OVERDUE_INVOICE_LIST_MAX_PAGES = COLLECTION_INVOICE_LIST_MAX_PAGES
export const OVERDUE_INVOICE_LIST_SORT_FIELD = "client_complete_name"
export const OVERDUE_INVOICE_LIST_SORT_DIR = "ASC"
export const OVERDUE_INVOICE_LIST_HTTP_ATTEMPTS = 1
export const OVERDUE_INVOICE_LIST_CONTENT_TYPE =
  "application/x-www-form-urlencoded"

/**
 * Operadores documentados no probe/wiki e no payload observado:
 * 1 = < ; 7 = IS ; 8 = IS NOT.
 */
export const OVERDUE_INVOICE_LIST_OPER = {
  LT: 1,
  IS: 7,
  IS_NOT: 8,
} as const

const REFERENCE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export type OverdueInvoiceListWhereLeaf =
  | { field: "invoice_deleted"; oper: 7; value: false }
  | { field: "AND" }
  | { field: "invoice_date_due"; oper: 8; value: null }
  | { field: "invoice_date_credit"; oper: 7; value: null }
  | { field: "invoice_date_due"; oper: 1; value: string }

export type OverdueInvoiceListWhereNode =
  | OverdueInvoiceListWhereLeaf
  | OverdueInvoiceListWhereLeaf[]

/**
 * Data de referência no mesmo calendário UTC já usado por computeDaysOverdue.
 * Não afirma alinhamento com o fuso do ERP — isso permanece bloqueio de sync real.
 */
export function freezeInvoiceListReferenceDate(now: Date): string {
  const year = now.getUTCFullYear().toString().padStart(4, "0")
  const month = (now.getUTCMonth() + 1).toString().padStart(2, "0")
  const day = now.getUTCDate().toString().padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function parseInvoiceListReferenceDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const match = REFERENCE_DATE_RE.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null
  }
  return `${match[1]}-${match[2]}-${match[3]}`
}

export function buildOverdueInvoiceListWhere(
  referenceDate: string
): OverdueInvoiceListWhereNode[] | null {
  const frozen = parseInvoiceListReferenceDate(referenceDate)
  if (!frozen) return null
  return [
    { field: "invoice_deleted", oper: OVERDUE_INVOICE_LIST_OPER.IS, value: false },
    { field: "AND" },
    { field: "invoice_date_due", oper: OVERDUE_INVOICE_LIST_OPER.IS_NOT, value: null },
    { field: "AND" },
    [
      { field: "invoice_date_credit", oper: OVERDUE_INVOICE_LIST_OPER.IS, value: null },
      { field: "AND" },
      { field: "invoice_date_due", oper: OVERDUE_INVOICE_LIST_OPER.LT, value: frozen },
    ],
  ]
}

export function overdueInvoiceListPageCursor(
  page: number
): { page: number; start: number; limit: number } | null {
  if (!Number.isInteger(page) || page < 1) return null
  return {
    page,
    start: (page - 1) * OVERDUE_INVOICE_LIST_PAGE_SIZE,
    limit: OVERDUE_INVOICE_LIST_PAGE_SIZE,
  }
}

export function buildOverdueInvoiceListFormFields(input: {
  referenceDate: string
  page: number
}): Record<string, string> | null {
  const where = buildOverdueInvoiceListWhere(input.referenceDate)
  const cursor = overdueInvoiceListPageCursor(input.page)
  if (!where || !cursor) return null
  return {
    where: JSON.stringify(where),
    page: String(cursor.page),
    start: String(cursor.start),
    limit: String(cursor.limit),
    sort: OVERDUE_INVOICE_LIST_SORT_FIELD,
    dir: OVERDUE_INVOICE_LIST_SORT_DIR,
  }
}

/** Uma única forma observada. Sem fallback de formato. */
export function overdueInvoiceListQueryForms(input: {
  referenceDate: string
  page: number
}): Record<string, string>[] {
  const fields = buildOverdueInvoiceListFormFields(input)
  return fields ? [fields] : []
}

export function serializeOverdueInvoiceListForm(
  fields: Record<string, string>
): string {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== "") body.set(key, value)
  }
  return body.toString()
}

export function planOverdueInvoiceListPages(input: {
  referenceDate: string
  pageCount: number
}): Record<string, string>[] | null {
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) return null
  const frozen = parseInvoiceListReferenceDate(input.referenceDate)
  if (!frozen) return null
  const pages: Record<string, string>[] = []
  for (let page = 1; page <= input.pageCount; page += 1) {
    const fields = buildOverdueInvoiceListFormFields({
      referenceDate: frozen,
      page,
    })
    if (!fields) return null
    pages.push(fields)
  }
  return pages
}

export type OverdueInvoiceListScan = CollectedInvoiceList<{ invoicePk: string | null }> & {
  uniqueOrderProven: false
  coverageComplete: false
  pageSize: number
  referenceDate: string
}

export function collectOverdueInvoiceListPages<T extends { invoicePk: string | null }>(
  pages: Array<{ ok: boolean; rows: T[]; total: number | null }>,
  referenceDate: string,
  maxPages: number = OVERDUE_INVOICE_LIST_MAX_PAGES
): CollectedInvoiceList<T> & {
  uniqueOrderProven: false
  coverageComplete: false
  pageSize: number
  referenceDate: string
} {
  const collected = collectInvoiceListPages(
    pages,
    OVERDUE_INVOICE_LIST_PAGE_SIZE,
    maxPages
  )
  return {
    ...collected,
    uniqueOrderProven: false,
    coverageComplete: false,
    pageSize: OVERDUE_INVOICE_LIST_PAGE_SIZE,
    referenceDate,
  }
}

export function summarizeOverdueInvoiceListScan(input: {
  ok: boolean
  incomplete: boolean
  truncated: boolean
  scannedPages: number
  collectedCount: number
  reportedTotal: number | null
  referenceDate: string
  message?: string
}): {
  ok: boolean
  incomplete: boolean
  truncated: boolean
  uniqueOrderProven: false
  coverageComplete: false
  scannedPages: number
  collectedCount: number
  reportedTotal: number | null
  referenceDate: string
  pageSize: number
  sort: string
  dir: string
  message: string | null
} {
  return {
    ok: input.ok,
    incomplete: input.incomplete,
    truncated: input.truncated,
    uniqueOrderProven: false,
    coverageComplete: false,
    scannedPages: input.scannedPages,
    collectedCount: input.collectedCount,
    reportedTotal: input.reportedTotal,
    referenceDate: input.referenceDate,
    pageSize: OVERDUE_INVOICE_LIST_PAGE_SIZE,
    sort: OVERDUE_INVOICE_LIST_SORT_FIELD,
    dir: OVERDUE_INVOICE_LIST_SORT_DIR,
    message: input.message ?? null,
  }
}

export const OVERDUE_INVOICE_LIST_SORT_EVIDENCE = [
  "Probe publicado (invoice-list-probe-result): sort=client_complete_name, dir=ASC.",
  "Formulário observado no Controllr para atrasados: sort=client_complete_name, dir=ASC.",
  "Não há evidência versionada de ordenação estável por invoice_pk nesta listagem.",
] as const
