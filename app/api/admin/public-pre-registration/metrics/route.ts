import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getAuthorizedBrbyteAdmin } from "@/lib/brbyte/admin-api-auth"
import {
  buildEmptyPublicPreRegistrationMetrics,
  loadPublicPreRegistrationMetrics,
} from "@/lib/public-pre-registration/dashboard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedBrbyteAdmin({ request })
  if ("error" in auth) return auth.error

  try {
    const metrics = await loadPublicPreRegistrationMetrics()
    return NextResponse.json({ ok: true, metrics })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[api:admin:public-pre-registration:metrics] error", {
      message,
    })
    return NextResponse.json(
      {
        ok: false,
        error: message,
        metrics: buildEmptyPublicPreRegistrationMetrics(),
      },
      { status: 500 }
    )
  }
}
