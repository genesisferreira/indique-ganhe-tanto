import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  compareRoundRobinCandidates,
  pickNextSectorEmployee,
  type SectorQueueCandidate,
} from "@/lib/assignments/picker"

function cand(
  partial: Partial<SectorQueueCandidate> & Pick<SectorQueueCandidate, "employeeId">
): SectorQueueCandidate {
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

describe("L) round-robin escolhe o menos recentemente utilizado", () => {
  it("NULLS FIRST depois o mais antigo", () => {
    const picked = pickNextSectorEmployee([
      cand({ employeeId: "e2", lastAssignmentAt: "2026-09-10T12:00:00Z" }),
      cand({ employeeId: "e1", lastAssignmentAt: "2026-09-09T12:00:00Z" }),
      cand({ employeeId: "e0", lastAssignmentAt: null }),
    ])
    assert.equal(picked?.employeeId, "e0")
  })
})

describe("M) empate usa critério estável (employee_id ASC)", () => {
  it("mesmo timestamp e total → menor employee_id", () => {
    const cmp = compareRoundRobinCandidates(
      { employeeId: "aaa", lastAssignmentAt: "2026-01-01T00:00:00Z", totalReceivedToday: 1 },
      { employeeId: "bbb", lastAssignmentAt: "2026-01-01T00:00:00Z", totalReceivedToday: 1 }
    )
    assert.ok(cmp < 0)
    const picked = pickNextSectorEmployee([
      cand({ employeeId: "emp-b", lastAssignmentAt: "2026-01-01T00:00:00Z", totalReceivedToday: 2 }),
      cand({ employeeId: "emp-a", lastAssignmentAt: "2026-01-01T00:00:00Z", totalReceivedToday: 2 }),
    ])
    assert.equal(picked?.employeeId, "emp-a")
  })
})

describe("N) exclude_employee_id funciona", () => {
  it("não devolve o excluído", () => {
    const picked = pickNextSectorEmployee(
      [
        cand({ employeeId: "prev", lastAssignmentAt: null }),
        cand({ employeeId: "next", lastAssignmentAt: "2026-01-01T00:00:00Z" }),
      ],
      "prev"
    )
    assert.equal(picked?.employeeId, "next")
  })
})

describe("picker ignora inelegíveis", () => {
  it("paused não entra mesmo sendo o mais antigo", () => {
    const picked = pickNextSectorEmployee([
      cand({ employeeId: "paused", employeeStatus: "paused", lastAssignmentAt: null }),
      cand({ employeeId: "ok", lastAssignmentAt: "2026-01-01T00:00:00Z" }),
    ])
    assert.equal(picked?.employeeId, "ok")
  })
})
