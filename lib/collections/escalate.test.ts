import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isIdempotentAssignResult, type SectorEngineCode } from "@/lib/assignments/engine"
import { canEnterSectorRoundRobin } from "@/lib/auth/sector-membership"
import {
  decideEscalationAfterAssign,
  isIdempotentEscalation,
  isRetentionAssignSuccess,
  mapRetentionAssignFailure,
  RETENTION_ASSIGN_SUCCESS_CODES,
} from "@/lib/collections/escalate-policy"

const ASSIGN_CODES: SectorEngineCode[] = [
  "assigned",
  "already_assigned",
  "already_claimed",
  "already_closed",
  "claimed",
  "transferred",
  "same_employee",
  "completed",
  "released",
  "cancelled",
  "no_employee_available",
  "not_eligible",
  "not_found",
  "not_active",
  "invalid_input",
  "invalid_sector",
  "queue_disabled",
  "transfer_disabled",
  "claim_disabled",
  "unique_violation",
  "exception",
]

describe("H/I) escalation idempotente", () => {
  it("escalated e already_escalated são sucesso", () => {
    assert.equal(isIdempotentEscalation("escalated"), true)
    assert.equal(isIdempotentEscalation("already_escalated"), true)
    assert.equal(isIdempotentEscalation("no_retention_employee_available"), false)
  })
})

describe("A) retention sem employee → não fecha collection", () => {
  it("no_employee_available não muta Cobrança", () => {
    const d = decideEscalationAfterAssign({
      collectionStatus: "open",
      assignOk: false,
      assignCode: "no_employee_available",
    })
    assert.equal(d.ok, false)
    assert.equal(d.code, "no_retention_employee_available")
    assert.equal(d.mutateCollection, false)
    assert.equal(d.releaseCollections, false)
    assert.equal(d.persistRetention, false)
  })
})

describe("B) assign success → collection escalated + release", () => {
  it("assigned muta e solta Cobrança", () => {
    const d = decideEscalationAfterAssign({
      collectionStatus: "in_contact",
      assignOk: true,
      assignCode: "assigned",
    })
    assert.equal(d.ok, true)
    assert.equal(d.code, "escalated")
    assert.equal(d.mutateCollection, true)
    assert.equal(d.releaseCollections, true)
    assert.equal(d.persistRetention, true)
  })
})

describe("C) already_assigned é sucesso idempotente", () => {
  it("already_assigned escala na primeira vez", () => {
    const d = decideEscalationAfterAssign({
      collectionStatus: "open",
      assignOk: true,
      assignCode: "already_assigned",
    })
    assert.equal(d.ok, true)
    assert.equal(isRetentionAssignSuccess("already_assigned"), true)
    assert.equal(d.mutateCollection, true)
  })
})

describe("D) assign failure inesperado → collection não fecha", () => {
  it("queue_disabled / exception", () => {
    for (const code of ["queue_disabled", "exception", "invalid_sector", "not_eligible"]) {
      const d = decideEscalationAfterAssign({
        collectionStatus: "open",
        assignOk: false,
        assignCode: code,
      })
      assert.equal(d.ok, false, code)
      assert.equal(d.mutateCollection, false, code)
      assert.equal(d.releaseCollections, false, code)
      assert.equal(d.persistRetention, false, code)
      assert.equal(d.code, code)
    }
  })
})

describe("E) retry após no_employee_available pode funcionar depois", () => {
  it("mesmo case open: falha depois sucesso", () => {
    const fail = decideEscalationAfterAssign({
      collectionStatus: "open",
      assignOk: false,
      assignCode: "no_employee_available",
    })
    const ok = decideEscalationAfterAssign({
      collectionStatus: "open",
      assignOk: true,
      assignCode: "assigned",
    })
    assert.equal(fail.ok, false)
    assert.equal(fail.mutateCollection, false)
    assert.equal(ok.ok, true)
    assert.equal(ok.mutateCollection, true)
  })
})

describe("F) retry após sucesso não reescala", () => {
  it("already escalated + already_assigned", () => {
    const d = decideEscalationAfterAssign({
      collectionStatus: "escalated_retention",
      assignOk: true,
      assignCode: "already_assigned",
    })
    assert.equal(d.ok, true)
    assert.equal(d.code, "already_escalated")
    assert.equal(d.mutateCollection, false)
    assert.equal(isIdempotentAssignResult("already_assigned"), true)
  })
})

describe("mapRetentionAssignFailure", () => {
  it("no_employee_available vira code estável", () => {
    assert.equal(
      mapRetentionAssignFailure("no_employee_available"),
      "no_retention_employee_available"
    )
  })
})

describe("códigos de assign_sector_work_item na escalada", () => {
  it("só assigned e already_assigned são sucesso", () => {
    assert.deepEqual([...RETENTION_ASSIGN_SUCCESS_CODES], ["assigned", "already_assigned"])
    for (const code of ASSIGN_CODES) {
      const success = isRetentionAssignSuccess(code)
      if (code === "assigned" || code === "already_assigned") {
        assert.equal(success, true, code)
        continue
      }
      assert.equal(success, false, code)
      const evenIfOkFlag = decideEscalationAfterAssign({
        collectionStatus: "open",
        assignOk: true,
        assignCode: code,
      })
      assert.equal(evenIfOkFlag.ok, false, code)
      assert.equal(evenIfOkFlag.mutateCollection, false, code)
      assert.equal(evenIfOkFlag.releaseCollections, false, code)
      assert.equal(evenIfOkFlag.persistRetention, false, code)
    }
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
