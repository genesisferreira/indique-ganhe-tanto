import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getAuthorizedBrbyteAdmin } from "@/lib/brbyte/admin-api-auth"
import { convertBrbyteInterestFromReferral } from "@/lib/brbyte/convert-interest.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function readReferralId(request: Request): string | null {
  const url = new URL(request.url)
  return url.searchParams.get("referralId")?.trim() || null
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedBrbyteAdmin({ requireMutation: true, request })
  if ("error" in auth) return auth.error

  let referralId = readReferralId(request)
  if (!referralId) {
    try {
      const body = (await request.json()) as { referralId?: string }
      referralId = body.referralId?.trim() ?? null
    } catch {
      referralId = null
    }
  }

  if (!referralId) {
    return NextResponse.json(
      { ok: false, error: "missing_referral_id" },
      { status: 400 }
    )
  }

  const result = await convertBrbyteInterestFromReferral({
    referralId,
    actorUserId: auth.userId,
  })

  const status = result.ok ? 200 : result.skipped ? 409 : 502
  return NextResponse.json(result, { status })
}
