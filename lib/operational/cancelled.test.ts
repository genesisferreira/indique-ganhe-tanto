import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"
import {
  CANCELLED_SCOPE_NOT_PROVEN,
  CONTRACT_CANCELLED_PROVEN,
  CONTRACT_STATUS_INCONCLUSIVE,
  CONTROLLR_CLIENT_STATUS_CODE,
  CONTROLLR_CLIENT_STATUS_LABEL,
  CONTROLLR_CONTRACT_STATUS_CODE,
  CONTROLLR_CONTRACT_STATUS_LABEL,
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

const now = new Date("2026-09-11T00:00:00.000Z")

describe("Y) setting include_cancelled não opera exclusão de cliente", () => {
  it("probe de cliente nunca marca cancelled", () => {
    const probe = probeControllrCancellation({ status: "Cancelado", cancelled: true })
    assert.equal(probe.confirmed, false)
    assert.equal(probe.cancelled, false)
    assert.equal(probe.scope, CANCELLED_SCOPE_NOT_PROVEN)
  })

  it("include_cancelled true ou false não exclui cliente (filtro não operacional)", () => {
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

describe("TEST E — client_status não prova cancelamento", () => {
  it("client_status Desabilitado não inventa skip cancelled", () => {
    const classified = classifyClientContractCancellation({
      clientStatus: CONTROLLR_CLIENT_STATUS_CODE.DISABLED,
    })
    assert.equal(classified.skipAsCancelled, false)
    assert.equal(classified.scope, CANCELLED_SCOPE_NOT_PROVEN)
    assert.equal(CONTROLLR_CLIENT_STATUS_LABEL[1], "Desabilitado")
    const decision = decideCollectionSyncAction({
      invoice: { ...eligible, clientStatus: CONTROLLR_CLIENT_STATUS_CODE.DISABLED },
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "create")
  })
})

describe("TEST F — bloqueio/suspensão não é cancelamento", () => {
  it("blocked/suspended sem enum de contrato não autorizam skip", () => {
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
  it("TEST I — contrato Bloqueado=4 com fatura elegível permanece create", () => {
    assert.equal(CONTROLLR_CONTRACT_STATUS_LABEL[4], "Bloqueado")
    const classified = classifyClientContractCancellation({
      contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.BLOCKED,
      clientStatus: CONTROLLR_CLIENT_STATUS_CODE.DISABLED,
    })
    assert.equal(classified.skipAsCancelled, false)
    assert.equal(classified.scope, CONTRACT_CANCELLED_PROVEN)
    const decision = decideCollectionSyncAction({
      invoice: {
        ...eligible,
        contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.BLOCKED,
        clientStatus: CONTROLLR_CLIENT_STATUS_CODE.DISABLED,
      },
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "create")
  })

  it("TEST J — Alertado/Pendente não são cancelados", () => {
    const alerted = classifyClientContractCancellation({
      contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.ALERTED,
    })
    const pending = classifyClientContractCancellation({
      contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.PENDING,
    })
    assert.equal(alerted.blockedOrSuspendedIsCancelled, false)
    assert.equal(alerted.skipAsCancelled, false)
    assert.equal(pending.skipAsCancelled, false)
    const decision = decideCollectionSyncAction({
      invoice: { ...eligible, contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.ALERTED },
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "create")
  })

  it("TEST K — bloqueado pago não cria caso", () => {
    const decision = decideCollectionSyncAction({
      invoice: {
        ...eligible,
        isPaid: true,
        invoiceMsg: "paid",
        invoiceDateCredit: "2026-09-10",
        contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.BLOCKED,
      },
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

  it("TEST O — status de contrato desconhecido vira inconclusive", () => {
    const classified = classifyClientContractCancellation({
      clientStatus: "???",
      contractStatus: 123,
    })
    assert.equal(classified.skipAsCancelled, false)
    assert.equal(classified.skipAsInconclusive, true)
    assert.equal(classified.scope, CONTRACT_STATUS_INCONCLUSIVE)
    const decision = decideCollectionSyncAction({
      invoice: { ...eligible, contractStatus: 123 },
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "skip")
    if (decision.action === "skip") assert.equal(decision.reason, "inconclusive")
  })
})

describe("TEST L/M — cancelamento textual não é o enum 5", () => {
  it("rótulo Cancelado sem integer 5 não exclui como cancelled_contract", () => {
    const classified = classifyClientContractCancellation({
      clientStatus: "Cancelado",
      contractStatus: "Cancelado",
    })
    assert.equal(classified.skipAsCancelled, false)
    assert.equal(classified.skipAsInconclusive, true)
    const decision = decideCollectionSyncAction({
      invoice: { ...eligible, contractStatus: "Cancelado" },
      existing: { id: "case-1", status: "open", invoicePk: "inv-1" },
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "skip")
    if (decision.action === "skip") assert.equal(decision.reason, "inconclusive")
  })
})

describe("contrato Cancelado=5", () => {
  it("contrato Ativado=1 permanece elegível", () => {
    assert.equal(CONTROLLR_CONTRACT_STATUS_LABEL[1], "Ativado")
    const decision = decideCollectionSyncAction({
      invoice: { ...eligible, contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.ACTIVATED },
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(decision.action, "create")
  })

  it("contrato Cancelado=5 não cria nem atualiza caso", () => {
    assert.equal(CONTROLLR_CONTRACT_STATUS_LABEL[5], "Cancelado")
    const classified = classifyClientContractCancellation({
      contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.CANCELED,
    })
    assert.equal(classified.cancelled, true)
    assert.equal(classified.skipAsCancelled, true)
    assert.equal(classified.skipReason, "cancelled_contract")
    assert.equal(classified.scope, CONTRACT_CANCELLED_PROVEN)
    const create = decideCollectionSyncAction({
      invoice: { ...eligible, contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.CANCELED },
      existing: null,
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(create.action, "skip")
    if (create.action === "skip") assert.equal(create.reason, "cancelled_contract")
    const update = decideCollectionSyncAction({
      invoice: { ...eligible, contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.CANCELED },
      existing: { id: "case-1", status: "open", invoicePk: "inv-1" },
      now,
      minimumDaysOverdue: 5,
    })
    assert.equal(update.action, "skip")
    if (update.action === "skip") assert.equal(update.reason, "cancelled_contract")
  })

  it("contrato cancelado pago segue a regra de pagamento, não fecha por cancelamento", () => {
    const decision = decideCollectionSyncAction({
      invoice: {
        ...eligible,
        isPaid: true,
        invoiceMsg: "paid",
        invoiceDateCredit: "2026-09-10",
        contractStatus: CONTROLLR_CONTRACT_STATUS_CODE.CANCELED,
      },
      existing: { id: "case-1", status: "open", invoicePk: "inv-1" },
      now,
    })
    assert.equal(decision.action, "close_paid")
  })
})
