import "server-only"
import {
  BRBYTE_AUTO_MARK_PAID_ENABLED,
  runBrbyteSync,
  type BrbyteSyncResult,
} from "@/lib/cron/brbyte.service"

export type BrbyteSyncCronPayload = {
  ok: boolean
  source: "brbyte-sync-cron"
  executedAt: string
  result: BrbyteSyncResult
  error?: string
}

export function logCronBrbyteSyncStart(): void {
  console.log("[cron:brbyte-sync:start]", {
    autoMarkPaidEnabled: BRBYTE_AUTO_MARK_PAID_ENABLED,
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
 * Job cron: sincronização automática com BRByte API.
 */
export async function runBrbyteSyncCron(): Promise<BrbyteSyncCronPayload> {
  const executedAt = new Date().toISOString()

  try {
    const result = await runBrbyteSync()

    if (result.skipped && result.reason === "disabled") {
      logCronBrbyteSyncSkip({ executedAt, result })
      return {
        ok: true,
        source: "brbyte-sync-cron",
        executedAt,
        result,
      }
    }

    if (!result.ok) {
      logCronBrbyteSyncError({ executedAt, result })
      return {
        ok: false,
        source: "brbyte-sync-cron",
        executedAt,
        result,
        error: result.message ?? result.reason ?? "sync_failed",
      }
    }

    logCronBrbyteSyncSuccess({ executedAt, result })
    return {
      ok: true,
      source: "brbyte-sync-cron",
      executedAt,
      result,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logCronBrbyteSyncError({ executedAt, message })
    throw e
  }
}
