import { NextResponse } from "next/server"
import { authorizeRetentionCustomerRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { getRetentionAttendance, loadAttendanceTimeline } from "@/lib/retention/attendance.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRetentionCustomerRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const { id } = await context.params
  const attendance = await getRetentionAttendance(id)
  if (!attendance) return jsonError(404, "Atendimento não encontrado.")

  if (auth.kind === "member") {
    const mine = auth.context?.employeeId ?? auth.employeeId
    if (!mine || attendance.employeeId !== mine) {
      return jsonError(403, "Atendimento iniciado por outro funcionário.")
    }
  }

  const timeline = await loadAttendanceTimeline(id)

  return NextResponse.json({
    ok: true,
    attendance,
    operationalHistory: timeline.items,
    controllrHistoryAvailable: timeline.controllrHistoryAvailable,
  })
}
