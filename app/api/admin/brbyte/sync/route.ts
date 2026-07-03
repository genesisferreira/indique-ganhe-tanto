import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getAuthorizedBrbyteAdmin } from "@/lib/brbyte/admin-api-auth"
import { isBrbyteSyncEnabled } from "@/lib/brbyte/config"
import { runBrbyteSyncCron } from "@/lib/cron/brbyte-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedBrbyteAdmin({ requireMutation: true, request })
  if ("error" in auth) return auth.error

  if (!isBrbyteSyncEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        skipped: true,
        message:
          "Sincronização automática desativada. Ative BRBYTE_SYNC_ENABLED para executar.",
        executedAt: new Date().toISOString(),
      },
      { status: 409 }
    )
  }

  try {
    const payload = await runBrbyteSyncCron()
    const status = payload.ok ? 200 : 502
    return NextResponse.json(payload, { status })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      {
        ok: false,
        source: "brbyte-sync-admin",
        error: message,
        executedAt: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
