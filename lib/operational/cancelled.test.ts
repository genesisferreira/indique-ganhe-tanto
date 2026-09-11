import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { probeControllrCancellation, shouldExcludeCancelledFromCollections } from "@/lib/operational/cancelled"

describe("Y) cancelamento ERP não confirmado não inventa filtro", () => {
  it("probe nunca marca cancelled", () => {
    const probe = probeControllrCancellation({ status: "Cancelado", cancelled: true })
    assert.equal(probe.confirmed, false)
    assert.equal(probe.cancelled, false)
  })

  it("include_cancelled true ou false não exclui (filtro não operacional)", () => {
    assert.deepEqual(
      shouldExcludeCancelledFromCollections({ includeCancelledCustomers: false }),
      { exclude: false, operational: false }
    )
    assert.deepEqual(
      shouldExcludeCancelledFromCollections({ includeCancelledCustomers: true }),
      { exclude: false, operational: false }
    )
  })
})
