import "server-only"

import { asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import { sanitizeContactNotes, sanitizeCustomerName } from "@/lib/collections/sanitize"
import { maskOperationalDocument, parseOperationalDocument } from "@/lib/operational/document"
import {
  appendCustomerOperationalHistory,
  loadMergedCustomerTimeline,
} from "@/lib/operational/history.service"
import { RETENTION_SECTOR_CODE, type OperationalAttendance } from "@/types/collections"
import {
  canCompleteRetentionAttendance,
  parseCustomerRemains,
  parseRetentionOutcome,
} from "@/lib/retention/attendance-policy"

function mapAttendance(row: Record<string, unknown>): OperationalAttendance {
  return {
    id: String(row.id),
    sectorCode: String(row.sector_code),
    clientPk: asString(row.client_pk),
    contractPk: asString(row.contract_pk),
    documentMasked: maskOperationalDocument(asString(row.document_normalized)),
    customerNameSnapshot: asString(row.customer_name_snapshot),
    employeeId: String(row.employee_id),
    actorProfileId: String(row.actor_profile_id),
    reason: asString(row.reason),
    actionTaken: asString(row.action_taken),
    notes: asString(row.notes),
    customerRemains: typeof row.customer_remains === "boolean" ? row.customer_remains : null,
    outcome: asString(row.outcome),
    status: row.status === "completed" ? "completed" : "open",
    startedAt: String(row.started_at),
    completedAt: asString(row.completed_at),
  }
}

const SELECT_COLS =
  "id, sector_code, client_pk, contract_pk, document_normalized, customer_name_snapshot, employee_id, actor_profile_id, reason, action_taken, notes, customer_remains, outcome, status, started_at, completed_at"

export async function listMyRetentionAttendances(employeeId: string | null) {
  if (!employeeId) return []
  const db = getOpsDb()
  const { data } = await awaitQuery<Record<string, unknown>>(
    db
      .from("operational_attendances")
      .select(SELECT_COLS)
      .eq("sector_code", RETENTION_SECTOR_CODE)
      .eq("employee_id", employeeId)
      .order("started_at", { ascending: false })
      .limit(50)
  )
  return (data ?? []).map((row) => mapAttendance(row))
}

export async function getRetentionAttendance(id: string): Promise<OperationalAttendance | null> {
  const db = getOpsDb()
  const { data } = await db
    .from("operational_attendances")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle()
  if (!data?.id) return null
  return mapAttendance(data as Record<string, unknown>)
}

export async function loadAttendanceTimeline(attendanceId: string) {
  const db = getOpsDb()
  const { data } = await db
    .from("operational_attendances")
    .select("document_normalized, client_pk, contract_pk")
    .eq("id", attendanceId)
    .maybeSingle()
  return loadMergedCustomerTimeline({
    documentDigits: asString(data?.document_normalized),
    clientPk: asString(data?.client_pk),
    contractPk: asString(data?.contract_pk),
  })
}

export async function startRetentionAttendance(input: {
  rawDocument: string
  actorProfileId: string
  employeeId: string
  clientPk?: string | null
  contractPk?: string | null
  customerName?: string | null
  reason?: string | null
}): Promise<{ ok: true; attendance: OperationalAttendance } | { ok: false; message: string }> {
  const parsed = parseOperationalDocument(input.rawDocument)
  if (!parsed.ok) return { ok: false, message: "Informe um CPF ou CNPJ válido." }
  if (!input.employeeId) return { ok: false, message: "Employee ausente." }

  const db = getOpsDb()
  const { data: existing } = await db
    .from("operational_attendances")
    .select(SELECT_COLS)
    .eq("sector_code", RETENTION_SECTOR_CODE)
    .eq("document_normalized", parsed.document.digits)
    .eq("employee_id", input.employeeId)
    .eq("status", "open")
    .maybeSingle()

  if (existing?.id) {
    return { ok: true, attendance: mapAttendance(existing as Record<string, unknown>) }
  }

  const name = sanitizeCustomerName(input.customerName)
  const { data, error } = await db
    .from("operational_attendances")
    .insert({
      sector_code: RETENTION_SECTOR_CODE,
      client_pk: input.clientPk?.trim() || null,
      contract_pk: input.contractPk?.trim() || null,
      document_normalized: parsed.document.digits,
      customer_name_snapshot: name,
      employee_id: input.employeeId,
      actor_profile_id: input.actorProfileId,
      reason: sanitizeContactNotes(input.reason),
      status: "open",
    })
    .select(SELECT_COLS)
    .maybeSingle()

  if (error || !data?.id) {
    return { ok: false, message: error?.message ?? "Não foi possível iniciar o atendimento." }
  }

  await appendCustomerOperationalHistory({
    clientPk: input.clientPk,
    contractPk: input.contractPk,
    documentReference: parsed.document.digits,
    customerNameSnapshot: name,
    sectorCode: RETENTION_SECTOR_CODE,
    employeeId: input.employeeId,
    actorProfileId: input.actorProfileId,
    eventType: "retention_attendance_started",
    action: "start_attendance",
    notes: sanitizeContactNotes(input.reason),
    metadata: { attendance_id: data.id },
  })

  return { ok: true, attendance: mapAttendance(data as Record<string, unknown>) }
}

export async function completeRetentionAttendance(input: {
  attendanceId: string
  actorProfileId: string
  employeeId: string | null
  isAdminMaster: boolean
  actionTaken?: unknown
  notes?: unknown
  customerRemains?: unknown
  outcome?: unknown
}): Promise<{ ok: true; attendance: OperationalAttendance } | { ok: false; status: 400 | 403; message: string }> {
  const current = await getRetentionAttendance(input.attendanceId)
  if (!current) return { ok: false, status: 400, message: "Atendimento não encontrado." }

  const auth = canCompleteRetentionAttendance({
    attendanceEmployeeId: current.employeeId,
    actorEmployeeId: input.employeeId,
    isAdminMaster: input.isAdminMaster,
    status: current.status,
  })
  if (!auth.ok) {
    if (auth.reason === "not_owner") {
      return { ok: false, status: 403, message: "Atendimento iniciado por outro funcionário." }
    }
    return { ok: false, status: 400, message: "Atendimento já concluído." }
  }

  const remains = parseCustomerRemains(input.customerRemains)
  if (!remains.ok) {
    return { ok: false, status: 400, message: "Informe se o cliente permanecerá (sim ou não)." }
  }
  const actionTaken = sanitizeContactNotes(typeof input.actionTaken === "string" ? input.actionTaken : null)
  if (!actionTaken) {
    return { ok: false, status: 400, message: "Descreva o que foi feito no atendimento." }
  }
  const notes = sanitizeContactNotes(typeof input.notes === "string" ? input.notes : null)
  const outcome = parseRetentionOutcome(input.outcome) ?? (remains.remains ? "retained" : "not_retained")

  const db = getOpsDb()
  const { error } = await db
    .from("operational_attendances")
    .update({
      action_taken: actionTaken,
      notes,
      customer_remains: remains.remains,
      outcome,
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.attendanceId)

  if (error) {
    return { ok: false, status: 400, message: error.message }
  }

  const data = await getRetentionAttendance(input.attendanceId)
  if (!data) {
    return { ok: false, status: 400, message: "Não foi possível concluir." }
  }

  const { data: raw } = await db
    .from("operational_attendances")
    .select("document_normalized")
    .eq("id", input.attendanceId)
    .maybeSingle()

  await appendCustomerOperationalHistory({
    clientPk: current.clientPk,
    contractPk: current.contractPk,
    documentReference: asString(raw?.document_normalized),
    customerNameSnapshot: current.customerNameSnapshot,
    sectorCode: RETENTION_SECTOR_CODE,
    employeeId: current.employeeId,
    actorProfileId: input.actorProfileId,
    eventType: "retention_attendance_completed",
    action: actionTaken,
    result: remains.remains ? "customer_remains" : "customer_left",
    notes,
    customerRemains: remains.remains,
    metadata: { attendance_id: input.attendanceId, outcome },
  })

  return { ok: true, attendance: data }
}
