import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { requireOperationalCaseWriteAccess } from "@/lib/auth/sector-membership"

const ownerA = {
  sectorCode: "collections" as const,
  workType: "collection_case",
  workId: "case-1",
  role: "comercial" as const,
  employeeId: "emp-a",
  employeeStatus: "active" as const,
  membershipActive: true,
  membershipSectorCode: "collections",
  activeAssignmentEmployeeId: "emp-a",
}

describe("G) employee A owner pode POST", () => {
  it("write ok", () => {
    const r = requireOperationalCaseWriteAccess(ownerA)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.kind, "member")
  })
})

describe("H/I) employee B mesmo setor, UUID conhecido, 403", () => {
  it("não owner", () => {
    const r = requireOperationalCaseWriteAccess({
      ...ownerA,
      employeeId: "emp-b",
      activeAssignmentEmployeeId: "emp-a",
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.status, 403)
  })
})

describe("J) após transfer A→B", () => {
  it("A perde write, B ganha", () => {
    const a = requireOperationalCaseWriteAccess({
      ...ownerA,
      employeeId: "emp-a",
      activeAssignmentEmployeeId: "emp-b",
    })
    const b = requireOperationalCaseWriteAccess({
      ...ownerA,
      employeeId: "emp-b",
      activeAssignmentEmployeeId: "emp-b",
    })
    assert.equal(a.ok, false)
    assert.equal(b.ok, true)
  })
})

describe("K) employee retention não escreve collection", () => {
  it("membership retention no setor collections", () => {
    const r = requireOperationalCaseWriteAccess({
      ...ownerA,
      membershipSectorCode: "retention",
      membershipActive: true,
    })
    assert.equal(r.ok, false)
  })
})

describe("L) employee collections não escreve retention", () => {
  it("setor retention + membership collections", () => {
    const r = requireOperationalCaseWriteAccess({
      sectorCode: "retention",
      workType: "retention_case",
      workId: "ret-1",
      role: "comercial",
      employeeId: "emp-a",
      employeeStatus: "active",
      membershipActive: true,
      membershipSectorCode: "collections",
      activeAssignmentEmployeeId: "emp-a",
    })
    assert.equal(r.ok, false)
  })
})

describe("M) admin_master escreve qualquer case", () => {
  it("sem assignment", () => {
    const r = requireOperationalCaseWriteAccess({
      sectorCode: "collections",
      workType: "collection_case",
      workId: "case-1",
      role: "admin_master",
      employeeId: null,
      employeeStatus: null,
      membershipActive: false,
      activeAssignmentEmployeeId: null,
    })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.kind, "admin_master")
  })
})

describe("N/O) admin_consulta e admin_financeiro não escrevem", () => {
  it("consulta 403 mesmo com membership e assignment", () => {
    const r = requireOperationalCaseWriteAccess({
      ...ownerA,
      role: "admin_consulta",
    })
    assert.equal(r.ok, false)
  })

  it("financeiro 403 mesmo com membership e assignment", () => {
    const r = requireOperationalCaseWriteAccess({
      ...ownerA,
      role: "admin_financeiro",
    })
    assert.equal(r.ok, false)
  })
})

describe("P) employee paused mesmo owner → write bloqueado", () => {
  it("paused 403", () => {
    const r = requireOperationalCaseWriteAccess({
      ...ownerA,
      employeeStatus: "paused",
    })
    assert.equal(r.ok, false)
  })
})
