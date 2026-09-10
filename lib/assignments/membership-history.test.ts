import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  resolveActiveMembershipSettings,
  settingsMembershipIdForRelease,
} from "@/lib/assignments/eligibility"
import {
  pickNextSectorEmployee,
  type SectorQueueCandidate,
} from "@/lib/assignments/picker"

const employeeId = "emp-x"
const sectorId = "sec-collections"
const oldMembershipId = "mem-old-inactive"
const newMembershipId = "mem-new-active"

const memberships = [
  { id: oldMembershipId, employeeId, sectorId, isActive: false },
  { id: newMembershipId, employeeId, sectorId, isActive: true },
]

const settings = [{ membershipId: oldMembershipId }, { membershipId: newMembershipId }]

function cand(partial: Partial<SectorQueueCandidate> & Pick<SectorQueueCandidate, "employeeId">): SectorQueueCandidate {
  return {
    employeeStatus: "active",
    membershipActive: true,
    sectorActive: true,
    queueEnabled: true,
    receivingAssignments: true,
    isAvailable: true,
    totalReceivedToday: 0,
    sectorDailyLimitDefault: 20,
    activeAssignments: 0,
    lastAssignmentAt: null,
    ...partial,
  }
}

describe("A–B) membership histórica + ativa: uma settings operacional", () => {
  it("A) picker usa somente membership ativa", () => {
    const picked = pickNextSectorEmployee([
      cand({
        employeeId,
        membershipId: oldMembershipId,
        membershipActive: false,
        lastAssignmentAt: null,
      }),
      cand({
        employeeId,
        membershipId: newMembershipId,
        membershipActive: true,
        lastAssignmentAt: "2026-01-01T00:00:00Z",
      }),
    ])
    assert.equal(picked?.membershipId, newMembershipId)
    assert.equal(picked?.membershipActive, true)
  })

  it("B) duas settings não geram multiple-row canônico", () => {
    const resolved = resolveActiveMembershipSettings({
      employeeId,
      sectorId,
      memberships,
      settings,
    })
    assert.equal(resolved?.membershipId, newMembershipId)
    assert.notEqual(resolved?.membershipId, oldMembershipId)
  })
})

describe("C–E) assign/claim/transfer destino usam membership ativa", () => {
  it("C–E) identidade operacional é a membership ativa", () => {
    const resolved = resolveActiveMembershipSettings({
      employeeId,
      sectorId,
      memberships,
      settings,
    })
    assert.equal(resolved?.membershipId, newMembershipId)
  })
})

describe("F) release usa membership_id da assignment", () => {
  it("decrementa a settings gravada, mesmo se o employee já saiu", () => {
    const assignmentMembershipId = oldMembershipId
    assert.equal(settingsMembershipIdForRelease(assignmentMembershipId), oldMembershipId)
    assert.notEqual(
      settingsMembershipIdForRelease(assignmentMembershipId),
      newMembershipId
    )
  })
})

describe("G) membership antiga nunca volta a receber", () => {
  it("resolve ignora is_active=false", () => {
    const onlyOld = resolveActiveMembershipSettings({
      employeeId,
      sectorId,
      memberships: [{ id: oldMembershipId, employeeId, sectorId, isActive: false }],
      settings,
    })
    assert.equal(onlyOld, null)
  })
})

describe("H) sai e volta ao mesmo setor", () => {
  it("nova membership ativa + settings novas → motor funcional", () => {
    const afterRejoin = resolveActiveMembershipSettings({
      employeeId,
      sectorId,
      memberships: [
        { id: oldMembershipId, employeeId, sectorId, isActive: false },
        { id: "mem-rejoin", employeeId, sectorId, isActive: true },
      ],
      settings: [...settings, { membershipId: "mem-rejoin" }],
    })
    assert.equal(afterRejoin?.membershipId, "mem-rejoin")
  })
})
