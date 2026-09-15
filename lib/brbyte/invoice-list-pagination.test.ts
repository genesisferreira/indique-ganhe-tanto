import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  collectInvoiceListPages,
  decideInvoiceListPageAdvance,
  invoiceListFormsIncludeContractPk,
  invoiceListPageQueryForms,
} from "@/lib/brbyte/invoice-list-pagination"

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    invoicePk: `inv-${from + i}`,
  }))
}

describe("invoice/list sem contract_pk", () => {
  it("formulários de página não enviam contract_pk", () => {
    const forms = invoiceListPageQueryForms(200, 100)
    assert.equal(invoiceListFormsIncludeContractPk(forms), false)
    assert.equal(forms[0]?.start, "200")
    assert.equal(forms[0]?.length, "100")
    assert.equal(forms[1]?.offset, "200")
    assert.equal(forms[1]?.limit, "100")
  })
})

describe("paginação da listagem global", () => {
  it("percorre mais de 200 registros em 3 páginas", () => {
    const collected = collectInvoiceListPages(
      [
        { ok: true, rows: rows(1, 100), total: 250 },
        { ok: true, rows: rows(101, 100), total: 250 },
        { ok: true, rows: rows(201, 50), total: 250 },
      ],
      100,
      100
    )
    assert.equal(collected.ok, true)
    assert.equal(collected.incomplete, false)
    assert.equal(collected.rows.length, 250)
    assert.equal(collected.scannedPages, 3)
  })

  it("falha na primeira página não inventa base vazia completa", () => {
    const collected = collectInvoiceListPages(
      [{ ok: false, rows: [], total: null }],
      100,
      100
    )
    assert.equal(collected.ok, false)
    assert.equal(collected.reason, "page_error")
    assert.equal(collected.rows.length, 0)
  })

  it("falha no meio da paginação preserva páginas anteriores e marca incompleto", () => {
    const collected = collectInvoiceListPages(
      [
        { ok: true, rows: rows(1, 100), total: 300 },
        { ok: false, rows: [], total: null },
      ],
      100,
      100
    )
    assert.equal(collected.ok, false)
    assert.equal(collected.incomplete, true)
    assert.equal(collected.rows.length, 100)
    assert.equal(collected.reason, "page_error")
  })

  it("página repetida interrompe loop", () => {
    const first = rows(1, 100)
    const collected = collectInvoiceListPages(
      [
        { ok: true, rows: first, total: 1000 },
        { ok: true, rows: first, total: 1000 },
      ],
      100,
      100
    )
    assert.equal(collected.ok, false)
    assert.equal(collected.reason, "repeat")
    assert.equal(collected.rows.length, 100)
  })

  it("página vazia com total restante não confirma o fim da lista", () => {
    const collected = collectInvoiceListPages(
      [{ ok: true, rows: [], total: 500 }],
      100,
      100
    )
    assert.equal(collected.ok, false)
    assert.equal(collected.reason, "incomplete")
    assert.equal(collected.incomplete, true)
    assert.equal(collected.rows.length, 0)
  })

  it("página curta com total restante não marca cobertura completa", () => {
    const collected = collectInvoiceListPages(
      [{ ok: true, rows: rows(1, 50), total: 250 }],
      100,
      100
    )
    assert.equal(collected.ok, false)
    assert.equal(collected.reason, "incomplete")
    assert.equal(collected.rows.length, 50)
    assert.equal(collected.truncated, false)
  })

  it("100 páginas de 100 itens truncam em 10.000 sem complete", () => {
    const pages = Array.from({ length: 100 }, (_, i) => ({
      ok: true,
      rows: rows(i * 100 + 1, 100),
      total: 20000,
    }))
    const collected = collectInvoiceListPages(pages, 100, 100)
    assert.equal(collected.ok, false)
    assert.equal(collected.truncated, true)
    assert.equal(collected.incomplete, true)
    assert.equal(collected.reason, "truncated")
    assert.equal(collected.rows.length, 10000)
    assert.equal(collected.scannedPages, 100)
  })
})

describe("decideInvoiceListPageAdvance", () => {
  it("página vazia válida encerra a varredura", () => {
    const advance = decideInvoiceListPageAdvance({
      pageIndex: 0,
      pageSize: 100,
      maxPages: 10,
      pageOk: true,
      pageInvoicePks: [],
      seenInvoicePks: new Set(),
      collectedCount: 0,
      reportedTotal: 0,
    })
    assert.equal(advance.reason, "complete")
  })

  it("página vazia sem total ainda confirma fim pela paginação", () => {
    const advance = decideInvoiceListPageAdvance({
      pageIndex: 0,
      pageSize: 100,
      maxPages: 10,
      pageOk: true,
      pageInvoicePks: [],
      seenInvoicePks: new Set(),
      collectedCount: 0,
      reportedTotal: null,
    })
    assert.equal(advance.reason, "complete")
  })
})
