import { NextResponse } from "next/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { isPublicPreRegistrationEnabled } from "@/lib/public-pre-registration/config"
import { loadPublicPreRegistrationPlans } from "@/lib/public-pre-registration/plans"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  if (!isPublicPreRegistrationEnabled()) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, plans: [] }, { status: 404 })
    )
  }

  const plans = await loadPublicPreRegistrationPlans()
  return applyNoStoreHeaders(
    NextResponse.json({
      ok: true,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        speedLabel: p.speedLabel,
      })),
    })
  )
}
