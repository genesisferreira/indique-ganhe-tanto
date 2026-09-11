import { NextResponse } from "next/server"
import { jsonError } from "@/lib/collections/http"
import { authorizeEmployeeAdminRequest } from "@/lib/employees/admin-auth"
import {
  listAdminEmployees,
  linkOrCreateEmployee,
} from "@/lib/employees/admin.service"
import { stripEmployeeAdminBrowserActor } from "@/lib/employees/admin-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await authorizeEmployeeAdminRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const url = new URL(request.url)
  const items = await listAdminEmployees({
    search: url.searchParams.get("q") ?? "",
    status: url.searchParams.get("status") ?? "",
    sectorCode: url.searchParams.get("sector") ?? "",
  })
  return NextResponse.json({ ok: true, canWrite: auth.canWrite, items })
}

export async function POST(request: Request) {
  const auth = await authorizeEmployeeAdminRequest("write")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const body = stripEmployeeAdminBrowserActor(await request.json().catch(() => null))
  const result = await linkOrCreateEmployee({
    profileId: String(body.profileId ?? body.profile_id ?? ""),
    status: body.status,
    actorProfileId: auth.profileId,
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({
    ok: true,
    employeeId: result.employeeId,
    created: result.created,
    authCreationImplemented: false,
  })
}
