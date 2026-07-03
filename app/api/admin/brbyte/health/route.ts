import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getAuthorizedBrbyteAdmin } from "@/lib/brbyte/admin-api-auth"
import { runBrbyteHealthCheck } from "@/lib/brbyte/health"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedBrbyteAdmin({ requireMutation: true, request })
  if ("error" in auth) return auth.error

  const result = await runBrbyteHealthCheck()
  const status = result.ok ? 200 : 502
  return NextResponse.json(result, { status })
}
