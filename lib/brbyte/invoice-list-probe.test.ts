import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  INVOICE_LIST_PROBE_ATTEMPTS,
  INVOICE_LIST_PROBE_PAGE_SIZE,
  clampInvoiceListProbeTimeoutMs,
  parseInvoiceListProbeFormatIndex,
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

  it("um formato por execução, página 1, sem contract_pk", () => {
    assert.equal(parseInvoiceListProbeFormatIndex(2), 2)
    assert.equal(parseInvoiceListProbeFormatIndex(9), 0)
    const selected = selectInvoiceListProbeForm(0)
    assert.equal(selected.fields.length, "1")
    assert.equal(selected.fields.start, "0")
    assert.equal(INVOICE_LIST_PROBE_PAGE_SIZE, 1)
    assert.equal(INVOICE_LIST_PROBE_ATTEMPTS, 1)
    assert.equal(
      invoiceListFormsIncludeContractPk([selected.fields]),
      false
    )
  })

  it("abort local não inventa HTTP do ERP", () => {
    const result = summarizeInvoiceListProbeResult({
      formatIndex: 0,
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

  it("shape válido devolve só contagens, sem linhas", () => {
    const result = summarizeInvoiceListProbeResult({
      formatIndex: 1,
      timeoutMs: 8000,
      durationMs: 420,
      httpStatus: 200,
      json: {
        success: true,
        recordsTotal: 17,
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
    assert.equal(result.reportedTotal, 17)
    assert.equal(result.formId, "where_offset_limit")
    const blob = JSON.stringify(result)
    assert.equal(blob.includes("Maria"), false)
    assert.equal(blob.includes("12345678901"), false)
    assert.equal(blob.includes("inv-1"), false)
  })
})
