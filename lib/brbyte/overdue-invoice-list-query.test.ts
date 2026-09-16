import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { invoiceListFormsIncludeContractPk } from "@/lib/brbyte/invoice-list-pagination"
import {
  OVERDUE_INVOICE_LIST_CONTENT_TYPE,
  OVERDUE_INVOICE_LIST_HTTP_ATTEMPTS,
  OVERDUE_INVOICE_LIST_MAX_PAGES,
  OVERDUE_INVOICE_LIST_OPER,
  OVERDUE_INVOICE_LIST_PAGE_SIZE,
  OVERDUE_INVOICE_LIST_SORT_DIR,
  OVERDUE_INVOICE_LIST_SORT_EVIDENCE,
  OVERDUE_INVOICE_LIST_SORT_FIELD,
  buildOverdueInvoiceListFormFields,
  buildOverdueInvoiceListWhere,
  collectOverdueInvoiceListPages,
  freezeInvoiceListReferenceDate,
  overdueInvoiceListPageCursor,
  overdueInvoiceListQueryForms,
  parseInvoiceListReferenceDate,
  planOverdueInvoiceListPages,
  serializeOverdueInvoiceListForm,
  summarizeOverdueInvoiceListScan,
} from "@/lib/brbyte/overdue-invoice-list-query"

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    invoicePk: `inv-${from + i}`,
  }))
}

function decodeWhere(serialized: string): unknown {
  const params = new URLSearchParams(serialized)
  return JSON.parse(params.get("where") ?? "null") as unknown
}

describe("TEST A — contrato HTTP da consulta de atrasados", () => {
  it("serializa form-urlencoded com where JSON e sem chaves legado", () => {
    const fields = buildOverdueInvoiceListFormFields({
      referenceDate: "2026-09-16",
      page: 1,
    })
    assert.ok(fields)
    assert.deepEqual(Object.keys(fields), ["where", "page", "start", "limit", "sort", "dir"])
    const serialized = serializeOverdueInvoiceListForm(fields)
    const params = new URLSearchParams(serialized)
    assert.equal(OVERDUE_INVOICE_LIST_CONTENT_TYPE, "application/x-www-form-urlencoded")
    assert.equal(params.get("page"), "1")
    assert.equal(params.get("start"), "0")
    assert.equal(params.get("limit"), "15")
    assert.equal(params.get("sort"), "client_complete_name")
    assert.equal(params.get("dir"), "ASC")
    assert.equal(params.has("length"), false)
    assert.equal(params.has("where[invoice_deleted]"), false)
    assert.equal(serialized.includes("length="), false)
    assert.equal(serialized.includes("where%5Binvoice_deleted%5D"), false)
    assert.equal(serialized.includes("where[invoice_deleted]"), false)
    assert.equal(typeof params.get("where"), "string")
    assert.equal(Array.isArray(decodeWhere(serialized)), true)
    assert.equal(OVERDUE_INVOICE_LIST_HTTP_ATTEMPTS, 1)
    assert.equal(overdueInvoiceListQueryForms({ referenceDate: "2026-09-16", page: 1 }).length, 1)
  })
})

describe("TEST B — filtro exato observado", () => {
  it("preserva field/oper/value, tipos e grupo aninhado", () => {
    const where = buildOverdueInvoiceListWhere("2026-09-16")
    assert.deepEqual(where, [
      { field: "invoice_deleted", oper: 7, value: false },
      { field: "AND" },
      { field: "invoice_date_due", oper: 8, value: null },
      { field: "AND" },
      [
        { field: "invoice_date_credit", oper: 7, value: null },
        { field: "AND" },
        { field: "invoice_date_due", oper: 1, value: "2026-09-16" },
      ],
    ])
    assert.equal(OVERDUE_INVOICE_LIST_OPER.LT, 1)
    assert.equal(OVERDUE_INVOICE_LIST_OPER.IS, 7)
    assert.equal(OVERDUE_INVOICE_LIST_OPER.IS_NOT, 8)
    const fields = buildOverdueInvoiceListFormFields({
      referenceDate: "2026-09-16",
      page: 1,
    })
    assert.ok(fields)
    const parsed = JSON.parse(fields.where) as unknown[]
    assert.equal(Array.isArray(parsed[4]), true)
    const nested = parsed[4] as Array<Record<string, unknown>>
    assert.equal(nested[0]?.value, null)
    assert.equal(typeof (parsed[0] as { value: unknown }).value, "boolean")
    const blob = JSON.stringify(parsed)
    assert.equal(blob.includes("invoice_late"), false)
    assert.equal(blob.includes("invoice_status"), false)
    assert.equal(blob.includes("client_status"), false)
    assert.equal(blob.includes("client.client_pk"), false)
    assert.equal(blob.includes("contract_pk"), false)
    assert.equal(invoiceListFormsIncludeContractPk([fields]), false)
  })
})

