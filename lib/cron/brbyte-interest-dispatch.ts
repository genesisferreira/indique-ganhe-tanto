import "server-only"

import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import {
  isBrbyteAutoCreateInterestOnReferralEnabled,
  isBrbyteCreateInterestEnabled,
} from "@/lib/brbyte/config"
import { isPublicPreRegistrationReferral } from "@/lib/referral-reward-eligibility"
import {
  interestRetryDue,
  isAutomaticInterestCandidate,
  isReferralShareSource,
} from "@/lib/referral-share/controllr-origin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

const LOG_TAG = "[brbyte:interest-dispatch]"
const BATCH_SIZE = 3
const LEASE_TTL_MS = 120_000

export type AutomaticInterestDispatchResult = {
  ok: boolean
  skipped: boolean
  reason?: string
  examined: number
  processed: number
  created: number
}

type CandidateRow = {
  id: string
  source: string | null
  erp_lead_source: string | null
  brbyte_sync_status: string | null
  brbyte_sync_attempts: number | null
  brbyte_last_sync_at: string | null
  brbyte_last_endpoint: string | null
  brbyte_id_interessado: string | null
}

export async function runAutomaticInterestDispatch(): Promise<AutomaticInterestDispatchResult> {
  if (
    !isBrbyteCreateInterestEnabled() ||
    !isBrbyteAutoCreateInterestOnReferralEnabled()
  ) {
    return {
      ok: true,
      skipped: true,
      reason: "interest_flags_disabled",
      examined: 0,
      processed: 0,
      created: 0,
    }
  }

  const supabase = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        is: (col: string, val: null) => {
          in: (col2: string, vals: string[]) => {
            order: (
              col3: string,
              opts: { ascending: boolean }
            ) => {
              limit: (count: number) => Promise<{
                data: CandidateRow[] | null
                error: { message: string } | null
              }>
            }
          }
        }
      }
    }
  }

  const { data, error } = await supabase
    .from("referrals")
    .select(
      "id, source, erp_lead_source, brbyte_sync_status, brbyte_sync_attempts, brbyte_last_sync_at, brbyte_last_endpoint, brbyte_id_interessado"
    )
    .is("brbyte_id_interessado", null)
    .in("brbyte_sync_status", ["pending", "retryable_error"])
    .order("created_at", { ascending: true })
    .limit(50)

  if (error) {
    console.error(LOG_TAG, { step: "load_failed" })
    return {
      ok: false,
      skipped: false,
      reason: "load_failed",
      examined: 0,
      processed: 0,
      created: 0,
    }
  }

  const nowMs = Date.now()
  const due = (data ?? [])
    .filter((row) =>
      isAutomaticInterestCandidate({
        source: row.source,
        status: row.brbyte_sync_status,
        interestId: row.brbyte_id_interessado,
      })
    )
    .filter((row) =>
      interestRetryDue({
        attempts: row.brbyte_sync_attempts ?? 0,
        lastSyncAt: row.brbyte_last_sync_at,
        endpoint: row.brbyte_last_endpoint,
        nowMs,
        leaseTtlMs: LEASE_TTL_MS,
      })
    )
    .slice(0, BATCH_SIZE)

  let processed = 0
  let created = 0
  for (const row of due) {
    const sourceContext = isPublicPreRegistrationReferral({
      source: row.source,
      erp_lead_source: row.erp_lead_source,
    })
      ? "public_pre_registration"
      : isReferralShareSource(row.source)
        ? "referral_share"
        : "cron_retry"
    const result = await createBrbyteInterestFromReferral({
      referralId: row.id,
      actorUserId: null,
      sourceContext,
    })
    processed += 1
    if (result.ok && result.brbyteIdInteressado) created += 1
  }

  console.warn(LOG_TAG, {
    step: "batch",
    examined: data?.length ?? 0,
    processed,
    created,
  })

  return {
    ok: true,
    skipped: false,
    examined: data?.length ?? 0,
    processed,
    created,
  }
}
