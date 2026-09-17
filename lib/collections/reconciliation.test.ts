import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isControllrInvoicePaid } from "@/lib/collections/eligibility"
import {
  classifyInvoiceDetailForReconciliation,
  reconciliationAdvancesCursor,
  RECONCILIATION_POSITIVE_PAYMENT_RULE,
  shouldWriteReconciliationClosePaid,
} from "@/lib/collections/reconciliation"

describe("regra positiva de pagamento da reconciliação", () => {
  it("documenta e preserva o critério vigente", () => {
    assert.match(RECONCILIATION_POSITIVE_PAYMENT_RULE, /isPaid===true/)
    assert.match(RECONCILIATION_POSITIVE_PAYMENT_RULE, /invoice_msg/)
    assert.match(RECONCILIATION_POSITIVE_PAYMENT_RULE, /invoice_date_credit/)
  })

  it("invoice_msg=paid sem crédito não fecha pela regra composta", () => {
    assert.equal(
      isControllrInvoicePaid({ invoiceMsg: "paid", invoiceDateCredit: null, isPaid: false }),
      false
    )
    const classified = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "41",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "41",
        invoiceMsg: "paid",
        invoiceDateCredit: null,
        isPaid: false,
        raw: { invoice_pk: "41", invoice_msg: "paid", invoice_date_credit: null },
      },
    })
    assert.equal(classified.outcome, "still_open")
    assert.equal(shouldWriteReconciliationClosePaid({ outcome: classified.outcome, currentStatus: "open" }), false)
  })

  it("crédito presente sem a outra condição exigida não fecha", () => {
    assert.equal(
      isControllrInvoicePaid({
        invoiceMsg: "open",
        invoiceDateCredit: "2026-09-10",
        isPaid: false,
      }),
      false
    )
    const classified = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "42",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "42",
        invoiceMsg: "open",
        invoiceDateCredit: "2026-09-10",
        isPaid: false,
        raw: { invoice_pk: "42", invoice_msg: "open", invoice_date_credit: "2026-09-10" },
      },
    })
    assert.equal(classified.outcome, "still_open")
  })

  it("isPaid=true preserva o fechamento da regra existente", () => {
    assert.equal(isControllrInvoicePaid({ isPaid: true, invoiceMsg: "open", invoiceDateCredit: null }), true)
    const classified = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "43",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "43",
        invoiceMsg: "open",
        invoiceDateCredit: null,
        isPaid: false,
        raw: { invoice_pk: "43", invoice_msg: "open", isPaid: true },
      },
    })
    assert.equal(classified.outcome, "close_paid")
    assert.equal(
      shouldWriteReconciliationClosePaid({ outcome: classified.outcome, currentStatus: "open" }),
      true
    )
    assert.equal(
      shouldWriteReconciliationClosePaid({ outcome: classified.outcome, currentStatus: "paid" }),
      false
    )
  })

  it("msg paid com crédito fecha", () => {
    const classified = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "44",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "44",
        invoiceMsg: "paid",
        invoiceDateCredit: "2026-09-10",
        isPaid: true,
        raw: { invoice_pk: "44", invoice_msg: "paid", invoice_date_credit: "2026-09-10" },
      },
    })
    assert.equal(classified.outcome, "close_paid")
  })

  it("removido/cancelado/não encontrado não fecha como pago", () => {
    assert.equal(
      classifyInvoiceDetailForReconciliation({
        requestedInvoicePk: "45",
        ok: true,
        httpStatus: 200,
        info: {
          invoicePk: "45",
          invoiceMsg: "cancelled",
          invoiceDateCredit: "2026-09-10",
          raw: { invoice_pk: "45", invoice_msg: "cancelled", invoice_deleted: true },
        },
      }).outcome,
      "removed_or_cancelled"
    )
    assert.equal(
      classifyInvoiceDetailForReconciliation({
        requestedInvoicePk: "46",
        ok: false,
        httpStatus: 404,
        message: "Invoice not found",
        info: null,
      }).outcome,
      "not_found"
    )
    assert.equal(
      shouldWriteReconciliationClosePaid({ outcome: "removed_or_cancelled", currentStatus: "open" }),
      false
    )
    assert.equal(shouldWriteReconciliationClosePaid({ outcome: "not_found", currentStatus: "open" }), false)
  })

  it("detalhe de outra invoice_pk é rejeitado sem escrita", () => {
    const classified = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "47",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "99",
        invoiceMsg: "paid",
        invoiceDateCredit: "2026-09-10",
        raw: { invoice_pk: "99", invoice_msg: "paid", invoice_date_credit: "2026-09-10" },
      },
    })
    assert.equal(classified.outcome, "identity_mismatch")
    assert.equal(classified.returnedInvoicePk, "99")
    assert.equal(
      shouldWriteReconciliationClosePaid({ outcome: classified.outcome, currentStatus: "open" }),
      false
    )
  })

  it("timeout ou detalhe sem identidade no raw não avança o cursor", () => {
    const timeout = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "48",
      ok: false,
      httpStatus: null,
      abortClass: "timeout",
      message: "timeout",
      info: null,
    })
    assert.equal(timeout.outcome, "timeout_or_error")
    assert.equal(reconciliationAdvancesCursor(timeout.outcome), false)
    const filledMissingPk = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "48",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "48",
        invoiceMsg: "paid",
        invoiceDateCredit: "2026-09-10",
        raw: { invoice_msg: "paid", invoice_date_credit: "2026-09-10" },
      },
    })
    assert.equal(filledMissingPk.outcome, "invalid_detail")
    assert.equal(reconciliationAdvancesCursor("still_open"), true)
  })

  it("strings e números não fecham pelo ramo booleano isPaid", () => {
    for (const flag of ["true", "false", "1", 1, 0, "yes"]) {
      const classified = classifyInvoiceDetailForReconciliation({
        requestedInvoicePk: "49",
        ok: true,
        httpStatus: 200,
        info: {
          invoicePk: "49",
          invoiceMsg: "open",
          invoiceDateCredit: null,
          isPaid: false,
          raw: { invoice_pk: "49", invoice_msg: "open", isPaid: flag, is_paid: flag },
        },
      })
      assert.equal(classified.outcome, "still_open", String(flag))
    }
    const strictTrue = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "49",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "49",
        invoiceMsg: "open",
        invoiceDateCredit: null,
        isPaid: false,
        raw: { invoice_pk: "49", invoice_msg: "open", isPaid: true },
      },
    })
    assert.equal(strictTrue.outcome, "close_paid")
  })

  it("HTTP 500 de detalhe permanece retomável e não avança", () => {
    const classified = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "50",
      ok: false,
      httpStatus: 500,
      message: "upstream error",
      info: null,
    })
    assert.equal(classified.outcome, "timeout_or_error")
    assert.equal(reconciliationAdvancesCursor(classified.outcome), false)
  })

  it("pago e removido não fecha como pago", () => {
    const classified = classifyInvoiceDetailForReconciliation({
      requestedInvoicePk: "51",
      ok: true,
      httpStatus: 200,
      info: {
        invoicePk: "51",
        invoiceMsg: "paid",
        invoiceDateCredit: "2026-09-10",
        raw: {
          invoice_pk: "51",
          invoice_msg: "paid",
          invoice_date_credit: "2026-09-10",
          invoice_deleted: true,
          isPaid: true,
        },
      },
    })
    assert.equal(classified.outcome, "removed_or_cancelled")
    assert.equal(
      shouldWriteReconciliationClosePaid({ outcome: classified.outcome, currentStatus: "open" }),
      false
    )
  })
})