describe("TEST C — data de referência validada e congelada", () => {
  it("rejeita data fixa implícita e valores inválidos", () => {
    assert.equal(parseInvoiceListReferenceDate("2026-09-16T00:00:00.000Z"), null)
    assert.equal(parseInvoiceListReferenceDate("16/09/2026"), null)
    assert.equal(parseInvoiceListReferenceDate("2026-09-31"), null)
    assert.equal(parseInvoiceListReferenceDate(""), null)
    assert.equal(parseInvoiceListReferenceDate({ field: "invoice_date_due" }), null)
    assert.equal(parseInvoiceListReferenceDate("2026-09-16"), "2026-09-16")
    assert.equal(buildOverdueInvoiceListWhere("2026-13-01"), null)
  })

  it("congela o calendário UTC já usado pela elegibilidade, inclusive na virada do dia", () => {
    assert.equal(
      freezeInvoiceListReferenceDate(new Date("2026-09-16T00:00:00.000Z")),
      "2026-09-16"
    )
    assert.equal(
      freezeInvoiceListReferenceDate(new Date("2026-09-15T23:59:59.999Z")),
      "2026-09-15"
    )
    const pages = planOverdueInvoiceListPages({
      referenceDate: freezeInvoiceListReferenceDate(new Date("2026-09-16T03:00:00.000Z")),
      pageCount: 3,
    })
    assert.ok(pages)
    const dates = pages.map((fields) => {
      const parsed = JSON.parse(fields.where) as unknown[]
      const nested = parsed[4] as Array<{ value?: unknown }>
      return nested[2]?.value
    })
    assert.deepEqual(dates, ["2026-09-16", "2026-09-16", "2026-09-16"])
  })
})

describe("TEST D — paginação coerente limit=15", () => {
  it("gera page/start estáveis com os mesmos filtros e ordenação", () => {
    assert.deepEqual(overdueInvoiceListPageCursor(1), { page: 1, start: 0, limit: 15 })
    assert.deepEqual(overdueInvoiceListPageCursor(2), { page: 2, start: 15, limit: 15 })
    assert.deepEqual(overdueInvoiceListPageCursor(3), { page: 3, start: 30, limit: 15 })
    assert.equal(overdueInvoiceListPageCursor(0), null)
    assert.equal(OVERDUE_INVOICE_LIST_PAGE_SIZE, 15)
    const pages = planOverdueInvoiceListPages({
      referenceDate: "2026-09-16",
      pageCount: 3,
    })
    assert.ok(pages)
    assert.deepEqual(
      pages.map((fields) => ({
        page: fields.page,
        start: fields.start,
        limit: fields.limit,
        sort: fields.sort,
        dir: fields.dir,
        where: fields.where,
      })),
      [
        {
          page: "1",
          start: "0",
          limit: "15",
          sort: OVERDUE_INVOICE_LIST_SORT_FIELD,
          dir: OVERDUE_INVOICE_LIST_SORT_DIR,
          where: pages[0]?.where,
        },
        {
          page: "2",
          start: "15",
          limit: "15",
          sort: OVERDUE_INVOICE_LIST_SORT_FIELD,
          dir: OVERDUE_INVOICE_LIST_SORT_DIR,
          where: pages[0]?.where,
        },
        {
          page: "3",
          start: "30",
          limit: "15",
          sort: OVERDUE_INVOICE_LIST_SORT_FIELD,
          dir: OVERDUE_INVOICE_LIST_SORT_DIR,
          where: pages[0]?.where,
        },
      ]
    )
    assert.equal(OVERDUE_INVOICE_LIST_SORT_EVIDENCE.length >= 2, true)
  })
})

describe("TEST G — falhas e limites não viram execução completa", () => {
  it("timeout, página inválida e teto de páginas permanecem incompletos sem fallback extra", () => {
    const timeout = collectOverdueInvoiceListPages(
      [{ ok: false, rows: [], total: null }],
      "2026-09-16"
    )
    assert.equal(timeout.ok, false)
    assert.equal(timeout.incomplete, true)
    assert.equal(timeout.coverageComplete, false)
    assert.equal(timeout.reason, "page_error")

    const invalid = collectOverdueInvoiceListPages(
      [
        { ok: true, rows: rows(1, 15), total: 8562 },
        { ok: false, rows: [], total: null },
      ],
      "2026-09-16"
    )
    assert.equal(invalid.ok, false)
    assert.equal(invalid.incomplete, true)
    assert.equal(invalid.rows.length, 15)
    assert.equal(invalid.coverageComplete, false)

    const truncatedPages = Array.from({ length: OVERDUE_INVOICE_LIST_MAX_PAGES }, (_, i) => ({
      ok: true,
      rows: rows(i * 15 + 1, 15),
      total: 8562,
    }))
    const truncated = collectOverdueInvoiceListPages(truncatedPages, "2026-09-16")
    assert.equal(truncated.ok, false)
    assert.equal(truncated.truncated, true)
    assert.equal(truncated.incomplete, true)
    assert.equal(truncated.coverageComplete, false)
    assert.equal(truncated.uniqueOrderProven, false)
    assert.equal(truncated.rows.length, OVERDUE_INVOICE_LIST_MAX_PAGES * 15)
    assert.equal(truncated.rows.length < 8562, true)
    assert.equal(overdueInvoiceListQueryForms({ referenceDate: "2026-09-16", page: 1 }).length, 1)
  })
})

describe("TEST I — sanitização do resumo", () => {
  it("resumo não expõe fatura, PII, credencial nem pagamento", () => {
    const summary = summarizeOverdueInvoiceListScan({
      ok: false,
      incomplete: true,
      truncated: true,
      scannedPages: 2,
      collectedCount: 15,
      reportedTotal: 8562,
      referenceDate: "2026-09-16",
      message: "Consulta de atrasados truncada no limite de páginas do runner.",
    })
    const blob = JSON.stringify(summary)
    assert.equal(blob.includes("Maria"), false)
    assert.equal(blob.includes("12345678901"), false)
    assert.equal(blob.includes("inv-1"), false)
    assert.equal(blob.includes("password"), false)
    assert.equal(blob.includes("cookie"), false)
    assert.equal(blob.includes("BRBOSCookie"), false)
    assert.equal(blob.includes("invoice_amount"), false)
    assert.equal(summary.uniqueOrderProven, false)
    assert.equal(summary.coverageComplete, false)
    assert.equal("results" in summary, false)
  })
})
