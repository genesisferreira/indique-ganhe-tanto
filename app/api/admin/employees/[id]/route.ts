import { NextResponse } from "next/server"
import { jsonError } from "@/lib/collections/http"
import { authorizeEmployeeAdminRequest } from "@/lib/employees/admin-auth"
import { getAdminEmployee, updateEmployeeStatus } from "@/lib/employees/admin.service"
import { stripEmployeeAdminBrowserActor } from "@/lib/employees/admin-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeEmployeeAdminRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const { id } = await context.params
  const employee = await getAdminEmployee(id)
  if (!employee) return jsonError(404, "Funcionário não encontrado.")
  return NextResponse.json({ ok: true, canWrite: auth.canWrite, employee })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeEmployeeAdminRequest("write")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const { id } = await context.params
  const body = stripEmployeeAdminBrowserActor(await request.json().catch(() => null))
  const result = await updateEmployeeStatus({
    employeeId: id,
    status: body.status,
    notes: body.notes,
    actorProfileId: auth.profileId,
  })
  if (!result.ok) return jsonError(400, result.message)
  const employee = await getAdminEmployee(id)
  return NextResponse.json({ ok: true, employee })
}
