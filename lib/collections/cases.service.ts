import "server-only"

import {
  COLLECTION_SECTOR_CODE,
  COLLECTION_WORK_TYPE,
  type CollectionCase,
  type CollectionCaseEvent,
  type CollectionCaseListItem,
  type CollectionCaseStatus,
  type ContactChannel,
  type ContactOutcome,
  type OperationalContactAttempt,
} from "@/types/collections"
import { isIdempotentAssignResult } from "@/lib/assignments/engine"
import {
  assignSectorWorkItem,
  releaseSectorAssignment,
  transferSectorAssignment,
} from "@/lib/assignments/sector-rpc.service"
import { asNumber, asRecord, asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import { sanitizeContactNotes } from "@/lib/collections/sanitize"
import { appendCustomerOperationalHistory } from "@/lib/operational/history.service"

type CollectionCaseRow = {
  id: string
  client_pk: string | null
  contract_pk: string | null
  invoice_pk: string | null
  customer_name: string | null
  customer_document: string | null
  days_overdue: number
  overdue_since: string | null
  outstanding_amount: number | string | null
  status: CollectionCaseStatus
  sector_assignment_id: string | null
  erp_snapshot: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  closed_at: string | null
}

export function mapCollectionCase(row: Record<string, unknown>): CollectionCase {
  return {
    id: String(row.id),
    clientPk: asString(row.client_pk),
    contractPk: asString(row.contract_pk),
    invoicePk: asString(row.invoice_pk),
    customerName: asString(row.customer_name),
    customerDocument: asString(row.customer_document),
    daysOverdue: asNumber(row.days_overdue) ?? 0,
    overdueSince: asString(row.overdue_since),
    outstandingAmount: asNumber(row.outstanding_amount),
    status: row.status as CollectionCaseStatus,
    sectorAssignmentId: asString(row.sector_assignment_id),
    erpSnapshot: asRecord(row.erp_snapshot) ?? {},
    metadata: asRecord(row.metadata) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: asString(row.closed_at),
  }
}

export async function insertCollectionCaseEvent(input: {
  caseId: string
  eventType: string
  actorProfileId: string | null
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const db = getOpsDb()
  await db.from("collection_case_events").insert({
    case_id: input.caseId,
    event_type: input.eventType,
    actor_profile_id: input.actorProfileId,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    metadata: input.metadata ?? {},
  }).select("id").maybeSingle()
}

export async function findActiveAssignment(input: {
  workType: string
  workId: string
}): Promise<{ id: string; employeeId: string } | null> {
  const db = getOpsDb()
  const { data } = await db
    .from("sector_work_assignments")
    .select("id, employee_id, status")
    .eq("work_type", input.workType)
    .eq("work_id", input.workId)
    .eq("status", "active")
    .maybeSingle()
  if (!data?.id) return null
  return { id: String(data.id), employeeId: String(data.employee_id) }
}

export async function ensureCollectionAssignment(input: {
  caseId: string
  actorProfileId: string
}): Promise<{ assignmentId: string | null; code: string }> {
  const result = await assignSectorWorkItem({
    sectorCode: COLLECTION_SECTOR_CODE,
    workType: COLLECTION_WORK_TYPE,
    workId: input.caseId,
    actorProfileId: input.actorProfileId,
    metadata: { source: "collection_sync" },
  })
  if (result.ok && result.assignmentId) {
    const db = getOpsDb()
    await db
      .from("collection_cases")
      .update({ sector_assignment_id: result.assignmentId })
      .eq("id", input.caseId)
    if (result.code === "assigned") {
      await insertCollectionCaseEvent({
        caseId: input.caseId,
        eventType: "assigned",
        actorProfileId: input.actorProfileId,
        newValue: {
          assignment_id: result.assignmentId,
          employee_id: result.employeeId ?? null,
        },
      })
    }
    return { assignmentId: result.assignmentId, code: result.code }
  }
  if (isIdempotentAssignResult(result.code) && result.assignmentId) {
    return { assignmentId: result.assignmentId, code: result.code }
  }
  return { assignmentId: null, code: result.code }
}

export async function releaseCollectionAssignmentIfActive(input: {
  caseId: string
  actorProfileId: string
  reason: string
  closeStatus?: "completed" | "released" | "cancelled"
}): Promise<string> {
  const active = await findActiveAssignment({
    workType: COLLECTION_WORK_TYPE,
    workId: input.caseId,
  })
  if (!active) return "already_closed"
  const released = await releaseSectorAssignment({
    assignmentId: active.id,
    closeStatus: input.closeStatus ?? "completed",
    actorProfileId: input.actorProfileId,
    reason: input.reason,
  })
  const db = getOpsDb()
  await db
    .from("collection_cases")
    .update({ sector_assignment_id: null })
    .eq("id", input.caseId)
  return released.code
}

async function loadAssigneeNames(
  employeeIds: string[]
): Promise<Map<string, string>> {
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

async function loadLastContactAt(
  caseType: string,
  caseIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (caseIds.length === 0) return map
  const db = getOpsDb()
  const res = await awaitQuery<{ case_id: string; created_at: string }>(
    db
      .from("operational_case_contact_attempts")
      .select("case_id, created_at")
      .eq("case_type", caseType)
      .in("case_id", caseIds)
      .order("created_at", { ascending: false })
  )
  for (const row of res.data ?? []) {
    if (!map.has(row.case_id)) map.set(row.case_id, row.created_at)
  }
  return map
}

export async function listCollectionCases(input: {
  employeeId?: string | null
  adminAll: boolean
}): Promise<CollectionCaseListItem[]> {
  const db = getOpsDb()
  let rows: CollectionCaseRow[] = []

  if (input.adminAll) {
    const res = await awaitQuery<CollectionCaseRow>(
      db
        .from("collection_cases")
        .select(
          "id, client_pk, contract_pk, invoice_pk, customer_name, customer_document, days_overdue, overdue_since, outstanding_amount, status, sector_assignment_id, erp_snapshot, metadata, created_at, updated_at, closed_at"
        )
        .order("updated_at", { ascending: false })
        .limit(200)
    )
    rows = res.data ?? []
  } else if (input.employeeId) {
    const assignments = await awaitQuery<{ work_id: string; employee_id: string }>(
      db
        .from("sector_work_assignments")
        .select("work_id, employee_id")
        .eq("work_type", COLLECTION_WORK_TYPE)
        .eq("employee_id", input.employeeId)
        .eq("status", "active")
    )
    const ids = (assignments.data ?? []).map((row) => row.work_id)
    if (ids.length === 0) return []
    const res = await awaitQuery<CollectionCaseRow>(
      db
        .from("collection_cases")
        .select(
          "id, client_pk, contract_pk, invoice_pk, customer_name, customer_document, days_overdue, overdue_since, outstanding_amount, status, sector_assignment_id, erp_snapshot, metadata, created_at, updated_at, closed_at"
        )
        .in("id", ids)
        .order("updated_at", { ascending: false })
    )
    rows = res.data ?? []
  } else {
    return []
  }

  const caseIds = rows.map((row) => row.id)
  const assignmentRes = await awaitQuery<{
    work_id: string
    employee_id: string
    status: string
  }>(
    db
      .from("sector_work_assignments")
      .select("work_id, employee_id, status")
      .eq("work_type", COLLECTION_WORK_TYPE)
      .eq("status", "active")
      .in("work_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"])
  )
  const employeeByCase = new Map(
    (assignmentRes.data ?? []).map((row) => [row.work_id, row.employee_id])
  )
  const names = await loadAssigneeNames([...new Set(employeeByCase.values())])
  const lastContact = await loadLastContactAt(COLLECTION_WORK_TYPE, caseIds)

  return rows.map((row) => {
    const mapped = mapCollectionCase(row as unknown as Record<string, unknown>)
    const employeeId = employeeByCase.get(row.id) ?? null
    return {
      ...mapped,
      assigneeEmployeeId: employeeId,
      assigneeName: employeeId ? names.get(employeeId) ?? null : null,
      lastContactAt: lastContact.get(row.id) ?? null,
    }
  })
}

export async function getCollectionCaseDetail(caseId: string): Promise<{
  case: CollectionCase | null
  events: CollectionCaseEvent[]
  attempts: OperationalContactAttempt[]
  assigneeEmployeeId: string | null
}> {
  const db = getOpsDb()
  const { data } = await db
    .from("collection_cases")
    .select(
      "id, client_pk, contract_pk, invoice_pk, customer_name, customer_document, days_overdue, overdue_since, outstanding_amount, status, sector_assignment_id, erp_snapshot, metadata, created_at, updated_at, closed_at"
    )
    .eq("id", caseId)
    .maybeSingle()
  if (!data) {
    return { case: null, events: [], attempts: [], assigneeEmployeeId: null }
  }

  const eventsRes = await awaitQuery<Record<string, unknown>>(
    db
      .from("collection_case_events")
      .select("id, case_id, event_type, actor_profile_id, old_value, new_value, metadata, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(100)
  )
  const attemptsRes = await awaitQuery<Record<string, unknown>>(
    db
      .from("operational_case_contact_attempts")
      .select("id, case_type, case_id, channel, outcome, notes, actor_profile_id, created_at")
      .eq("case_type", COLLECTION_WORK_TYPE)
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(100)
  )
  const active = await findActiveAssignment({
    workType: COLLECTION_WORK_TYPE,
    workId: caseId,
  })

  return {
    case: mapCollectionCase(data),
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
      caseType: COLLECTION_WORK_TYPE,
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

export async function registerCollectionContact(input: {
  caseId: string
  actorProfileId: string
  employeeId?: string | null
  channel: ContactChannel
  outcome: ContactOutcome
  notes?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = getOpsDb()
  const { data: current } = await db
    .from("collection_cases")
    .select("id, status, client_pk, contract_pk, customer_name, customer_document")
    .eq("id", input.caseId)
    .maybeSingle()
  if (!current?.id) return { ok: false, message: "Caso não encontrado." }

  await db
    .from("operational_case_contact_attempts")
    .insert({
      case_type: COLLECTION_WORK_TYPE,
      case_id: input.caseId,
      channel: input.channel,
      outcome: input.outcome,
      notes: sanitizeContactNotes(input.notes),
      actor_profile_id: input.actorProfileId,
    })
    .select("id")
    .maybeSingle()

  const nextStatus =
    current.status === "open" || current.status === "unresolved"
      ? input.outcome === "promised_payment"
        ? "promise_to_pay"
        : "in_contact"
      : input.outcome === "promised_payment"
        ? "promise_to_pay"
        : current.status

  if (nextStatus !== current.status && current.status !== "paid" && current.status !== "closed" && current.status !== "escalated_retention") {
    await db
      .from("collection_cases")
      .update({ status: nextStatus })
      .eq("id", input.caseId)
  }

  await insertCollectionCaseEvent({
    caseId: input.caseId,
    eventType: input.outcome === "promised_payment" ? "promise_to_pay" : "contact_attempt",
    actorProfileId: input.actorProfileId,
    oldValue: { status: current.status },
    newValue: { status: nextStatus, channel: input.channel, outcome: input.outcome },
  })

  await appendCustomerOperationalHistory({
    clientPk: asString(current.client_pk),
    contractPk: asString(current.contract_pk),
    customerNameSnapshot: asString(current.customer_name),
    sectorCode: COLLECTION_SECTOR_CODE,
    employeeId: input.employeeId ?? null,
    actorProfileId: input.actorProfileId,
    eventType:
      input.outcome === "promised_payment" ? "collection_promise_to_pay" : "collection_contact",
    action: input.channel,
    result: input.outcome,
    notes: sanitizeContactNotes(input.notes),
    metadata: { collection_case_id: input.caseId },
  })

  return { ok: true }
}

export async function updateCollectionStatus(input: {
  caseId: string
  actorProfileId: string
  employeeId?: string | null
  status: CollectionCaseStatus
}): Promise<{ ok: true; status: CollectionCaseStatus } | { ok: false; message: string }> {
  const allowed: CollectionCaseStatus[] = [
    "open",
    "in_contact",
    "promise_to_pay",
    "unresolved",
    "closed",
  ]
  if (!allowed.includes(input.status)) {
    return { ok: false, message: "Status não permitido nesta ação." }
  }
  const db = getOpsDb()
  const { data: current } = await db
    .from("collection_cases")
    .select("id, status, client_pk, contract_pk, customer_name")
    .eq("id", input.caseId)
    .maybeSingle()
  if (!current?.id) return { ok: false, message: "Caso não encontrado." }
  if (current.status === "paid" || current.status === "escalated_retention") {
    return { ok: false, message: "Caso não pode mudar de status." }
  }
  if (current.status === input.status) {
    return { ok: true, status: input.status }
  }

  const closedAt = input.status === "closed" ? new Date().toISOString() : null
  await db
    .from("collection_cases")
    .update({ status: input.status, closed_at: closedAt })
    .eq("id", input.caseId)

  if (input.status === "closed") {
    await releaseCollectionAssignmentIfActive({
      caseId: input.caseId,
      actorProfileId: input.actorProfileId,
      reason: "closed",
    })
  }

  await insertCollectionCaseEvent({
    caseId: input.caseId,
    eventType: input.status === "closed" ? "closed" : input.status === "promise_to_pay" ? "promise_to_pay" : "status_changed",
    actorProfileId: input.actorProfileId,
    oldValue: { status: current.status },
    newValue: { status: input.status },
  })

  if (input.status === "closed" || input.status === "promise_to_pay") {
    await appendCustomerOperationalHistory({
      clientPk: asString(current.client_pk),
      contractPk: asString(current.contract_pk),
      customerNameSnapshot: asString(current.customer_name),
      sectorCode: COLLECTION_SECTOR_CODE,
      employeeId: input.employeeId ?? null,
      actorProfileId: input.actorProfileId,
      eventType:
        input.status === "closed" ? "collection_closed" : "collection_promise_to_pay",
      result: input.status,
      metadata: { collection_case_id: input.caseId },
    })
  }

  return { ok: true, status: input.status }
}

export async function closeCollectionCasePaid(input: {
  caseId: string
  actorProfileId: string
  snapshot?: Record<string, unknown>
}): Promise<{ ok: true; alreadyPaid: boolean } | { ok: false; message: string }> {
  const db = getOpsDb()
  const { data: current } = await db
    .from("collection_cases")
    .select("id, status, client_pk, contract_pk, customer_name")
    .eq("id", input.caseId)
    .maybeSingle()
  if (!current?.id) return { ok: false, message: "Caso não encontrado." }
  if (current.status === "paid") {
    await releaseCollectionAssignmentIfActive({
      caseId: input.caseId,
      actorProfileId: input.actorProfileId,
      reason: "payment_detected",
    })
    return { ok: true, alreadyPaid: true }
  }

  await db
    .from("collection_cases")
    .update({
      status: "paid",
      closed_at: new Date().toISOString(),
      erp_snapshot: input.snapshot ?? {},
    })
    .eq("id", input.caseId)

  await releaseCollectionAssignmentIfActive({
    caseId: input.caseId,
    actorProfileId: input.actorProfileId,
    reason: "payment_detected",
  })
  await insertCollectionCaseEvent({
    caseId: input.caseId,
    eventType: "payment_detected",
    actorProfileId: input.actorProfileId,
    oldValue: { status: current.status },
    newValue: { status: "paid" },
  })
  await appendCustomerOperationalHistory({
    clientPk: asString(current.client_pk),
    contractPk: asString(current.contract_pk),
    customerNameSnapshot: asString(current.customer_name),
    sectorCode: COLLECTION_SECTOR_CODE,
    actorProfileId: input.actorProfileId,
    eventType: "collection_payment_detected",
    result: "paid",
    metadata: { collection_case_id: input.caseId, source: "controllr_sync" },
  })
  return { ok: true, alreadyPaid: false }
}

export async function transferCollectionCase(input: {
  caseId: string
  toEmployeeId: string
  actorProfileId: string
  reason?: string | null
}): Promise<{ ok: true; assignmentId?: string } | { ok: false; message: string }> {
  const active = await findActiveAssignment({
    workType: COLLECTION_WORK_TYPE,
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
      .from("collection_cases")
      .update({ sector_assignment_id: result.assignmentId })
      .eq("id", input.caseId)
  }
  await insertCollectionCaseEvent({
    caseId: input.caseId,
    eventType: "transferred",
    actorProfileId: input.actorProfileId,
    oldValue: { assignment_id: active.id, employee_id: active.employeeId },
    newValue: { assignment_id: result.assignmentId ?? active.id, employee_id: result.employeeId },
  })
  return { ok: true, assignmentId: result.assignmentId }
}

export function summarizeCollectionDashboard(items: CollectionCaseListItem[]) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    assignedToMe: items.length,
    overdue: items.filter((item) => item.daysOverdue >= 5 && item.status !== "paid" && item.status !== "closed").length,
    promiseToPay: items.filter((item) => item.status === "promise_to_pay").length,
    paidToday: items.filter(
      (item) => item.status === "paid" && item.closedAt?.slice(0, 10) === today
    ).length,
    escalated: items.filter((item) => item.status === "escalated_retention").length,
  }
}
