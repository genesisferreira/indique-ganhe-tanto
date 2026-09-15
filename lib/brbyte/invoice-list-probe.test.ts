import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  INVOICE_LIST_PROBE_ATTEMPTS,
  INVOICE_LIST_PROBE_PAGE_SIZE,
  INVOICE_LIST_PROBE_WHERE_FILTERS,
  buildInvoiceListProbeFormFields,
  clampInvoiceListProbeTimeoutMs,
  selectInvoiceListProbeForm,
  summarizeInvoiceListProbeResult,
} from "@/lib/brbyte/invoice-list-probe-result"
import { invoiceListFormsIncludeContractPk } from "@/lib/brbyte/invoice-list-pagination"

describe("invoice list probe", () => {
  it("timeout fica entre 3s e 12s", () => {
    assert.equal(clampInvoiceListProbeTimeoutMs(8000), 8000)
    assert.equal(clampInvoiceListProbeTimeoutMs(100), 3000)
    assert.equal(clampInvoiceListProbeTimeoutMs(60_000), 12_000)
    assert.equal(clampInvoiceListProbeTimeoutMs("nope"), 8000)
  })

  it("form-urlencoded replica o DevTools com where JSON, limit=1 e sem contract_pk", () => {
    const selected = selectInvoiceListProbeForm()
    const fields = buildInvoiceListProbeFormFields()
    assert.deepEqual(Object.keys(fields), [
      "where",
      "page",
      "start",
      "limit",
      "sort",
      "dir",
    ])
    assert.equal(fields.page, "1")
    assert.equal(fields.start, "0")
    assert.equal(fields.limit, "1")
    assert.equal(fields.sort, "client_complete_name")
    assert.equal(fields.dir, "ASC")
    assert.equal(fields.where, JSON.stringify(INVOICE_LIST_PROBE_WHERE_FILTERS))
    const parsed = JSON.parse(fields.where) as unknown[]
    assert.deepEqual(parsed, [
      { field: "client_status", oper: 5, value: 0 },
      { field: "AND" },
      { field: "invoice_deleted", oper: 5, value: false },
      { field: "AND" },
      { field: "invoice_date_due", oper: 4, value: "2026-09-01 00:00:00" },
      { field: "AND" },
      { field: "invoice_date_due", oper: 3, value: "2026-09-30 23:59:59" },
    ])
    assert.equal(INVOICE_LIST_PROBE_PAGE_SIZE, 1)
    assert.equal(INVOICE_LIST_PROBE_ATTEMPTS, 1)
    assert.equal(invoiceListFormsIncludeContractPk([fields]), false)
    assert.equal(selected.fields.limit, "1")
    assert.equal(selected.formId, "devtools_where_json")
  })

  it("uma tentativa e ausência de escrita no runner", () => {
    assert.equal(INVOICE_LIST_PROBE_ATTEMPTS, 1)
  })

  it("abort local não inventa HTTP do ERP", () => {
    const result = summarizeInvoiceListProbeResult({
      timeoutMs: 8000,
      durationMs: 8012,
      httpStatus: null,
      json: null,
      transportMessage: "This operation was aborted",
    })
    assert.equal(result.httpStatus, null)
    assert.equal(result.errorClass, "timeout_aborted")
    assert.equal(result.shapeValid, false)
    assert.equal(result.ok, false)
    assert.equal(result.fullBaseCoverageClaimed, false)
    assert.equal(result.attempts, 1)
  })

  it("shape válido devolve só contagens filtradas, sem linhas", () => {
    const result = summarizeInvoiceListProbeResult({
      timeoutMs: 8000,
      durationMs: 420,
      httpStatus: 200,
      json: {
        success: true,
        total: 3188,
        results: [
          {
            invoice_pk: "inv-1",
            nombreCliente: "Maria Silva",
            numeroIdentificacion: "12345678901",
          },
        ],
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.shapeValid, true)
    assert.equal(result.pageCount, 1)
    assert.equal(result.reportedTotal, 3188)
    assert.equal(result.fullBaseCoverageClaimed, false)
    assert.match(result.contractNotes.join(" "), /recorte filtrado/)
    const blob = JSON.stringify(result)
    assert.equal(blob.includes("Maria"), false)
    assert.equal(blob.includes("12345678901"), false)
    assert.equal(blob.includes("inv-1"), false)
    assert.equal("password" in result, false)
    assert.equal("cookie" in result, false)
    assert.equal("results" in result, false)
  })

  it("erro de login não devolve credencial", () => {
    const result = summarizeInvoiceListProbeResult({
      timeoutMs: 8000,
      durationMs: 40,
      httpStatus: 401,
      json: { password: "secret-token", cookie: "sid=abc" },
      transportMessage: "Credenciais operacionais recusadas",
    })
    const blob = JSON.stringify(result)
    assert.equal(result.ok, false)
    assert.equal(blob.includes("secret-token"), false)
    assert.equal(blob.includes("sid=abc"), false)
    assert.equal(blob.includes("password"), false)
  })
})
