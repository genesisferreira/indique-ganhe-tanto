import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isIdempotentEscalation } from "@/lib/collections/escalate-policy"
import { isIdempotentAssignResult } from "@/lib/assignments/engine"
import { canEnterSectorRoundRobin } from "@/lib/auth/sector-membership"

describe("H/I) escalation idempotente", () => {
  it("escalated e already_escalated são sucesso", () => {
    assert.equal(isIdempotentEscalation("escalated"), true)
    assert.equal(isIdempotentEscalation("already_escalated"), true)
    assert.equal(isIdempotentEscalation("invalid_status"), false)
  })
})

describe("E/J) assignment retry não duplica owner", () => {
  it("motor 2.2 already_assigned é idempotente", () => {
    assert.equal(isIdempotentAssignResult("assigned"), true)
    assert.equal(isIdempotentAssignResult("already_assigned"), true)
  })
})

describe("K) admin vê todos mas não entra no RR", () => {
  it("admin_master sem membership não é candidato de fila", () => {
    assert.equal(
      canEnterSectorRoundRobin({
        employeeId: null,
        employeeStatus: null,
        membershipActive: false,
        role: "admin_master",
      }),
      false
    )
  })
})

describe("O) employee paused perde novas assignments", () => {
  it("paused + membership não entra no RR", () => {
    assert.equal(
      canEnterSectorRoundRobin({
        employeeId: "emp-1",
        employeeStatus: "paused",
        membershipActive: true,
      }),
      false
    )
  })
})
