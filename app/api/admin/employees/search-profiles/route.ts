import { NextResponse } from "next/server"
import { jsonError } from "@/lib/collections/http"
import { authorizeEmployeeAdminRequest } from "@/lib/employees/admin-auth"
import { searchProfilesForEmployee } from "@/lib/employees/admin.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await authorizeEmployeeAdminRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const url = new URL(request.url)
  const items = await searchProfilesForEmployee(url.searchParams.get("q") ?? "")
  return NextResponse.json({
    ok: true,
    items,
    authCreationImplemented: false,
    authCreationNote:
      "A criação de conta Auth não faz parte desta sprint. Vincule um usuário já existente.",
  })
}
