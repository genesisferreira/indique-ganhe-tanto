export const RETENTION_ATTENDANCE_OUTCOMES = [
  "retained",
  "not_retained",
  "callback",
  "no_decision",
  "other",
] as const

export type RetentionAttendanceOutcome = (typeof RETENTION_ATTENDANCE_OUTCOMES)[number]

export type AttendanceWriteAuth = {
  ok: boolean
  reason?: "not_owner" | "completed" | "not_found"
}

export function canCompleteRetentionAttendance(input: {
  attendanceEmployeeId: string | null | undefined
  actorEmployeeId: string | null | undefined
  isAdminMaster: boolean
  status: string | null | undefined
}): AttendanceWriteAuth {
  if (input.isAdminMaster) {
    if (input.status === "completed") return { ok: false, reason: "completed" }
    return { ok: true }
  }
  if (!input.attendanceEmployeeId || !input.actorEmployeeId) {
    return { ok: false, reason: "not_owner" }
  }
  if (input.attendanceEmployeeId !== input.actorEmployeeId) {
    return { ok: false, reason: "not_owner" }
  }
  if (input.status === "completed") return { ok: false, reason: "completed" }
  return { ok: true }
}

export function parseCustomerRemains(
  value: unknown
): { ok: true; remains: boolean } | { ok: false } {
  if (value === true || value === "true" || value === "sim" || value === "SIM") {
    return { ok: true, remains: true }
  }
  if (value === false || value === "false" || value === "nao" || value === "não" || value === "NAO" || value === "NÃO") {
    return { ok: true, remains: false }
  }
  return { ok: false }
}

export function parseRetentionOutcome(
  value: unknown
): RetentionAttendanceOutcome | null {
  const raw = String(value ?? "").trim()
  if ((RETENTION_ATTENDANCE_OUTCOMES as readonly string[]).includes(raw)) {
    return raw as RetentionAttendanceOutcome
  }
  return null
}
