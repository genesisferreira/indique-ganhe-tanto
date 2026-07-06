import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getAuthorizedBrbyteAdmin } from "@/lib/brbyte/admin-api-auth"
import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import {
  getBrbyteCreateInterestConfig,
  isBrbyteCreateInterestEnabled,
} from "@/lib/brbyte/config"
import { createClient } from "@/lib/supabase/server"
import { normalizeBrbyteSyncStatus } from "@/types/referral"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function readReferralId(request: Request): string | null {
  const url = new URL(request.url)
  return url.searchParams.get("referralId")?.trim() || null
}

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedBrbyteAdmin({ requireMutation: true, request })
  if ("error" in auth) return auth.error

  const referralId = readReferralId(request)
  if (!referralId) {
    return NextResponse.json(
      { ok: false, error: "missing_referral_id" },
      { status: 400 }
    )
  }

  const enabled = isBrbyteCreateInterestEnabled()
  const configured = getBrbyteCreateInterestConfig() !== null

  const supabase = await createClient()
  const { data: row } = await supabase
    .from("referrals")
    .select(
      `
      brbyte_id_interessado,
      brbyte_interessado_status,
      brbyte_interessado_last_sync_at,
      brbyte_sync_status,
      brbyte_sync_error,
      brbyte_sync_attempts,
      brbyte_last_error_at,
      brbyte_last_http_status,
      brbyte_last_endpoint,
      brbyte_last_sync_at,
      brbyte_client_pk,
      brbyte_client_synced_at,
      brbyte_contract_pk,
      brbyte_first_invoice_pk,
      brbyte_first_invoice_paid_at,
      first_invoice_paid
    `
    )
    .eq("id", referralId)
    .maybeSingle()

  const referralRow = row as {
    brbyte_id_interessado?: string | null
    brbyte_interessado_status?: string | null
    brbyte_interessado_last_sync_at?: string | null
    brbyte_sync_status?: string | null
    brbyte_sync_error?: string | null
    brbyte_sync_attempts?: number | null
    brbyte_last_error_at?: string | null
    brbyte_last_http_status?: number | null
    brbyte_last_endpoint?: string | null
    brbyte_last_sync_at?: string | null
    brbyte_client_pk?: string | null
    brbyte_client_synced_at?: string | null
    brbyte_contract_pk?: string | null
    brbyte_first_invoice_pk?: string | null
    brbyte_first_invoice_paid_at?: string | null
    first_invoice_paid?: boolean | null
  } | null

  return NextResponse.json({
    ok: true,
    enabled,
    configured,
    referralId,
    brbyteIdInteressado: referralRow?.brbyte_id_interessado ?? null,
    brbyteInteressadoStatus: referralRow?.brbyte_interessado_status ?? null,
    brbyteInteressadoLastSyncAt:
      referralRow?.brbyte_interessado_last_sync_at ??
      referralRow?.brbyte_last_sync_at ??
      null,
    brbyteClientPk: referralRow?.brbyte_client_pk ?? null,
    brbyteClientSyncedAt: referralRow?.brbyte_client_synced_at ?? null,
    brbyteContractPk: referralRow?.brbyte_contract_pk ?? null,
    brbyteFirstInvoicePk: referralRow?.brbyte_first_invoice_pk ?? null,
    brbyteFirstInvoicePaidAt: referralRow?.brbyte_first_invoice_paid_at ?? null,
    firstInvoicePaid: Boolean(referralRow?.first_invoice_paid),
    brbyteSyncStatus: normalizeBrbyteSyncStatus(referralRow?.brbyte_sync_status),
    brbyteSyncError: referralRow?.brbyte_sync_error ?? null,
    brbyteSyncAttempts:
      typeof referralRow?.brbyte_sync_attempts === "number"
        ? referralRow.brbyte_sync_attempts
        : 0,
    brbyteLastErrorAt: referralRow?.brbyte_last_error_at ?? null,
    brbyteLastHttpStatus: referralRow?.brbyte_last_http_status ?? null,
    brbyteLastEndpoint: referralRow?.brbyte_last_endpoint ?? null,
  })
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

  const result = await createBrbyteInterestFromReferral({
    referralId,
    actorUserId: auth.userId,
  })

  const status = result.ok ? 200 : result.skipped ? 409 : 502
  return NextResponse.json(result, { status })
}
