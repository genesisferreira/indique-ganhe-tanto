import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  collectionInvoiceNeedsDetailFetch,
  presentCollectionInvoiceFromListRow,
  shouldInspectCollectionInvoice,
} from "@/lib/collections/invoice-from-controllr"
import type { BrbyteInvoiceListRow } from "@/types/brbyte"
describe("presentCollectionInvoiceFromListRow", () => {
  it("ignora fatura excluída e sem pk", () => {
    const deleted: BrbyteInvoiceListRow = {
      invoicePk: "inv-1",
      contractPk: "ct-1",
      invoiceDueDate: "2026-01-01",
      invoiceDate: null,
      invoicePeriod: null,
      invoiceDeleted: true,
      raw: {},
    }
    assert.equal(presentCollectionInvoiceFromListRow(deleted), null)
    assert.equal(
      presentCollectionInvoiceFromListRow({ ...deleted, invoicePk: null, invoiceDeleted: false }),
      null
    )
  })

  it("mapeia cliente e documento sanitizado a partir do raw", () => {
    const row: BrbyteInvoiceListRow = {
      invoicePk: "inv-9",
      contractPk: "ct-9",
      invoiceDueDate: "2026-09-01",
      invoiceDate: null,
      invoicePeriod: null,
      invoiceDeleted: false,
      raw: {
        nombreCliente: "Maria Silva",
        numeroIdentificacion: "12345678901",
        invoice_msg: "open",
        invoice_amount_document: 199.9,
      },
    }
    const presented = presentCollectionInvoiceFromListRow(row)
    assert.ok(presented)
    assert.equal(presented?.customerName, "Maria Silva")
    assert.equal(presented?.customerDocument, "***8901")
    assert.equal(presented?.isPaid, false)
    assert.equal(presented?.invoiceAmountDocument, 199.9)
  })
})

describe("shouldInspectCollectionInvoice", () => {
  const now = new Date("2026-09-11T00:00:00.000Z")
  const base = {
    invoicePk: "inv-1",
    contractPk: "ct-1",
    clientPk: null,
    customerName: null,
    customerDocument: null,
    invoiceDueDate: "2026-09-06T00:00:00.000Z",
    invoiceMsg: "open",
    invoiceDateCredit: null,
    isPaid: false,
    invoiceAmountDocument: 10,
    invoiceAmountPaid: 0,
  }

  it("não inspeciona fatura com menos de 5 dias sem caso existente", () => {
    assert.equal(
      shouldInspectCollectionInvoice({
        invoice: { ...base, invoiceDueDate: "2026-09-08T00:00:00.000Z" },
        now,
        minimumDaysOverdue: 5,
        hasExistingCase: false,
      }),
      false
    )
  })

  it("inspeciona fatura com 5 ou mais dias", () => {
    assert.equal(
      shouldInspectCollectionInvoice({
        invoice: base,
        now,
        minimumDaysOverdue: 5,
        hasExistingCase: false,
      }),
      true
    )
  })

  it("inspeciona caso existente mesmo abaixo do limiar", () => {
    assert.equal(
      shouldInspectCollectionInvoice({
        invoice: { ...base, invoiceDueDate: "2026-09-10T00:00:00.000Z" },
        now,
        minimumDaysOverdue: 5,
        hasExistingCase: true,
      }),
      true
    )
  })
})

describe("collectionInvoiceNeedsDetailFetch", () => {
  const invoice = {
    invoicePk: "inv-1",
    contractPk: "ct-1",
    clientPk: null,
    customerName: null,
    customerDocument: null,
    invoiceDueDate: "2026-09-01",
    invoiceMsg: "open",
    invoiceDateCredit: null,
    isPaid: false,
    invoiceAmountDocument: 50,
    invoiceAmountPaid: 0,
  }

  it("não busca list_info quando a lista já tem msg e valor", () => {
    assert.equal(
      collectionInvoiceNeedsDetailFetch({
        invoice,
        daysOverdue: 10,
        minimumDaysOverdue: 5,
        hasExistingCase: false,
      }),
      false
    )
  })

  it("busca detalhe quando falta invoice_msg", () => {
    assert.equal(
      collectionInvoiceNeedsDetailFetch({
        invoice: { ...invoice, invoiceMsg: null, invoiceAmountDocument: null },
        daysOverdue: 10,
        minimumDaysOverdue: 5,
        hasExistingCase: false,
      }),
      true
    )
  })
})
