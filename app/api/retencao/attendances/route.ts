import { NextResponse } from "next/server"
import { authorizeRetentionCustomerRequest } from "@/lib/collections/actor"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import {
  listMyRetentionAttendances,
  startRetentionAttendance,
} from "@/lib/retention/attendance.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await authorizeRetentionCustomerRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const items = await listMyRetentionAttendances(auth.context?.employeeId ?? auth.employeeId)
  return NextResponse.json({ ok: true, items })
}

export async function POST(request: Request) {
  const auth = await authorizeRetentionCustomerRequest("write")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const employeeId = auth.context?.employeeId ?? auth.employeeId
  if (!employeeId) return jsonError(403, "Employee ativo é necessário para iniciar atendimento.")
  const body = stripBrowserActor(await request.json().catch(() => null))
  delete body.source
  delete body.sector_code
  delete body.sectorCode
  const result = await startRetentionAttendance({
    rawDocument: String(body.document ?? ""),
    actorProfileId: auth.profileId,
    employeeId,
    clientPk: typeof body.clientPk === "string" ? body.clientPk : null,
    contractPk: typeof body.contractPk === "string" ? body.contractPk : null,
    customerName: typeof body.customerName === "string" ? body.customerName : null,
    reason: typeof body.reason === "string" ? body.reason : null,
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true, attendance: result.attendance })
}
