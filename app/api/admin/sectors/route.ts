import { NextResponse } from "next/server"
import { jsonError } from "@/lib/collections/http"
import { authorizeEmployeeAdminRequest } from "@/lib/employees/admin-auth"
import { listSectorsWithMemberCounts } from "@/lib/employees/admin.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await authorizeEmployeeAdminRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const items = await listSectorsWithMemberCounts()
  return NextResponse.json({ ok: true, canWrite: false, items })
}
