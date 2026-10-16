import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  classifyInvoiceDeletedFlag,
  classifyUnmappedDiscoveryRow,
  emptyDiscoverySkipHistogram,
  incrementDiscoverySkip,
  sanitizeDiscoverySkipHistogram,
  sumDiscoverySkipHistogram,
} from "@/lib/collections/skip-reason"
import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"
import {
  createMemoryDiscoveryCaseRepo,
  persistDiscoveredOverdueInvoice,
} from "@/lib/collections/discovery-persist"

const now = new Date("2026-09-11T00:00:00.000Z")
const overdue = {
  invoicePk: "1001",
  contractPk: "1",
  clientPk: "1",
  customerName: "Maria Silva",
  customerDocument: "***8901",
  invoiceDueDate: "2026-09-01T00:00:00.000Z",
  invoiceMsg: "open",
  invoiceDateCredit: null,
  isPaid: false,
  invoiceAmountDocument: 199.9,
  invoiceAmountPaid: 0,
}

describe("TEST H — soma do histograma", () => {
  it("incrementos conhecidos e unknown caem em inconclusive", () => {
    const histogram = emptyDiscoverySkipHistogram()
    incrementDiscoverySkip(histogram, "not_old_enough")
    incrementDiscoverySkip(histogram, "not_old_enough")
    incrementDiscoverySkip(histogram, "paid_without_open_case")
    incrementDiscoverySkip(histogram, "totally_unknown" as never)
    assert.equal(histogram.not_old_enough, 2)
    assert.equal(histogram.paid_without_open_case, 1)
    assert.equal(histogram.inconclusive, 1)
    assert.equal(sumDiscoverySkipHistogram(histogram), 4)
    const sanitized = sanitizeDiscoverySkipHistogram(histogram)
    const blob = JSON.stringify(sanitized)
    assert.equal(blob.includes("Maria"), false)
    assert.equal(blob.includes("1001"), false)
    assert.equal(blob.includes("199.9"), false)
  })
})

describe("TEST D/G — invoice_deleted", () => {
  it("true é removed_or_cancelled; string inválida é inconclusive", () => {
    assert.equal(classifyInvoiceDeletedFlag({ invoice_deleted: true }).kind, "deleted")
    assert.equal(classifyInvoiceDeletedFlag({ invoice_deleted: false }).kind, "not_deleted")
    assert.equal(classifyInvoiceDeletedFlag({ invoice_deleted: "true" }).kind, "inconclusive")
    assert.equal(
      classifyInvoiceDeletedFlag({ invoice_deleted: true, invoiceDeleted: false }).kind,
      "inconclusive"
    )
    assert.equal(
      classifyUnmappedDiscoveryRow({ invoicePk: "1001", invoiceDeleted: true, raw: { invoice_deleted: true } }),
      "removed_or_cancelled"
    )
    assert.equal(
      classifyUnmappedDiscoveryRow({ invoicePk: "1001", invoiceDeleted: false, raw: { invoice_deleted: "x" } }),
      "inconclusive"
    )
  })
})

describe("TEST I/J — create e update não entram no histograma", () => {
  it("persist create/update deixam skipReason nulo", async () => {
    const repo = createMemoryDiscoveryCaseRepo()
    const created = await persistDiscoveredOverdueInvoice({
      invoice: overdue,
      existing: null,
      now,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      actorProfileId: "actor-1",
      repo,
    })
    assert.equal(created.created, true)
    assert.equal(created.skipReason, null)
    const updated = await persistDiscoveredOverdueInvoice({
      invoice: overdue,
      existing: { id: "case-1", status: "open", invoicePk: "1001" },
      now,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      actorProfileId: "actor-1",
      repo,
    })
    assert.equal(updated.updated, true)
    assert.equal(updated.skipped, false)
    assert.equal(updated.skipReason, null)
  })
})

describe("TEST C — pago usa motivo específico", () => {
  it("paid_without_open_case", () => {
    const decision = decideCollectionSyncAction({
      invoice: { ...overdue, isPaid: true },
      existing: null,
      now,
    })
    assert.equal(decision.action, "skip")
    if (decision.action === "skip") assert.equal(decision.reason, "paid_without_open_case")
  })
})

describe("TEST B — persistência 4 dias", () => {
  it("skip not_old_enough sem criar caso", async () => {
    const repo = createMemoryDiscoveryCaseRepo()
    const persisted = await persistDiscoveredOverdueInvoice({
      invoice: { ...overdue, invoiceDueDate: "2026-09-07T00:00:00.000Z" },
      existing: null,
      now,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      actorProfileId: "actor-1",
      repo,
    })
    assert.equal(persisted.created, false)
    assert.equal(persisted.skipped, true)
    assert.equal(persisted.skipReason, "not_old_enough")
    assert.equal(repo.cases.size, 0)
  })
})
