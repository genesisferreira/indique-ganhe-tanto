import { NextResponse } from "next/server"
import { jsonError } from "@/lib/collections/http"
import { authorizeEmployeeAdminRequest } from "@/lib/employees/admin-auth"
import { getAdminEmployee, updateEmployeeHrFields, updateEmployeeStatus } from "@/lib/employees/admin.service"
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
  if (
    body.jobTitle !== undefined ||
    body.job_title !== undefined ||
    body.birthDate !== undefined ||
    body.birth_date !== undefined ||
    body.managerEmployeeId !== undefined ||
    body.manager_employee_id !== undefined
  ) {
    const hr = await updateEmployeeHrFields({
      employeeId: id,
      jobTitle: body.jobTitle ?? body.job_title,
      birthDate: body.birthDate ?? body.birth_date,
      managerEmployeeId: body.managerEmployeeId ?? body.manager_employee_id,
      actorProfileId: auth.profileId,
    })
    if (!hr.ok) return jsonError(400, hr.message)
  }
  const employee = await getAdminEmployee(id)
  return NextResponse.json({ ok: true, employee })
}
