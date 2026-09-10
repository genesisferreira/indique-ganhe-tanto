import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  commercialBackfillStatusFromProfile,
  hasAnySector,
  hasSector,
  isEligibleForFutureAssignment,
  isEmployee,
} from "@/lib/employees/foundation"
import type { EmployeeStatus } from "@/types/employee"

describe("A) employee 1:1 com profile", () => {
  it("isEmployee exige employeeId e profileId", () => {
    assert.equal(isEmployee({ employeeId: "e1", profileId: "p1" }), true)
    assert.equal(isEmployee({ employeeId: "e1", profileId: null }), false)
    assert.equal(isEmployee({ employeeId: "", profileId: "p1" }), false)
  })
})

describe("B) um employee pode possuir múltiplos setores", () => {
  it("hasAnySector reconhece commercial + collections", () => {
    const memberships = [
      { sectorCode: "commercial", isActive: true },
      { sectorCode: "collections", isActive: true },
    ]
    assert.equal(hasSector({ memberships, sectorCode: "commercial" }), true)
    assert.equal(hasSector({ memberships, sectorCode: "collections" }), true)
    assert.equal(
      hasAnySector({ memberships, sectorCodes: ["retention", "collections"] }),
      true
    )
  })
})

describe("D) membership antigo permanece como histórico", () => {
  it("vínculo inativo não conta como hasSector", () => {
    const memberships = [
      { sectorCode: "commercial", isActive: false },
      { sectorCode: "upgrade", isActive: true },
    ]
    assert.equal(hasSector({ memberships, sectorCode: "commercial" }), false)
    assert.equal(hasSector({ memberships, sectorCode: "upgrade" }), true)
  })
})

describe("E–I) elegibilidade futura por status + membership", () => {
  const cases: Array<{
    status: EmployeeStatus
    membershipActive: boolean
    expected: boolean
    label: string
  }> = [
    { status: "dismissed", membershipActive: true, expected: false, label: "E dismissed" },
    { status: "vacation", membershipActive: true, expected: false, label: "F vacation" },
    { status: "paused", membershipActive: true, expected: false, label: "G paused" },
    { status: "away", membershipActive: true, expected: false, label: "H away" },
    { status: "active", membershipActive: true, expected: true, label: "I active+membership" },
    { status: "active", membershipActive: false, expected: false, label: "I active sem membership" },
  ]
  for (const row of cases) {
    it(row.label, () => {
      assert.equal(
        isEligibleForFutureAssignment({
          employeeStatus: row.status,
          membershipActive: row.membershipActive,
        }),
        row.expected
      )
    })
  }
})

describe("L) backfill Comercial respeita profiles.is_active", () => {
  it("ativo → active; inativo → paused (não dismissed)", () => {
    assert.equal(commercialBackfillStatusFromProfile(true), "active")
    assert.equal(commercialBackfillStatusFromProfile(null), "active")
    assert.equal(commercialBackfillStatusFromProfile(false), "paused")
  })
})

describe("helpers não concedem autorização", () => {
  it("hasSector em cobranca não implica admin", () => {
    const memberships = [{ sectorCode: "collections", isActive: true }]
    assert.equal(hasSector({ memberships, sectorCode: "collections" }), true)
    assert.equal(hasSector({ memberships, sectorCode: "commercial" }), false)
  })
})
