import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { freezeInvoiceListReferenceDate } from "@/lib/brbyte/overdue-invoice-list-query"
import {
  computeDaysOverdue,
  outstandingAmountFromInvoice,
  shouldOpenCollectionCase,
} from "@/lib/collections/eligibility"
import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"
import { collectionScanMayMutateCase } from "@/lib/collections/sync-source"

const now = new Date("2026-09-16T12:00:00.000Z")
const referenceDate = freezeInvoiceListReferenceDate(now)

function invoice(daysOverdue: number, invoicePk: string) {
  const due = new Date(now)
  due.setUTCDate(due.getUTCDate() - daysOverdue)
  return {
    invoicePk,
    contractPk: "ct-fixture",
    clientPk: "cl-fixture",
    customerName: "Cliente Fixture",
    customerDocument: "***0000",
    invoiceDueDate: due.toISOString(),
    invoiceMsg: "open",
    invoiceDateCredit: null,
    isPaid: false,
    invoiceAmountDocument: 150,
    invoiceAmountPaid: 0,
  }
}

describe("TEST E — filtro ERP não substitui os 5 dias do CRM", () => {
  it("candidata com menos de 5 dias não cria caso; 5 dias respeita a regra", () => {
    assert.equal(referenceDate, "2026-09-16")
    const four = invoice(4, "inv-four")
    const five = invoice(5, "inv-five")
    const fourDays = computeDaysOverdue({ invoiceDueDate: four.invoiceDueDate, now })
    const fiveDays = computeDaysOverdue({ invoiceDueDate: five.invoiceDueDate, now })
    assert.equal(fourDays, 4)
    assert.equal(fiveDays, 5)
    assert.equal(
      shouldOpenCollectionCase({
        daysOverdue: fourDays,
        isPaid: false,
        invoicePk: four.invoicePk,
      }),
      false
    )
    assert.equal(
      shouldOpenCollectionCase({
        daysOverdue: fiveDays,
        isPaid: false,
        invoicePk: five.invoicePk,
      }),
      true
    )
    assert.equal(
      decideCollectionSyncAction({ invoice: four, existing: null, now }).action,
      "skip"
    )
    assert.equal(
      decideCollectionSyncAction({ invoice: five, existing: null, now }).action,
      "create"
    )
  })
})

describe("TEST F — ausência na lista de atrasados não é pagamento", () => {
  it("caso existente fora do recorte não fecha, não zera dívida e não marca pago", () => {
    const scanned = new Set(["inv-seen"])
    assert.equal(
      collectionScanMayMutateCase({
        invoicePk: "inv-absent",
        scannedInvoicePks: scanned,
      }),
      false
    )
    const existingDebt = outstandingAmountFromInvoice({
      invoiceAmountDocument: 180,
      invoiceAmountPaid: 20,
    })
    assert.equal(existingDebt, 160)
    const decisionIfForced = decideCollectionSyncAction({
      invoice: invoice(12, "inv-absent"),
      existing: { id: "case-absent", status: "open", invoicePk: "inv-absent" },
      now,
    })
    assert.equal(decisionIfForced.action, "update_open")
    assert.notEqual(String(decisionIfForced.action), "close_paid")
  })
})
