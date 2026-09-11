import { NextResponse } from "next/server"
import { authorizeRetentionCustomerRequest } from "@/lib/collections/actor"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import { completeRetentionAttendance } from "@/lib/retention/attendance.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRetentionCustomerRequest("write")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const { id } = await context.params
  const body = stripBrowserActor(await request.json().catch(() => null))
  delete body.source
  delete body.sector_code
  delete body.sectorCode
  delete body.employee_id
  delete body.employeeId
  const result = await completeRetentionAttendance({
    attendanceId: id,
    actorProfileId: auth.profileId,
    employeeId: auth.context?.employeeId ?? auth.employeeId,
    isAdminMaster: auth.kind === "admin_master",
    actionTaken: body.actionTaken ?? body.action_taken,
    notes: body.notes,
    customerRemains: body.customerRemains ?? body.customer_remains,
    outcome: body.outcome,
  })
  if (!result.ok) return jsonError(result.status, result.message)
  return NextResponse.json({ ok: true, attendance: result.attendance })
}
