import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getAuthorizedBrbyteAdmin } from "@/lib/brbyte/admin-api-auth"
import {
  buildEmptyBrbyteIntegrationDashboard,
  loadBrbyteIntegrationDashboard,
} from "@/lib/brbyte/integration-dashboard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  console.log("[api:admin:brbyte:dashboard] request")
  const auth = await getAuthorizedBrbyteAdmin({ request })
  if ("error" in auth) return auth.error

  try {
    const dashboard = await loadBrbyteIntegrationDashboard()
    console.log("[api:admin:brbyte:dashboard] success", {
      hasLastSyncRun: Boolean(dashboard.lastSyncRun),
      hasLastError: Boolean(dashboard.lastError),
      apiUrlConfigured: dashboard.flags.apiUrlConfigured,
    })
    return NextResponse.json({ ok: true, dashboard })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[api:admin:brbyte:dashboard] error", { message })
    return NextResponse.json(
      {
        ok: false,
        error: message,
        dashboard: buildEmptyBrbyteIntegrationDashboard(),
      },
      { status: 500 }
    )
  }
}
