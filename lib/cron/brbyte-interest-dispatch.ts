import "server-only"

import {
  isBrbyteAutoCreateInterestOnReferralEnabled,
  isBrbyteCreateInterestEnabled,
} from "@/lib/brbyte/config"
import {
  loadDueInterestOperations,
  runExplicitInterestOperation,
} from "@/lib/brbyte/interest-operation"

const LOG_TAG = "[brbyte:interest-dispatch]"
const BATCH_SIZE = 3

export type AutomaticInterestDispatchResult = {
  ok: boolean
  skipped: boolean
  reason?: string
  examined: number
  processed: number
  created: number
  cursor: string | null
  leaseReleased: boolean
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
      cursor: null,
      leaseReleased: true,
    }
  }

  const due = (await loadDueInterestOperations(Date.now())).slice(0, BATCH_SIZE)
  let processed = 0
  let created = 0
  let cursor: string | null = null
  for (const row of due) {
    cursor = row.id
    const outcome = await runExplicitInterestOperation(row)
    processed += 1
    if (outcome === "created") created += 1
  }

  console.warn(LOG_TAG, {
    step: "batch",
    examined: due.length,
    processed,
    created,
  })

  return {
    ok: true,
    skipped: false,
    examined: due.length,
    processed,
    created,
    cursor,
    leaseReleased: true,
  }
}
