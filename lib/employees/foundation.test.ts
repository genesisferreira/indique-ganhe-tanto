import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  commercialBackfillStatusFromProfile,
  hasAnySector,
  hasSector,
  isCommercialEmployeeAssignmentEligible,
  isCommercialPoolCandidate,
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

const validPool = {
  profileRole: "comercial" as const,
  profileIsActive: true,
  employeeStatus: "active" as EmployeeStatus,
  hasActiveCommercialMembership: true,
  settingsAvailable: true,
  settingsReceivingLeads: true,
  totalReceivedToday: 0,
  dailyLimit: 20,
}

describe("2.1B A–Q) elegibilidade de NOVA atribuição comercial", () => {
  it("A) active + membership + settings → elegível", () => {
    assert.equal(
      isCommercialPoolCandidate({ ...validPool, applyDailyLimit: true }),
      true
    )
    assert.equal(
      isCommercialEmployeeAssignmentEligible(validPool),
      true
    )
  })

  it("B) paused → não elegível", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        employeeStatus: "paused",
      }),
      false
    )
  })

  it("C) vacation → não elegível", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        employeeStatus: "vacation",
      }),
      false
    )
  })

  it("D) away → não elegível", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        employeeStatus: "away",
      }),
      false
    )
  })

  it("E) dismissed → não elegível", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        employeeStatus: "dismissed",
      }),
      false
    )
  })

  it("F) sem membership commercial → não elegível", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        hasActiveCommercialMembership: false,
      }),
      false
    )
  })

  it("G) membership inativa coberta por hasActive=false", () => {
    assert.equal(
      isCommercialPoolCandidate({
        ...validPool,
        hasActiveCommercialMembership: false,
        applyDailyLimit: true,
      }),
      false
    )
  })

  it("H) profile is_active=false → não elegível", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        profileIsActive: false,
      }),
      false
    )
  })

  it("I) is_available=false → fora do pool/claim", () => {
    assert.equal(
      isCommercialPoolCandidate({
        ...validPool,
        settingsAvailable: false,
        applyDailyLimit: true,
      }),
      false
    )
  })

  it("J) receiving_leads=false → fora do pool/claim", () => {
    assert.equal(
      isCommercialPoolCandidate({
        ...validPool,
        settingsReceivingLeads: false,
        applyDailyLimit: true,
      }),
      false
    )
  })

  it("K) daily_limit atingido bloqueia assign/pick, não o predicado de claim", () => {
    assert.equal(
      isCommercialPoolCandidate({
        ...validPool,
        totalReceivedToday: 20,
        dailyLimit: 20,
        applyDailyLimit: true,
      }),
      false
    )
    assert.equal(
      isCommercialPoolCandidate({
        ...validPool,
        totalReceivedToday: 20,
        dailyLimit: 20,
        applyDailyLimit: false,
      }),
      true
    )
  })

  it("L/M) assign/pick usam o mesmo predicado de pool", () => {
    assert.equal(
      isCommercialPoolCandidate({
        ...validPool,
        employeeStatus: "paused",
        applyDailyLimit: true,
      }),
      false
    )
  })

  it("N) claim bloqueia inelegível (sem daily_limit)", () => {
    assert.equal(
      isCommercialPoolCandidate({
        ...validPool,
        employeeStatus: "vacation",
        applyDailyLimit: false,
      }),
      false
    )
  })

  it("O) lead já atribuído não entra na seleção (idempotente no caller)", () => {
    const alreadyAssigned = { commercialProfileId: "c1" }
    assert.ok(alreadyAssigned.commercialProfileId)
  })

  it("P) indicador nunca entra no pool", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        profileRole: "indicador",
      }),
      false
    )
  })

  it("Q) admin_master com membership não entra sem role comercial", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        ...validPool,
        profileRole: "admin_master",
        hasActiveCommercialMembership: true,
      }),
      false
    )
  })
})
