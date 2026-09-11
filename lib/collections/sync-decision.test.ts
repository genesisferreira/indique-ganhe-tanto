import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"

const overdueInvoice = {
  invoicePk: "inv-1",
  contractPk: "ct-1",
  clientPk: "cl-1",
  customerName: "Cliente",
  customerDocument: "***1234",
  invoiceDueDate: "2026-09-01T00:00:00.000Z",
  invoiceMsg: "open",
  invoiceDateCredit: null,
  isPaid: false,
  invoiceAmountDocument: 100,
  invoiceAmountPaid: 0,
}

const now = new Date("2026-09-11T00:00:00.000Z")

describe("D) sync repetido não duplica", () => {
  it("mesmo invoice_pk aberto → update, não create", () => {
    const first = decideCollectionSyncAction({
      invoice: overdueInvoice,
      existing: null,
      now,
    })
    const second = decideCollectionSyncAction({
      invoice: overdueInvoice,
      existing: { id: "case-1", status: "open", invoicePk: "inv-1" },
      now,
    })
    assert.equal(first.action, "create")
    assert.equal(second.action, "update_open")
  })
})

describe("G) payment retry não duplica fechamento", () => {
  it("já paid → skip already_paid", () => {
    const decision = decideCollectionSyncAction({
      invoice: { ...overdueInvoice, isPaid: true, invoiceMsg: "paid", invoiceDateCredit: "2026-09-10" },
      existing: { id: "case-1", status: "paid", invoicePk: "inv-1" },
      now,
    })
    assert.equal(decision.action, "skip")
    if (decision.action === "skip") assert.equal(decision.reason, "already_paid")
  })

  it("open + pago → close_paid", () => {
    const decision = decideCollectionSyncAction({
      invoice: { ...overdueInvoice, isPaid: true, invoiceMsg: "paid", invoiceDateCredit: "2026-09-10" },
      existing: { id: "case-1", status: "in_contact", invoicePk: "inv-1" },
      now,
    })
    assert.equal(decision.action, "close_paid")
  })
})
