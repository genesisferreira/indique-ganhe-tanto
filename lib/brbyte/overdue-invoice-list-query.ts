import {
  COLLECTION_INVOICE_LIST_MAX_PAGES,
  collectInvoiceListPages,
  type CollectedInvoiceList,
} from "@/lib/brbyte/invoice-list-pagination"

/** Limit observado no Controllr para invoice/list de atrasados. pageSize=100 não está validado. */
export const OVERDUE_INVOICE_LIST_PAGE_SIZE = 15
export const OVERDUE_INVOICE_LIST_MAX_PAGES = COLLECTION_INVOICE_LIST_MAX_PAGES
export const OVERDUE_INVOICE_LIST_SORT_FIELD = "invoice_pk"
export const OVERDUE_INVOICE_LIST_SORT_DIR = "ASC"
export const OVERDUE_INVOICE_LIST_HTTP_ATTEMPTS = 1
export const OVERDUE_INVOICE_LIST_CONTENT_TYPE =
  "application/x-www-form-urlencoded"

/**
 * Calendário de negócio da descoberta de atrasados.
 * Alinhado ao navegador observado no Controllr (America/Sao_Paulo via
 * BrByte.humanize.date(new Date())), não ao fuso comprovado do servidor ERP.
 * computeDaysOverdue permanece em calendário UTC e pode divergir perto da meia-noite.
 */
export const OVERDUE_DISCOVERY_BUSINESS_TIMEZONE = "America/Sao_Paulo" as const

/**
 * Operadores documentados no probe/wiki e no payload observado:
 * 1 = < ; 2 = > (documentado; combinação com atrasados pendente de validação real);
 * 7 = IS ; 8 = IS NOT.
 */
export const OVERDUE_INVOICE_LIST_OPER = {
  LT: 1,
  GT: 2,
  IS: 7,
  IS_NOT: 8,
} as const

export const OVERDUE_INVOICE_PK_RE = /^[1-9]\d*$/

const REFERENCE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export type OverdueInvoiceListWhereLeaf =
  | { field: "invoice_deleted"; oper: 7; value: false }
  | { field: "AND" }
  | { field: "invoice_date_due"; oper: 8; value: null }
  | { field: "invoice_date_credit"; oper: 7; value: null }
  | { field: "invoice_date_due"; oper: 1; value: string }
  | { field: "invoice_pk"; oper: 2; value: number }

export type OverdueInvoiceListWhereNode =
  | OverdueInvoiceListWhereLeaf
  | OverdueInvoiceListWhereLeaf[]

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

function civilDateInTimeZone(now: Date, timeZone: string): string | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  const day = parts.find((part) => part.type === "day")?.value
  if (!year || !month || !day) return null
  return parseInvoiceListReferenceDate(`${year}-${month}-${day}`)
}

/**
 * Congela YYYY-MM-DD da descoberta no calendário civil America/Sao_Paulo
 * a partir do instante `now`, via IANA (`Intl.DateTimeFormat`), sem offset fixo
 * e sem getters locais do host. Uma execução deve chamar isto uma vez e
 * reutilizar a string em todas as páginas, inclusive se atravessar a meia-noite.
 */
export function freezeInvoiceListReferenceDate(now: Date): string {
  const frozen = civilDateInTimeZone(now, OVERDUE_DISCOVERY_BUSINESS_TIMEZONE)
  if (!frozen) {
    throw new RangeError(
      "Não foi possível congelar a data civil da descoberta de atrasados."
    )
  }
  return frozen
}

export function parseOverdueInvoicePk(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!OVERDUE_INVOICE_PK_RE.test(trimmed)) return null
  try {
    if (BigInt(trimmed) <= BigInt(0)) return null
  } catch {
    return null
  }
  return trimmed
}

export function compareOverdueInvoicePk(left: string, right: string): number {
  const a = BigInt(left)
  const b = BigInt(right)
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function invoicePkWhereValue(pk: string): number | null {
  const asNumber = Number(pk)
  if (!Number.isSafeInteger(asNumber) || asNumber <= 0) return null
  return asNumber
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

/**
 * Where-base de Atrasado + invoice_pk > cursor.
 * A combinação oper 2 com este recorte NÃO foi validada ao vivo.
 */
export function buildOverdueInvoiceListWhereAfter(
  referenceDate: string,
  afterInvoicePk: string | null
): OverdueInvoiceListWhereNode[] | null {
  const base = buildOverdueInvoiceListWhere(referenceDate)
  if (!base) return null
  if (afterInvoicePk == null) return base
  const pk = parseOverdueInvoicePk(afterInvoicePk)
  const value = pk ? invoicePkWhereValue(pk) : null
  if (pk == null || value == null) return null
  return [
    ...base,
    { field: "AND" },
    { field: "invoice_pk", oper: OVERDUE_INVOICE_LIST_OPER.GT, value },
  ]
}

export function buildOverdueInvoiceListKeysetFormFields(input: {
  referenceDate: string
  afterInvoicePk: string | null
}): Record<string, string> | null {
  const where = buildOverdueInvoiceListWhereAfter(
    input.referenceDate,
    input.afterInvoicePk
  )
  if (!where) return null
  return {
    where: JSON.stringify(where),
    page: "1",
    start: "0",
    limit: String(OVERDUE_INVOICE_LIST_PAGE_SIZE),
    sort: OVERDUE_INVOICE_LIST_SORT_FIELD,
    dir: OVERDUE_INVOICE_LIST_SORT_DIR,
  }
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
  "Sprint 3.1E-I: interface Cobranças, sort=invoice_pk, dir=ASC, limit=15.",
  "Páginas 1 (start=0) e 2 (start=15) com HTTP 200, IDs crescentes e sem sobreposição.",
  "Ordenação por invoice_pk não prova ausência de deriva por pagamentos ou alterações entre páginas.",
] as const
