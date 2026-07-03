import "server-only"

import { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { BrbyteSyncRunPhase } from "@/types/brbyte"
import type { BrbyteSyncStatus } from "@/types/referral"

export type BrbyteReferralHistoryInsert = {
  referralId: string
  phase: BrbyteSyncRunPhase | string
  oldStatus?: BrbyteSyncStatus | string | null
  newStatus?: BrbyteSyncStatus | string | null
  endpoint?: string | null
  httpStatus?: number | null
  message?: string | null
  payload?: Record<string, unknown> | null
  createdBy?: string | null
}

type HistoryDb = {
  from: (table: string) => {
    insert: (values: unknown) => Promise<{
      error: { message: string } | null
    }>
  }
}

function getDb(): HistoryDb {
  return createServiceRoleClient() as unknown as HistoryDb
}

/** Registra evento no histórico BRByte da indicação (service_role). */
export async function logBrbyteReferralHistory(
  input: BrbyteReferralHistoryInsert
): Promise<void> {
  try {
    const { error } = await getDb().from("brbyte_referral_history").insert({
      referral_id: input.referralId,
      phase: input.phase,
      old_status: input.oldStatus ?? null,
      new_status: input.newStatus ?? null,
      endpoint: input.endpoint ?? null,
      http_status: input.httpStatus ?? null,
      message: input.message ?? null,
      payload: input.payload ?? null,
      created_by: input.createdBy ?? null,
    })

    if (error) {
      console.error("[brbyte:referral-history]", {
        referralId: input.referralId,
        message: error.message,
      })
    }
  } catch (e) {
    console.error("[brbyte:referral-history]", {
      referralId: input.referralId,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
