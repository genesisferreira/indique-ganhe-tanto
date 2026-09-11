import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  computeDaysOverdue,
  isCollectionOverdueEligible,
  isControllrInvoicePaid,
  shouldCloseCollectionCaseAsPaid,
  shouldOpenCollectionCase,
} from "@/lib/collections/eligibility"
import { COLLECTION_OVERDUE_THRESHOLD_DAYS } from "@/types/collections"

const dueDaysAgo = (days: number, now = new Date("2026-09-11T12:00:00.000Z")) => {
  const due = new Date(now)
  due.setUTCDate(due.getUTCDate() - days)
  return due.toISOString()
}

describe("A) invoice 4 dias atraso → não cria cobrança", () => {
  it("4 dias não é elegível", () => {
    const now = new Date("2026-09-11T12:00:00.000Z")
    const days = computeDaysOverdue({ invoiceDueDate: dueDaysAgo(4, now), now })
    assert.equal(days, 4)
    assert.equal(isCollectionOverdueEligible(days), false)
    assert.equal(
      shouldOpenCollectionCase({ daysOverdue: days, isPaid: false, invoicePk: "inv-1" }),
      false
    )
  })
})

describe("B) 5 dias → elegível", () => {
  it("atinge o limiar server-side", () => {
    const now = new Date("2026-09-11T12:00:00.000Z")
    const days = computeDaysOverdue({ invoiceDueDate: dueDaysAgo(5, now), now })
    assert.equal(days, 5)
    assert.equal(days >= COLLECTION_OVERDUE_THRESHOLD_DAYS, true)
    assert.equal(
      shouldOpenCollectionCase({ daysOverdue: days, isPaid: false, invoicePk: "inv-1" }),
      true
    )
  })
})

describe("limiar configurável 7 dias", () => {
  it("6 não elegível, 7 elegível", () => {
    assert.equal(isCollectionOverdueEligible(6, 7), false)
    assert.equal(isCollectionOverdueEligible(7, 7), true)
    assert.equal(
      shouldOpenCollectionCase({
        daysOverdue: 6,
        isPaid: false,
        invoicePk: "inv-1",
        minimumDaysOverdue: 7,
      }),
      false
    )
    assert.equal(
      shouldOpenCollectionCase({
        daysOverdue: 7,
        isPaid: false,
        invoicePk: "inv-1",
        minimumDaysOverdue: 7,
      }),
      true
    )
  })

  it("fila desligada não abre", () => {
    assert.equal(
      shouldOpenCollectionCase({
        daysOverdue: 20,
        isPaid: false,
        invoicePk: "inv-1",
        collectionsEnabled: false,
      }),
      false
    )
  })
})

describe("C) paga → não abre", () => {
  it("invoice_msg paid + date_credit", () => {
    assert.equal(
      isControllrInvoicePaid({ invoiceMsg: "paid", invoiceDateCredit: "2026-09-10" }),
      true
    )
    assert.equal(
      shouldOpenCollectionCase({
        daysOverdue: 20,
        isPaid: true,
        invoicePk: "inv-1",
      }),
      false
    )
  })

  it("paid sem date_credit não conta como pago (padrão Controllr do código)", () => {
    assert.equal(
      isControllrInvoicePaid({ invoiceMsg: "paid", invoiceDateCredit: null }),
      false
    )
  })
})

describe("G) payment fecha case", () => {
  it("open + pago → fecha; paid retried → não fecha de novo", () => {
    assert.equal(
      shouldCloseCollectionCaseAsPaid({ isPaid: true, currentStatus: "open" }),
      true
    )
    assert.equal(
      shouldCloseCollectionCaseAsPaid({ isPaid: true, currentStatus: "paid" }),
      false
    )
  })
})

describe("sem invoice_pk não inventa identidade", () => {
  it("bloqueia abertura", () => {
    assert.equal(
      shouldOpenCollectionCase({ daysOverdue: 10, isPaid: false, invoicePk: null }),
      false
    )
  })
})
