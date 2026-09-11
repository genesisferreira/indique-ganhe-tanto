import { NextResponse } from "next/server"
import { jsonError } from "@/lib/collections/http"
import { authorizeEmployeeAdminRequest } from "@/lib/employees/admin-auth"
import { getAdminEmployee, setEmployeeSectorMembership } from "@/lib/employees/admin.service"
import { stripEmployeeAdminBrowserActor } from "@/lib/employees/admin-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeEmployeeAdminRequest("write")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const { id } = await context.params
  const body = stripEmployeeAdminBrowserActor(await request.json().catch(() => null))
  const sectorCode = String(body.sectorCode ?? body.code ?? "").trim()
  const active = body.active !== false && body.isActive !== false
  const result = await setEmployeeSectorMembership({
    employeeId: id,
    sectorCode,
    active,
    actorProfileId: auth.profileId,
  })
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: result.message,
        activeAssignments: result.activeAssignments ?? 0,
      },
      { status: result.status }
    )
  }
  const employee = await getAdminEmployee(id)
  return NextResponse.json({
    ok: true,
    employee,
    commercialWarning: result.commercialWarning ?? null,
  })
}
