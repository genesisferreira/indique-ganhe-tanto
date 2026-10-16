import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"
import {
  CANCELLED_SCOPE_NOT_PROVEN,
  classifyClientContractCancellation,
  probeControllrCancellation,
  shouldExcludeCancelledFromCollections,
} from "@/lib/operational/cancelled"

const eligible = {
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

describe("Y) cancelamento ERP não confirmado não inventa filtro", () => {
  it("probe nunca marca cancelled", () => {
    const probe = probeControllrCancellation({ status: "Cancelado", cancelled: true })
    assert.equal(probe.confirmed, false)
    assert.equal(probe.cancelled, false)
    assert.equal(probe.scope, CANCELLED_SCOPE_NOT_PROVEN)
  })

  it("include_cancelled true ou false não exclui (filtro não operacional)", () => {
    assert.deepEqual(
      shouldExcludeCancelledFromCollections({ includeCancelledCustomers: false }),
      { exclude: false, operational: false, scope: CANCELLED_SCOPE_NOT_PROVEN }
    )
    assert.deepEqual(
      shouldExcludeCancelledFromCollections({ includeCancelledCustomers: true }),
      { exclude: false, operational: false, scope: CANCELLED_SCOPE_NOT_PROVEN }
    )
  })
})

describe("TEST E — cancelamento de cliente/contrato não comprovado", () => {
  it("client_status não inventa skip cancelled", () => {
    const classified = classifyClientContractCancellation({ clientStatus: 1, contractStatus: "Cancelado" })
    assert.equal(classified.skipAsCancelled, false)
    assert.equal(classified.scope, CANCELLED_SCOPE_NOT_PROVEN)
    const decision = decideCollectionSyncAction({
      invoice: eligible,
      existing: null,
      now: new Date("2026-09-11T00:00:00.000Z"),
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "create")
  })
})

describe("TEST F — bloqueio/suspensão não é cancelamento", () => {
  it("blocked/suspended não autorizam skip", () => {
    const classified = classifyClientContractCancellation({
      blocked: true,
      suspended: true,
      clientStatus: "bloqueado",
    })
    assert.equal(classified.blockedOrSuspendedIsCancelled, false)
    assert.equal(classified.skipAsCancelled, false)
  })
})

describe("TEST I/J/K/N/O — bloqueio, suspensão e idade não cancelam", () => {
  const now = new Date("2026-09-11T00:00:00.000Z")

  it("TEST I — bloqueado com fatura elegível permanece create", () => {
    const classified = classifyClientContractCancellation({ blocked: true, clientStatus: "bloqueado" })
    assert.equal(classified.skipAsCancelled, false)
    const decision = decideCollectionSyncAction({
      invoice: eligible,
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "create")
  })

  it("TEST J — suspenso não é cancelado", () => {
    const classified = classifyClientContractCancellation({ suspended: true })
    assert.equal(classified.blockedOrSuspendedIsCancelled, false)
    assert.equal(classified.skipAsCancelled, false)
  })

  it("TEST K — bloqueado pago não cria caso", () => {
    const decision = decideCollectionSyncAction({
      invoice: { ...eligible, isPaid: true, invoiceMsg: "paid", invoiceDateCredit: "2026-09-10" },
      existing: null,
      now,
    })
    assert.equal(decision.action, "skip")
    if (decision.action === "skip") assert.equal(decision.reason, "paid_without_open_case")
  })

  it("TEST N — fatura com mais de 60 dias sem evidência não é cancelada", () => {
    const old = {
      ...eligible,
      invoiceDueDate: "2026-06-01T00:00:00.000Z",
    }
    const classified = classifyClientContractCancellation({ clientStatus: 99 })
    assert.equal(classified.skipAsCancelled, false)
    const decision = decideCollectionSyncAction({
      invoice: old,
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "create")
  })

  it("TEST O — status desconhecido não inventa cancelamento", () => {
    const classified = classifyClientContractCancellation({ clientStatus: "???", contractStatus: 123 })
    assert.equal(classified.skipAsCancelled, false)
    assert.equal(classified.scope, CANCELLED_SCOPE_NOT_PROVEN)
  })
})

describe("TEST L/M — cancelamento textual não comprovado não exclui", () => {
  it("rótulo Cancelado sem enum comprovado ainda cria caso", () => {
    const classified = classifyClientContractCancellation({
      clientStatus: "Cancelado",
      contractStatus: "Cancelado",
    })
    assert.equal(classified.skipAsCancelled, false)
    const decision = decideCollectionSyncAction({
      invoice: eligible,
      existing: { id: "case-1", status: "open", invoicePk: "inv-1" },
      now: new Date("2026-09-11T00:00:00.000Z"),
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "update_open")
  })
})
