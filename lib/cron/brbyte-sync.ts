import "server-only"
import {
  runAutomaticInterestDispatch,
  type AutomaticInterestDispatchResult,
} from "@/lib/cron/brbyte-interest-dispatch"
import {
  runBrbyteLifecycleSync,
  type BrbyteLifecycleSyncResult,
} from "@/lib/cron/brbyte-lifecycle-sync"
import { isBrbyteAutoMarkPaidEnabled } from "@/lib/brbyte/config"

export type BrbyteSyncCronPayload = {
  ok: boolean
  source: "brbyte-sync-cron"
  executedAt: string
  result: BrbyteLifecycleSyncResult
  interestDispatch: AutomaticInterestDispatchResult
  error?: string
}

export function logCronBrbyteSyncStart(): void {
  console.log("[cron:brbyte-sync:start]", {
    autoMarkPaidEnabled: isBrbyteAutoMarkPaidEnabled(),
  })
}

export function logCronBrbyteSyncSuccess(payload: unknown): void {
  console.log("[cron:brbyte-sync:success]", payload)
}

export function logCronBrbyteSyncError(payload: unknown): void {
  console.error("[cron:brbyte-sync:error]", payload)
}

export function logCronBrbyteSyncSkip(payload: unknown): void {
  console.log("[cron:brbyte-sync:skip]", payload)
}

/**
 * Criação automática de interessado, independente de BRBYTE_SYNC_ENABLED.
 * O acompanhamento de conversão e fatura continua no lifecycle.
 */
export async function runBrbyteSyncCron(): Promise<BrbyteSyncCronPayload> {
  const executedAt = new Date().toISOString()

  try {
    const interestDispatch = await runAutomaticInterestDispatch()
    const result = await runBrbyteLifecycleSync()

    if (result.skipped) {
      logCronBrbyteSyncSkip({ executedAt, result, interestDispatch })
      return {
        ok: interestDispatch.ok,
        source: "brbyte-sync-cron",
        executedAt,
        result,
        interestDispatch,
      }
    }

    if (!result.ok) {
      logCronBrbyteSyncError({ executedAt, result, interestDispatch })
      return {
        ok: false,
        source: "brbyte-sync-cron",
        executedAt,
        result,
        interestDispatch,
        error: result.message ?? result.reason ?? "sync_failed",
      }
    }

    logCronBrbyteSyncSuccess({ executedAt, result, interestDispatch })
    return {
      ok: true,
      source: "brbyte-sync-cron",
      executedAt,
      result,
      interestDispatch,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logCronBrbyteSyncError({ executedAt, message })
    throw e
  }
}
