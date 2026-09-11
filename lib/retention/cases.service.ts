import "server-only"

import {
  COLLECTION_SECTOR_CODE,
  COLLECTION_WORK_TYPE,
  RETENTION_SECTOR_CODE,
  RETENTION_WORK_TYPE,
  type ContactChannel,
  type ContactOutcome,
  type RetentionCase,
  type RetentionCaseEvent,
  type RetentionCaseListItem,
  type RetentionCaseSource,
  type RetentionCaseStatus,
  type OperationalContactAttempt,
} from "@/types/collections"
import {
  assignSectorWorkItem,
  releaseSectorAssignment,
  transferSectorAssignment,
} from "@/lib/assignments/sector-rpc.service"
import { asRecord, asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import { findActiveAssignment } from "@/lib/collections/cases.service"
import { sanitizeContactNotes } from "@/lib/collections/sanitize"

export function mapRetentionCase(row: Record<string, unknown>): RetentionCase {
  return {
    id: String(row.id),
    clientPk: asString(row.client_pk),
    contractPk: asString(row.contract_pk),
    source: row.source as RetentionCaseSource,
    reason: asString(row.reason),
    status: row.status as RetentionCaseStatus,
    linkedCollectionCaseId: asString(row.linked_collection_case_id),
    sectorAssignmentId: asString(row.sector_assignment_id),
    erpSnapshot: asRecord(row.erp_snapshot) ?? {},
    metadata: asRecord(row.metadata) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: asString(row.closed_at),
  }
}

export async function insertRetentionCaseEvent(input: {
  caseId: string
  eventType: string
  actorProfileId: string | null
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const db = getOpsDb()
  await db.from("retention_case_events").insert({
    case_id: input.caseId,
    event_type: input.eventType,
    actor_profile_id: input.actorProfileId,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    metadata: input.metadata ?? {},
  }).select("id").maybeSingle()
}

async function loadAssigneeNames(employeeIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (employeeIds.length === 0) return map
  const db = getOpsDb()
  const employeesRes = await awaitQuery<{ id: string; profile_id: string }>(
    db.from("employees").select("id, profile_id").in("id", employeeIds)
  )
  const profileIds = (employeesRes.data ?? []).map((row) => row.profile_id)
  if (profileIds.length === 0) return map
  const profilesRes = await awaitQuery<{ id: string; full_name: string | null }>(
    db.from("profiles").select("id, full_name").in("id", profileIds)
  )
  const nameByProfile = new Map(
    (profilesRes.data ?? []).map((row) => [row.id, row.full_name ?? ""])
  )
  for (const emp of employeesRes.data ?? []) {
    map.set(emp.id, nameByProfile.get(emp.profile_id) || "—")
  }
  return map
}

export async function listRetentionCases(input: {
  employeeId?: string | null
  adminAll: boolean
}): Promise<RetentionCaseListItem[]> {
  const db = getOpsDb()
  let rows: Record<string, unknown>[] = []
  if (input.adminAll) {
    const res = await awaitQuery<Record<string, unknown>>(
      db
        .from("retention_cases")
        .select(
          "id, client_pk, contract_pk, source, reason, status, linked_collection_case_id, sector_assignment_id, erp_snapshot, metadata, created_at, updated_at, closed_at"
        )
        .order("updated_at", { ascending: false })
        .limit(200)
    )
    rows = res.data ?? []
  } else if (input.employeeId) {
    const assignments = await awaitQuery<{ work_id: string }>(
      db
        .from("sector_work_assignments")
        .select("work_id")
        .eq("work_type", RETENTION_WORK_TYPE)
        .eq("employee_id", input.employeeId)
        .eq("status", "active")
    )
    const ids = (assignments.data ?? []).map((row) => row.work_id)
    if (ids.length === 0) return []
    const res = await awaitQuery<Record<string, unknown>>(
      db
        .from("retention_cases")
        .select(
          "id, client_pk, contract_pk, source, reason, status, linked_collection_case_id, sector_assignment_id, erp_snapshot, metadata, created_at, updated_at, closed_at"
        )
        .in("id", ids)
        .order("updated_at", { ascending: false })
    )
    rows = res.data ?? []
  } else {
    return []
  }

  const caseIds = rows.map((row) => String(row.id))
  const assignmentRes = await awaitQuery<{ work_id: string; employee_id: string }>(
    db
      .from("sector_work_assignments")
      .select("work_id, employee_id")
      .eq("work_type", RETENTION_WORK_TYPE)
      .eq("status", "active")
      .in("work_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"])
  )
  const employeeByCase = new Map(
    (assignmentRes.data ?? []).map((row) => [row.work_id, row.employee_id])
  )
  const names = await loadAssigneeNames([...new Set(employeeByCase.values())])
  const lastRes = await awaitQuery<{ case_id: string; created_at: string }>(
    db
      .from("operational_case_contact_attempts")
      .select("case_id, created_at")
      .eq("case_type", RETENTION_WORK_TYPE)
      .in("case_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false })
  )
  const lastContact = new Map<string, string>()
  for (const row of lastRes.data ?? []) {
    if (!lastContact.has(row.case_id)) lastContact.set(row.case_id, row.created_at)
  }

  return rows.map((row) => {
    const mapped = mapRetentionCase(row)
    const employeeId = employeeByCase.get(mapped.id) ?? null
    return {
      ...mapped,
      assigneeEmployeeId: employeeId,
      assigneeName: employeeId ? names.get(employeeId) ?? null : null,
      lastContactAt: lastContact.get(mapped.id) ?? null,
    }
  })
}

export async function getRetentionCaseDetail(caseId: string): Promise<{
  case: RetentionCase | null
  events: RetentionCaseEvent[]
  attempts: OperationalContactAttempt[]
  assigneeEmployeeId: string | null
}> {
  const db = getOpsDb()
  const { data } = await db
    .from("retention_cases")
    .select(
      "id, client_pk, contract_pk, source, reason, status, linked_collection_case_id, sector_assignment_id, erp_snapshot, metadata, created_at, updated_at, closed_at"
    )
    .eq("id", caseId)
    .maybeSingle()
  if (!data) {
    return { case: null, events: [], attempts: [], assigneeEmployeeId: null }
  }
  const eventsRes = await awaitQuery<Record<string, unknown>>(
    db
      .from("retention_case_events")
      .select("id, case_id, event_type, actor_profile_id, old_value, new_value, metadata, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(100)
  )
  const attemptsRes = await awaitQuery<Record<string, unknown>>(
    db
      .from("operational_case_contact_attempts")
      .select("id, case_type, case_id, channel, outcome, notes, actor_profile_id, created_at")
      .eq("case_type", RETENTION_WORK_TYPE)
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(100)
  )
  const active = await findActiveAssignment({
    workType: RETENTION_WORK_TYPE,
    workId: caseId,
  })
  return {
    case: mapRetentionCase(data),
    events: (eventsRes.data ?? []).map((row) => ({
      id: String(row.id),
      caseId: String(row.case_id),
      eventType: String(row.event_type),
      actorProfileId: asString(row.actor_profile_id),
      oldValue: asRecord(row.old_value),
      newValue: asRecord(row.new_value),
      metadata: asRecord(row.metadata) ?? {},
      createdAt: String(row.created_at),
    })),
    attempts: (attemptsRes.data ?? []).map((row) => ({
      id: String(row.id),
      caseType: RETENTION_WORK_TYPE,
      caseId: String(row.case_id),
      channel: row.channel as ContactChannel,
      outcome: row.outcome as ContactOutcome,
      notes: asString(row.notes),
      actorProfileId: String(row.actor_profile_id),
      createdAt: String(row.created_at),
    })),
    assigneeEmployeeId: active?.employeeId ?? null,
  }
}

export async function registerRetentionContact(input: {
  caseId: string
  actorProfileId: string
  channel: ContactChannel
  outcome: ContactOutcome
  notes?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = getOpsDb()
  const { data: current } = await db
    .from("retention_cases")
    .select("id, status")
    .eq("id", input.caseId)
    .maybeSingle()
  if (!current?.id) return { ok: false, message: "Caso não encontrado." }

  await db
    .from("operational_case_contact_attempts")
    .insert({
      case_type: RETENTION_WORK_TYPE,
      case_id: input.caseId,
      channel: input.channel,
      outcome: input.outcome,
      notes: sanitizeContactNotes(input.notes),
      actor_profile_id: input.actorProfileId,
    })
    .select("id")
    .maybeSingle()

  const nextStatus =
    current.status === "open" ? "in_contact" : current.status
  if (nextStatus !== current.status && !["retained", "not_retained", "cancelled", "closed"].includes(String(current.status))) {
    await db.from("retention_cases").update({ status: nextStatus }).eq("id", input.caseId)
  }
  await insertRetentionCaseEvent({
    caseId: input.caseId,
    eventType: "contact_attempt",
    actorProfileId: input.actorProfileId,
    oldValue: { status: current.status },
    newValue: { status: nextStatus, channel: input.channel, outcome: input.outcome },
  })
  return { ok: true }
}

export async function updateRetentionStatus(input: {
  caseId: string
  actorProfileId: string
  status: RetentionCaseStatus
}): Promise<{ ok: true; status: RetentionCaseStatus } | { ok: false; message: string }> {
  const allowed: RetentionCaseStatus[] = [
    "open",
    "in_contact",
    "offer_made",
    "retained",
    "not_retained",
    "cancelled",
    "closed",
  ]
  if (!allowed.includes(input.status)) {
    return { ok: false, message: "Status não permitido." }
  }
  const db = getOpsDb()
  const { data: current } = await db
    .from("retention_cases")
    .select("id, status")
    .eq("id", input.caseId)
    .maybeSingle()
  if (!current?.id) return { ok: false, message: "Caso não encontrado." }
  if (current.status === input.status) return { ok: true, status: input.status }

  const terminal = ["retained", "not_retained", "cancelled", "closed"].includes(input.status)
  await db
    .from("retention_cases")
    .update({
      status: input.status,
      closed_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", input.caseId)

  if (terminal) {
    const active = await findActiveAssignment({
      workType: RETENTION_WORK_TYPE,
      workId: input.caseId,
    })
    if (active) {
      await releaseSectorAssignment({
        assignmentId: active.id,
        closeStatus: "completed",
        actorProfileId: input.actorProfileId,
        reason: input.status,
      })
      await db
        .from("retention_cases")
        .update({ sector_assignment_id: null })
        .eq("id", input.caseId)
    }
  }

  const eventType =
    input.status === "offer_made"
      ? "offer_made"
      : input.status === "retained"
        ? "retained"
        : input.status === "not_retained"
          ? "not_retained"
          : input.status === "closed" || input.status === "cancelled"
            ? "closed"
            : "status_changed"

  await insertRetentionCaseEvent({
    caseId: input.caseId,
    eventType,
    actorProfileId: input.actorProfileId,
    oldValue: { status: current.status },
    newValue: { status: input.status },
  })
  return { ok: true, status: input.status }
}

export async function transferRetentionCase(input: {
  caseId: string
  toEmployeeId: string
  actorProfileId: string
  reason?: string | null
}): Promise<{ ok: true; assignmentId?: string } | { ok: false; message: string }> {
  const active = await findActiveAssignment({
    workType: RETENTION_WORK_TYPE,
    workId: input.caseId,
  })
  if (!active) return { ok: false, message: "Caso sem assignment ativa." }
  const result = await transferSectorAssignment({
    assignmentId: active.id,
    toEmployeeId: input.toEmployeeId,
    actorProfileId: input.actorProfileId,
    reason: input.reason ?? "manual_transfer",
  })
  if (!result.ok && result.code !== "same_employee") {
    return { ok: false, message: result.message ?? result.code }
  }
  const db = getOpsDb()
  if (result.assignmentId) {
    await db
      .from("retention_cases")
      .update({ sector_assignment_id: result.assignmentId })
      .eq("id", input.caseId)
  }
  await insertRetentionCaseEvent({
    caseId: input.caseId,
    eventType: "transferred",
    actorProfileId: input.actorProfileId,
    oldValue: { assignment_id: active.id },
    newValue: { assignment_id: result.assignmentId ?? active.id },
  })
  return { ok: true, assignmentId: result.assignmentId }
}

export async function createManualRetentionCase(input: {
  actorProfileId: string
  clientPk?: string | null
  contractPk?: string | null
  reason: string
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, message: "Informe o motivo de risco." }
  const db = getOpsDb()
  const inserted = await db
    .from("retention_cases")
    .insert({
      client_pk: input.clientPk?.trim() || null,
      contract_pk: input.contractPk?.trim() || null,
      source: "manual",
      reason: reason.slice(0, 500),
      status: "open",
      metadata: { created_manually: true },
    })
    .select("id")
    .maybeSingle()
  if (!inserted.data?.id) {
    return { ok: false, message: "Não foi possível criar o caso." }
  }
  const caseId = String(inserted.data.id)
  await insertRetentionCaseEvent({
    caseId,
    eventType: "created",
    actorProfileId: input.actorProfileId,
    newValue: { source: "manual", reason },
  })
  const assigned = await assignSectorWorkItem({
    sectorCode: RETENTION_SECTOR_CODE,
    workType: RETENTION_WORK_TYPE,
    workId: caseId,
    actorProfileId: input.actorProfileId,
    metadata: { source: "manual" },
  })
  if (assigned.ok && assigned.assignmentId) {
    await db
      .from("retention_cases")
      .update({ sector_assignment_id: assigned.assignmentId })
      .eq("id", caseId)
    await insertRetentionCaseEvent({
      caseId,
      eventType: "assigned",
      actorProfileId: input.actorProfileId,
      newValue: { assignment_id: assigned.assignmentId },
    })
  }
  return { ok: true, id: caseId }
}

export function summarizeRetentionDashboard(items: RetentionCaseListItem[]) {
  return {
    mine: items.length,
    open: items.filter((item) => item.status === "open" || item.status === "in_contact").length,
    offerMade: items.filter((item) => item.status === "offer_made").length,
    retained: items.filter((item) => item.status === "retained").length,
    notRetained: items.filter((item) => item.status === "not_retained").length,
  }
}

export const RETENTION_ENGINE_SECTOR = RETENTION_SECTOR_CODE
export const COLLECTION_ENGINE_SECTOR = COLLECTION_SECTOR_CODE
