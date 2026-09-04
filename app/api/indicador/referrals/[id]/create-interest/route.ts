import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import {
  isBrbyteAutoCreateInterestOnReferralEnabled,
  isBrbyteCreateInterestEnabled,
} from "@/lib/brbyte/config"
import {
  getIndicatorBrbyteStatusMessage,
  INDICATOR_REFERRAL_SAVED_MESSAGE,
} from "@/lib/brbyte/indicator-status-messages"
import { assertPasswordChangeCompleted } from "@/lib/auth/password-change-gate"
import { createClient } from "@/lib/supabase/server"
import { isPublicPreRegistrationReferral } from "@/lib/referral-reward-eligibility"
import type { UserRole } from "@/types/user"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id: referralIdRaw } = await context.params
  const referralId = referralIdRaw?.trim()
  if (!referralId) {
    return NextResponse.json(
      { ok: false, message: INDICATOR_REFERRAL_SAVED_MESSAGE },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, message: "Sessão não encontrada. Faça login novamente." },
      { status: 401 }
    )
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .maybeSingle()

  const profileRow = profile as {
    role?: string
    must_change_password?: boolean | null
  } | null

  const role = (profileRow?.role ?? null) as UserRole | null

  const isAdmin =
    role === "admin_master" || role === "admin_financeiro"
  const isIndicador = role === "indicador"

  if (!isAdmin && !isIndicador) {
    return NextResponse.json(
      { ok: false, message: INDICATOR_REFERRAL_SAVED_MESSAGE },
      { status: 403 }
    )
  }

  // Gate P1-2: indicador com senha temporária não opera APIs de negócio.
  // Admin continua autorizado (sem regressão).
  if (isIndicador && !isAdmin) {
    const gate = assertPasswordChangeCompleted(profileRow)
    if (gate) {
      return NextResponse.json(
        {
          ok: false,
          code: gate.code,
          message: gate.message,
        },
        { status: gate.status }
      )
    }
  }

  const { data: referral, error: referralError } = await supabase
    .from("referrals")
    .select(
      "id, indicator_profile_id, source, erp_lead_source, brbyte_sync_status"
    )
    .eq("id", referralId)
    .maybeSingle()

  if (referralError || !referral) {
    return NextResponse.json(
      { ok: false, message: INDICATOR_REFERRAL_SAVED_MESSAGE },
      { status: 404 }
    )
  }

  const referralRow = referral as {
    id: string
    indicator_profile_id: string | null
    source: string | null
    erp_lead_source: string | null
    brbyte_sync_status: string | null
  }

  if (
    isPublicPreRegistrationReferral({
      source: referralRow.source,
      erp_lead_source: referralRow.erp_lead_source,
    })
  ) {
    return NextResponse.json(
      { ok: false, message: INDICATOR_REFERRAL_SAVED_MESSAGE },
      { status: 409 }
    )
  }

  if (
    isIndicador &&
    referralRow.indicator_profile_id !== user.id
  ) {
    return NextResponse.json(
      { ok: false, message: INDICATOR_REFERRAL_SAVED_MESSAGE },
      { status: 403 }
    )
  }

  if (!isBrbyteCreateInterestEnabled() || !isBrbyteAutoCreateInterestOnReferralEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "disabled",
      message: INDICATOR_REFERRAL_SAVED_MESSAGE,
    })
  }

  const result = await createBrbyteInterestFromReferral({
    referralId,
    actorUserId: user.id,
    sourceContext: "indicator_referral",
  })

  return NextResponse.json({
    ok: result.ok,
    skipped: result.skipped ?? false,
    reason: result.reason,
    message: result.ok
      ? getIndicatorBrbyteStatusMessage("created")
      : result.message || INDICATOR_REFERRAL_SAVED_MESSAGE,
  })
}
