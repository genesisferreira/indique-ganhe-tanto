import "server-only"

import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

const LOG_TAG = "[referral-share:controllr]"

export async function dispatchReferralShareControllrInterest(
  idempotencyKey: string
): Promise<void> {
  const key = idempotencyKey.trim()
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) return
  try {
    const supabase = createServiceRoleClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{
              data: { opportunity_id?: string | null } | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
    const { data, error } = await supabase
      .from("referral_share_submissions")
      .select("opportunity_id")
      .eq("idempotency_key", key)
      .maybeSingle()
    const referralId = data?.opportunity_id?.trim() ?? ""
    if (error || !referralId) {
      console.warn(LOG_TAG, { step: "missing_referral" })
      return
    }
    const result = await createBrbyteInterestFromReferral({
      referralId,
      actorUserId: null,
      sourceContext: "referral_share",
    })
    console.warn(LOG_TAG, {
      step: "dispatched",
      ok: result.ok,
      skipped: result.skipped === true,
      reason: result.reason ?? null,
    })
  } catch {
    console.warn(LOG_TAG, { step: "dispatch_failed" })
  }
}
