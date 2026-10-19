import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
  COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
  COLLECTION_DISCOVERY_SUPERSEDE_REASON_DUE_DATE_PARSER_BUG,
  COLLECTION_DISCOVERY_SUPERSEDE_REASONS,
  COLLECTION_DISCOVERY_TIMEZONE,
  type CollectionDiscoveryRun,
} from "@/lib/collections/discovery-contract"
import { validateDiscoveryCheckpoint } from "@/lib/collections/discovery-checkpoint"
import { createMemoryDiscoveryStore } from "@/lib/collections/discovery-store"

function supersededRun(): CollectionDiscoveryRun {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    queryContractVersion: COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
    referenceInstant: "2026-10-16T12:00:00.000Z",
    referenceDate: "2026-10-16",
    discoveryTimezone: COLLECTION_DISCOVERY_TIMEZONE,
    paginationStrategy: COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
    cursorLastInvoicePk: "24000",
    status: "superseded",
    leaseOwner: null,
    leaseUntil: null,
    leaseGeneration: 5,
    scannedPages: 16,
    scannedInvoices: 240,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 240,
    assignedCount: 0,
    unassignedCount: 0,
    errorCount: 0,
    reportedTotal: 240,
    lastErrorClass: COLLECTION_DISCOVERY_SUPERSEDE_REASON_DUE_DATE_PARSER_BUG,
    consecutiveNoProgress: 0,
    coverageProven: false,
    uniqueOrderProven: false,
    phase: "discovery",
    reconcileCursorInvoicePk: "23991",
    reconcileScannedCount: 0,
    reconcileClosedCount: 0,
    reconcileSkippedCount: 0,
  }
}

describe("3.1E-AH supersede — contrato local", () => {
  it("motivo controlado não aceita texto livre", () => {
    assert.deepEqual(COLLECTION_DISCOVERY_SUPERSEDE_REASONS, ["due_date_parser_bug"])
    assert.equal(
      COLLECTION_DISCOVERY_SUPERSEDE_REASON_DUE_DATE_PARSER_BUG,
      "due_date_parser_bug"
    )
  })

  it("superseded não é retomável e não é conclusão", () => {
    const validated = validateDiscoveryCheckpoint(supersededRun())
    assert.equal(validated.ok, false)
    if (!validated.ok) assert.equal(validated.code, "run_not_resumable")
  })

  it("claim sem runId ignora superseded e cria nova run sem cursor", async () => {
    const store = createMemoryDiscoveryStore([supersededRun()])
    const claimed = await store.claimOrStart({
      owner: "new-worker",
      now: new Date("2026-10-19T18:00:00.000Z"),
      referenceInstant: new Date("2026-10-19T18:00:00.000Z"),
      referenceDate: "2026-10-19",
    })
    assert.equal(claimed.ok, true)
    if (!claimed.ok) return
    assert.equal(claimed.created, true)
    assert.notEqual(claimed.run.id, supersededRun().id)
    assert.equal(claimed.run.cursorLastInvoicePk, null)
    assert.equal(claimed.run.referenceDate, "2026-10-19")
    assert.equal(claimed.run.scannedPages, 0)
    assert.equal(claimed.run.coverageProven, false)
    assert.equal(claimed.run.uniqueOrderProven, false)
  })

  it("claim com runId de superseded recusa retomada", async () => {
    const seeded = supersededRun()
    const store = createMemoryDiscoveryStore([seeded])
    const claimed = await store.claimOrStart({
      owner: "old-worker",
      now: new Date("2026-10-19T18:00:00.000Z"),
      referenceInstant: new Date("2026-10-19T18:00:00.000Z"),
      referenceDate: "2026-10-19",
      runId: seeded.id,
    })
    assert.equal(claimed.ok, false)
    if (claimed.ok) return
    assert.equal(claimed.code, "run_not_resumable")
  })
})
