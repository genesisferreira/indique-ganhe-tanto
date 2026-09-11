import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  canCompleteRetentionAttendance,
  parseCustomerRemains,
} from "@/lib/retention/attendance-policy"
import {
  CONTROLLR_HISTORY_WRITE_ENABLED,
  forceCrmHistorySource,
  isHumanHistoryEvent,
  isTechnicalAssignmentEvent,
  mergeOperationalTimeline,
  type OperationalHistoryItem,
} from "@/lib/operational/history"
import { stripBrowserActor } from "@/lib/collections/http-payload"

function item(
  partial: Partial<OperationalHistoryItem> & Pick<OperationalHistoryItem, "id" | "occurredAt">
): OperationalHistoryItem {
  return {
    clientPk: null,
    contractPk: null,
    documentMasked: null,
    customerNameSnapshot: null,
    sectorCode: "retention",
    employeeId: null,
    actorProfileId: null,
    source: "crm",
    externalHistoryId: null,
    eventType: "retention_attendance_started",
    action: null,
    result: null,
    notes: null,
    customerRemains: null,
    ...partial,
  }
}

describe("R) employee A não edita atendimento de B", () => {
  it("403 conceitual", () => {
    const r = canCompleteRetentionAttendance({
      attendanceEmployeeId: "emp-a",
      actorEmployeeId: "emp-b",
      isAdminMaster: false,
      status: "open",
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, "not_owner")
  })
})

describe("Q) actor é o employee da sessão", () => {
  it("owner pode concluir", () => {
    const r = canCompleteRetentionAttendance({
      attendanceEmployeeId: "emp-a",
      actorEmployeeId: "emp-a",
      isAdminMaster: false,
      status: "open",
    })
    assert.equal(r.ok, true)
  })
})

describe("T/U/V) customer_remains obrigatório e persistível", () => {
  it("ausente falha", () => {
    assert.equal(parseCustomerRemains(null).ok, false)
    assert.equal(parseCustomerRemains(undefined).ok, false)
    assert.equal(parseCustomerRemains("").ok, false)
  })

  it("SIM", () => {
    const r = parseCustomerRemains(true)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.remains, true)
  })

  it("NÃO", () => {
    const r = parseCustomerRemains(false)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.remains, false)
  })
})

describe("W/Y/Z) append CRM e spoof ignorado", () => {
  it("source spoof vira crm", () => {
    assert.equal(forceCrmHistorySource("controllr"), "crm")
  })

  it("actor/source do browser stripped", () => {
    const rest = stripBrowserActor({
      actorProfileId: "hack",
      source: "controllr",
      notes: "ok",
    })
    assert.equal("source" in rest, false)
    assert.equal("actorProfileId" in rest, false)
    assert.equal(rest.notes, "ok")
  })
})

describe("AA/AB) timeline ordena e faz merge", () => {
  it("DESC por occurred_at e dedupe external_history_id", () => {
    const crm = [
      item({ id: "c1", occurredAt: "2026-09-11T10:00:00.000Z", eventType: "collection_contact" }),
      item({
        id: "c2",
        occurredAt: "2026-09-11T12:00:00.000Z",
        source: "crm",
        externalHistoryId: "erp-1",
      }),
    ]
    const controllr = [
      item({
        id: "e1",
        occurredAt: "2026-09-11T11:00:00.000Z",
        source: "controllr",
        externalHistoryId: "erp-1",
        eventType: "note",
      }),
      item({
        id: "e2",
        occurredAt: "2026-09-10T09:00:00.000Z",
        source: "controllr",
        externalHistoryId: "erp-2",
        eventType: "note",
      }),
    ]
    const merged = mergeOperationalTimeline({ crm, controllr })
    assert.equal(merged[0]?.id, "c2")
    assert.equal(merged.some((row) => row.id === "e1"), false)
    assert.equal(merged[merged.length - 1]?.id, "e2")
  })
})

describe("AC/AF) Controllr write off; assignment não é timeline humana", () => {
  it("write disabled", () => {
    assert.equal(CONTROLLR_HISTORY_WRITE_ENABLED, false)
  })

  it("assigned não é evento humano", () => {
    assert.equal(isTechnicalAssignmentEvent("assigned"), true)
    assert.equal(isHumanHistoryEvent("assigned"), false)
    assert.equal(isHumanHistoryEvent("collection_contact"), true)
    assert.equal(isHumanHistoryEvent("retention_attendance_completed"), true)
  })
})


describe("R) employee A não edita atendimento de B", () => {
  it("403 conceitual", () => {
    const r = canCompleteRetentionAttendance({
      attendanceEmployeeId: "emp-a",
      actorEmployeeId: "emp-b",
      isAdminMaster: false,
      status: "open",
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, "not_owner")
  })
})

describe("Q) actor é o employee da sessão", () => {
  it("owner pode concluir", () => {
    const r = canCompleteRetentionAttendance({
      attendanceEmployeeId: "emp-a",
      actorEmployeeId: "emp-a",
      isAdminMaster: false,
      status: "open",
    })
    assert.equal(r.ok, true)
  })
})

describe("T/U/V) customer_remains obrigatório e persistível", () => {
  it("ausente falha", () => {
    assert.equal(parseCustomerRemains(null).ok, false)
    assert.equal(parseCustomerRemains(undefined).ok, false)
    assert.equal(parseCustomerRemains("").ok, false)
  })

  it("SIM", () => {
    const r = parseCustomerRemains(true)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.remains, true)
  })

  it("NÃO", () => {
    const r = parseCustomerRemains(false)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.remains, false)
  })
})

describe("Admin Master pode concluir", () => {
  it("bypass owner", () => {
    const r = canCompleteRetentionAttendance({
      attendanceEmployeeId: "emp-a",
      actorEmployeeId: null,
      isAdminMaster: true,
      status: "open",
    })
    assert.equal(r.ok, true)
  })
})
