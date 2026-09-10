import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isSectorEmployeeAssignmentEligible,
  isSectorQueueCandidate,
} from "@/lib/assignments/eligibility"
import type { EmployeeStatus } from "@/types/employee"

const baseQueue = {
  membershipActive: true,
  sectorActive: true,
  queueEnabled: true,
  receivingAssignments: true,
  isAvailable: true,
  totalReceivedToday: 0,
  sectorDailyLimitDefault: 20,
  activeAssignments: 0,
} as const

describe("A) active + membership + setor + settings → elegível", () => {
  it("identidade e fila passam", () => {
    assert.equal(
      isSectorEmployeeAssignmentEligible({
        employeeStatus: "active",
        membershipActive: true,
        sectorActive: true,
      }),
      true
    )
    assert.equal(
      isSectorQueueCandidate({
        ...baseQueue,
        employeeStatus: "active",
      }),
      true
    )
  })
})

describe("B–E) status inelegíveis", () => {
  const blocked: EmployeeStatus[] = ["paused", "vacation", "away", "dismissed"]
  for (const status of blocked) {
    it(`${status} → inelegível`, () => {
      assert.equal(
        isSectorEmployeeAssignmentEligible({
          employeeStatus: status,
          membershipActive: true,
          sectorActive: true,
        }),
        false
      )
      assert.equal(
        isSectorQueueCandidate({ ...baseQueue, employeeStatus: status }),
        false
      )
    })
  }
})

describe("F) membership inativa → inelegível", () => {
  it("bloqueia", () => {
    assert.equal(
      isSectorEmployeeAssignmentEligible({
        employeeStatus: "active",
        membershipActive: false,
        sectorActive: true,
      }),
      false
    )
  })
})

describe("G) setor inativo → inelegível", () => {
  it("bloqueia", () => {
    assert.equal(
      isSectorEmployeeAssignmentEligible({
        employeeStatus: "active",
        membershipActive: true,
        sectorActive: false,
      }),
      false
    )
  })
})

describe("H) receiving_assignments=false → inelegível", () => {
  it("bloqueia na fila", () => {
    assert.equal(
      isSectorQueueCandidate({
        ...baseQueue,
        employeeStatus: "active",
        receivingAssignments: false,
      }),
      false
    )
  })
})

describe("I) is_available=false → inelegível", () => {
  it("bloqueia na fila", () => {
    assert.equal(
      isSectorQueueCandidate({
        ...baseQueue,
        employeeStatus: "active",
        isAvailable: false,
      }),
      false
    )
  })
})

describe("J) daily_limit atingido → inelegível", () => {
  it("bloqueia", () => {
    assert.equal(
      isSectorQueueCandidate({
        ...baseQueue,
        employeeStatus: "active",
        totalReceivedToday: 20,
        sectorDailyLimitDefault: 20,
      }),
      false
    )
  })
})

describe("K) max_active atingido → inelegível", () => {
  it("bloqueia quando teto existe", () => {
    assert.equal(
      isSectorQueueCandidate({
        ...baseQueue,
        employeeStatus: "active",
        activeAssignments: 3,
        sectorMaxActiveDefault: 3,
      }),
      false
    )
  })

  it("sem teto permanece elegível", () => {
    assert.equal(
      isSectorQueueCandidate({
        ...baseQueue,
        employeeStatus: "active",
        activeAssignments: 99,
        sectorMaxActiveDefault: null,
      }),
      true
    )
  })
})

describe("profile inativo → inelegível", () => {
  it("bloqueia", () => {
    assert.equal(
      isSectorEmployeeAssignmentEligible({
        employeeStatus: "active",
        membershipActive: true,
        sectorActive: true,
        profileIsActive: false,
      }),
      false
    )
  })
})
