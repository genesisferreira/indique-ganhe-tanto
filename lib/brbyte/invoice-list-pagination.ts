export const COLLECTION_INVOICE_LIST_PAGE_SIZE = 100
export const COLLECTION_INVOICE_LIST_MAX_PAGES = 100

export function invoiceListPageQueryForms(
  start: number,
  length: number
): Record<string, string>[] {
  const startText = String(Math.max(0, start))
  const lengthText = String(Math.max(1, length))
  return [
    {
      "where[invoice_deleted]": "false",
      start: startText,
      length: lengthText,
    },
    {
      "where[invoice_deleted]": "false",
      offset: startText,
      limit: lengthText,
    },
    {
      invoice_deleted: "false",
      start: startText,
      length: lengthText,
    },
  ]
}

export function invoiceListFormsIncludeContractPk(
  forms: Record<string, string>[]
): boolean {
  return forms.some((fields) =>
    Object.entries(fields).some(([key, value]) => {
      const blob = `${key}=${value}`.toLowerCase()
      return blob.includes("contract_pk")
    })
  )
}

export type InvoiceListPageAdvanceReason =
  | "continue"
  | "complete"
  | "truncated"
  | "repeat"
  | "page_error"

export function decideInvoiceListPageAdvance(input: {
  pageIndex: number
  pageSize: number
  maxPages: number
  pageOk: boolean
  pageInvoicePks: Array<string | null | undefined>
  seenInvoicePks: Set<string>
  collectedCount: number
  reportedTotal: number | null
}): {
  reason: InvoiceListPageAdvanceReason
  uniqueNewPks: string[]
} {
  if (!input.pageOk) {
    return { reason: "page_error", uniqueNewPks: [] }
  }

  const uniqueNewPks: string[] = []
  let overlap = 0
  for (const raw of input.pageInvoicePks) {
    const pk = String(raw ?? "").trim()
    if (!pk) continue
    if (input.seenInvoicePks.has(pk)) {
      overlap += 1
      continue
    }
    uniqueNewPks.push(pk)
  }

  if (input.pageInvoicePks.filter((pk) => String(pk ?? "").trim()).length === 0) {
    return { reason: "complete", uniqueNewPks: [] }
  }

  if (uniqueNewPks.length === 0 && overlap > 0) {
    return { reason: "repeat", uniqueNewPks: [] }
  }

  const nextCount = input.collectedCount + uniqueNewPks.length
  if (uniqueNewPks.length < input.pageSize) {
    return { reason: "complete", uniqueNewPks }
  }
  if (input.reportedTotal != null && nextCount >= input.reportedTotal) {
    return { reason: "complete", uniqueNewPks }
  }
  if (input.pageIndex >= input.maxPages - 1) {
    return { reason: "truncated", uniqueNewPks }
  }
  return { reason: "continue", uniqueNewPks }
}

export type CollectedInvoiceList<T extends { invoicePk: string | null }> = {
  ok: boolean
  incomplete: boolean
  truncated: boolean
  reason: InvoiceListPageAdvanceReason | "empty"
  rows: T[]
  scannedPages: number
}

export function collectInvoiceListPages<T extends { invoicePk: string | null }>(
  pages: Array<{ ok: boolean; rows: T[]; total: number | null }>,
  pageSize: number,
  maxPages: number
): CollectedInvoiceList<T> {
  const collected: T[] = []
  const seen = new Set<string>()
  let scannedPages = 0

  for (let pageIndex = 0; pageIndex < pages.length && pageIndex < maxPages; pageIndex += 1) {
    const page = pages[pageIndex]
    scannedPages += 1
    const advance = decideInvoiceListPageAdvance({
      pageIndex,
      pageSize,
      maxPages,
      pageOk: page.ok,
      pageInvoicePks: page.rows.map((row) => row.invoicePk),
      seenInvoicePks: seen,
      collectedCount: collected.length,
      reportedTotal: page.total,
    })

    if (advance.reason === "page_error") {
      return {
        ok: false,
        incomplete: true,
        truncated: pageIndex > 0,
        reason: "page_error",
        rows: collected,
        scannedPages,
      }
    }

    const allowed = new Set(advance.uniqueNewPks)
    for (const row of page.rows) {
      const pk = String(row.invoicePk ?? "").trim()
      if (!pk || !allowed.has(pk) || seen.has(pk)) continue
      seen.add(pk)
      collected.push(row)
    }

    if (advance.reason === "repeat") {
      return {
        ok: false,
        incomplete: true,
        truncated: true,
        reason: "repeat",
        rows: collected,
        scannedPages,
      }
    }
    if (advance.reason === "truncated") {
      return {
        ok: false,
        incomplete: true,
        truncated: true,
        reason: "truncated",
        rows: collected,
        scannedPages,
      }
    }
    if (advance.reason === "complete") {
      return {
        ok: true,
        incomplete: false,
        truncated: false,
        reason: collected.length === 0 ? "empty" : "complete",
        rows: collected,
        scannedPages,
      }
    }
  }

  return {
    ok: collected.length === 0,
    incomplete: collected.length > 0,
    truncated: collected.length > 0,
    reason: collected.length === 0 ? "empty" : "truncated",
    rows: collected,
    scannedPages,
  }
}
