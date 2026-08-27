import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getAuthorizedBrbyteAdmin } from "@/lib/brbyte/admin-api-auth"
import {
  buildEmptyPublicPreRegistrationMetrics,
  loadCaptacaoPublicMetricsBySource,
} from "@/lib/public-pre-registration/dashboard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedBrbyteAdmin({ request })
  if ("error" in auth) return auth.error

  try {
    const bySource = await loadCaptacaoPublicMetricsBySource()
    return NextResponse.json({
      ok: true,
      // Compat com admin atual: métricas do pré-cadastro web.
      metrics: bySource.preRegistration,
      bySource: {
        public_pre_registration: bySource.preRegistration,
        neutral_network_pre_registration: bySource.neutralNetwork,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[api:admin:public-pre-registration:metrics] error", {
      message,
    })
    const empty = buildEmptyPublicPreRegistrationMetrics()
    return NextResponse.json(
      {
        ok: false,
        error: message,
        metrics: empty,
        bySource: {
          public_pre_registration: empty,
          neutral_network_pre_registration: empty,
        },
      },
      { status: 500 }
    )
  }
}
