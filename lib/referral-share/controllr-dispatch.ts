import "server-only"

import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

const LOG_TAG = "[referral-share:controllr]"

/**
 * A chamada é aguardada dentro da requisição, depois que a indicação já foi
 * confirmada. O cliente HTTP do ERP encerra por timeout; não há promise
 * deixada para depois da resposta.
 */
export async function dispatchReferralShareControllrInterest(
  idempotencyKey: string
): Promise<void> {
  const key = idempotencyKey.trim()
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) return
  let referralId = ""
  try {
    const supabase = createServiceRoleClient() as unknown as {
      rpc: (
        fn: string,
        args: { p_key: string }
      ) => Promise<{ data: string | null; error: { message: string } | null }>
    }
    const { data, error } = await supabase.rpc(
      "referral_share_referral_id_for_dispatch",
      { p_key: key }
    )
    referralId = typeof data === "string" ? data.trim() : ""
    if (error || !referralId) {
      console.warn(LOG_TAG, { step: error ? "lookup_failed" : "missing_referral" })
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
    if (referralId) await markInterestRetryable(referralId)
  }
}

async function markInterestRetryable(referralId: string): Promise<void> {
  try {
    const supabase = createServiceRoleClient() as unknown as {
      from: (table: string) => {
        update: (values: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            is: (
              col2: string,
              val2: null
            ) => Promise<{ error: { message: string } | null }>
          }
        }
      }
    }
    await supabase
      .from("referrals")
      .update({
        brbyte_sync_status: "retryable_error",
        brbyte_sync_error: "Falha no envio ao Controllr. A indicação permanece no CRM.",
        brbyte_last_error_at: new Date().toISOString(),
        brbyte_last_endpoint: null,
      })
      .eq("id", referralId)
      .is("brbyte_id_interessado", null)
  } catch {
    console.warn(LOG_TAG, { step: "retry_mark_failed" })
  }
}
