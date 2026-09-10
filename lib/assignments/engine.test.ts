import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  SECTOR_ASSIGNMENT_RPC,
  buildAssignSectorWorkItemArgs,
  buildClaimSectorWorkItemArgs,
  isAllowedCloseStatus,
  isIdempotentAssignResult,
  resolveConcurrentAssignWinner,
  transferClosesPreviousAs,
} from "@/lib/assignments/engine"

describe("O) retry do mesmo work item é idempotente", () => {
  it("assigned e already_assigned são sucesso idempotente", () => {
    assert.equal(isIdempotentAssignResult("assigned"), true)
    assert.equal(isIdempotentAssignResult("already_assigned"), true)
    assert.equal(isIdempotentAssignResult("no_employee_available"), false)
  })
})

describe("P) duas assigns concorrentes → uma assignment ativa", () => {
  it("unique/existing vence o segundo insert", () => {
    assert.equal(
      resolveConcurrentAssignWinner({
        firstInserted: true,
        existingActiveAssignmentId: null,
      }),
      "first"
    )
    assert.equal(
      resolveConcurrentAssignWinner({
        firstInserted: false,
        existingActiveAssignmentId: "asg-1",
      }),
      "existing"
    )
  })
})

describe("Q) transfer encerra anterior e cria nova", () => {
  it("status anterior vira released", () => {
    assert.equal(transferClosesPreviousAs(), "released")
  })
})

describe("S) complete encerra assignment", () => {
  it("completed/released/cancelled são fechamento", () => {
    assert.equal(isAllowedCloseStatus("completed"), true)
    assert.equal(isAllowedCloseStatus("released"), true)
    assert.equal(isAllowedCloseStatus("cancelled"), true)
    assert.equal(isAllowedCloseStatus("active"), false)
  })
})

describe("payloads RPC internos", () => {
  it("assign não envia auth de browser", () => {
    const args = buildAssignSectorWorkItemArgs({
      sectorCode: "collections",
      workType: "collection_case",
      workId: "11111111-1111-1111-1111-111111111111",
    })
    assert.equal(args.p_sector_code, "collections")
    assert.equal("p_employee_id" in args, false)
  })

  it("claim exige employeeId do caller autenticado no server", () => {
    const args = buildClaimSectorWorkItemArgs({
      sectorCode: "retention",
      workType: "retention_task",
      workId: "22222222-2222-2222-2222-222222222222",
      employeeId: "emp-1",
    })
    assert.equal(args.p_employee_id, "emp-1")
  })

  it("nomes RPC estáveis", () => {
    assert.equal(SECTOR_ASSIGNMENT_RPC.assign, "assign_sector_work_item")
    assert.equal(SECTOR_ASSIGNMENT_RPC.pick, "pick_next_sector_employee")
    assert.equal(SECTOR_ASSIGNMENT_RPC.claim, "claim_sector_work_item")
  })
})
