import "server-only"

import { checkBrbyteInterestConversionFromReferral } from "@/lib/brbyte/check-conversion.service"
import { checkBrbyteFirstInvoiceFromReferral } from "@/lib/brbyte/check-first-invoice.service"
import {
  getBrbyteSyncBatchSize,
  getBrbyteSyncMaxAttempts,
  getBrbyteSyncRetryMinutes,
  isBrbyteAutoCheckConversionEnabled,
  isBrbyteAutoCheckFirstInvoiceEnabled,
  isBrbyteSyncEnabled,
} from "@/lib/brbyte/config"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { BrbyteSyncStatus } from "@/types/referral"

const LOG_TAG = "[brbyte:lifecycle-sync]"

export type BrbyteLifecycleSyncResult = {
  ok: boolean
  skipped: boolean
  reason?: string
  durationMs: number
  syncRunId: string | null
  verified: number
  success: number
  errors: number
  ignored: number
  message?: string
}

type LifecycleReferralRow = {
  id: string
  brbyte_sync_status: string | null
  brbyte_sync_attempts: number | null
  brbyte_last_sync_at: string | null
  brbyte_last_error_at: string | null
  first_invoice_paid: boolean | null
  reward_eligible: boolean | null
  source: string | null
}

function isRetryReady(row: LifecycleReferralRow, retryMinutes: number): boolean {
  const attempts =
    typeof row.brbyte_sync_attempts === "number" ? row.brbyte_sync_attempts : 0
  if (attempts >= getBrbyteSyncMaxAttempts()) return false

  const anchor = row.brbyte_last_error_at || row.brbyte_last_sync_at
  if (!anchor) return true
  const ts = Date.parse(anchor)
  if (!Number.isFinite(ts)) return true
  return Date.now() - ts >= retryMinutes * 60_000
}

async function hasRunningLifecycleJob(): Promise<boolean> {
  const supabase = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col2: string, val2: string) => {
            gte: (col3: string, val3: string) => {
              limit: (n: number) => Promise<{
                data: { id: string }[] | null
                error: { message: string } | null
              }>
            }
          }
        }
      }
    }
  }

  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data, error } = await supabase
    .from("brbyte_sync_runs")
    .select("id")
    .eq("status", "running")
    .eq("phase", "check_conversion")
    .gte("started_at", cutoff)
    .limit(1)

  if (error) {
    console.warn(LOG_TAG, { step: "concurrent_check", message: error.message })
    return false
  }
  return Boolean(data && data.length > 0)
}

async function createLifecycleRun(): Promise<string | null> {
  const supabase = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      insert: (values: unknown) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null
            error: { message: string } | null
          }>
        }
      }
    }
  }

  const { data, error } = await supabase
    .from("brbyte_sync_runs")
    .insert({
      status: "running",
      configured: true,
      phase: "check_conversion",
      meta: {
        phase: "lifecycle_sync",
        triggered_by: "cron_automatic",
      },
    })
    .select("id")
    .single()

  if (error) {
    console.error(LOG_TAG, { step: "create_run", message: error.message })
    return null
  }
  return data?.id ?? null
}

async function finishLifecycleRun(
  runId: string | null,
  patch: Record<string, unknown>
): Promise<void> {
  if (!runId) return
  const supabase = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      update: (values: unknown) => {
        eq: (
          col: string,
          val: string
        ) => Promise<{ error: { message: string } | null }>
      }
    }
  }
  await supabase
    .from("brbyte_sync_runs")
    .update({
      ...patch,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
}

async function loadEligibleReferrals(
  statuses: BrbyteSyncStatus[],
  limit: number
): Promise<LifecycleReferralRow[]> {
  const supabase = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => {
          eq: (col: string, val: boolean) => {
            order: (
              col: string,
              opts: { ascending: boolean }
            ) => {
              limit: (n: number) => Promise<{
                data: LifecycleReferralRow[] | null
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
      "id, brbyte_sync_status, brbyte_sync_attempts, brbyte_last_sync_at, brbyte_last_error_at, first_invoice_paid, reward_eligible, source"
    )
    .in("brbyte_sync_status", statuses)
    .eq("first_invoice_paid", false)
    .order("updated_at", { ascending: true })
    .limit(limit)

  if (error) {
    console.error(LOG_TAG, { step: "load_referrals", message: error.message })
    return []
  }
  return data ?? []
}

/**
 * Cron de acompanhamento: conversão + contrato/primeira fatura.
 * Não cria Interessado e não converte no ERP.
 */
export async function runBrbyteLifecycleSync(): Promise<BrbyteLifecycleSyncResult> {
  const started = Date.now()

  if (!isBrbyteSyncEnabled()) {
    return {
      ok: true,
      skipped: true,
      reason: "disabled",
      durationMs: Date.now() - started,
      syncRunId: null,
      verified: 0,
      success: 0,
      errors: 0,
      ignored: 0,
      message: "BRBYTE_SYNC_ENABLED=false",
    }
  }

  const autoConversion = isBrbyteAutoCheckConversionEnabled()
  const autoInvoice = isBrbyteAutoCheckFirstInvoiceEnabled()

  if (!autoConversion && !autoInvoice) {
    return {
      ok: true,
      skipped: true,
      reason: "auto_flags_disabled",
      durationMs: Date.now() - started,
      syncRunId: null,
      verified: 0,
      success: 0,
      errors: 0,
      ignored: 0,
      message:
        "Nenhuma flag automática de acompanhamento ativa (conversion/first_invoice).",
    }
  }

  if (await hasRunningLifecycleJob()) {
    return {
      ok: true,
      skipped: true,
      reason: "concurrent_run",
      durationMs: Date.now() - started,
      syncRunId: null,
      verified: 0,
      success: 0,
      errors: 0,
      ignored: 0,
      message: "Já existe execução de sync em andamento.",
    }
  }

  const syncRunId = await createLifecycleRun()
  const batchSize = getBrbyteSyncBatchSize()
  const retryMinutes = getBrbyteSyncRetryMinutes()
  const maxAttempts = getBrbyteSyncMaxAttempts()

  const statuses: BrbyteSyncStatus[] = []
  if (autoConversion) statuses.push("created")
  if (autoInvoice) {
    statuses.push("converted", "waiting_contract", "waiting_invoice")
  }

  const referrals = await loadEligibleReferrals(statuses, batchSize)
  let success = 0
  let errors = 0
  let ignored = 0

  console.log(LOG_TAG, {
    step: "start",
    syncRunId,
    batchSize,
    maxAttempts,
    retryMinutes,
    candidates: referrals.length,
    autoConversion,
    autoInvoice,
  })

  for (const row of referrals) {
    const status = (row.brbyte_sync_status ?? "pending") as BrbyteSyncStatus
    const attempts =
      typeof row.brbyte_sync_attempts === "number" ? row.brbyte_sync_attempts : 0

    if (status === "paid_confirmed" || status === "completed") {
      ignored += 1
      continue
    }

    if (attempts >= maxAttempts) {
      ignored += 1
      continue
    }

    if (status === "error" || status === "retry") {
      if (!isRetryReady(row, retryMinutes)) {
        ignored += 1
        continue
      }
    }

    try {
      if (status === "created" && autoConversion) {
        const result = await checkBrbyteInterestConversionFromReferral({
          referralId: row.id,
          actorUserId: null,
          triggeredBy: "cron_automatic",
        })
        if (result.ok) success += 1
        else if (result.skipped) ignored += 1
        else errors += 1
        continue
      }

      if (
        autoInvoice &&
        (status === "converted" ||
          status === "waiting_contract" ||
          status === "waiting_invoice")
      ) {
        const result = await checkBrbyteFirstInvoiceFromReferral({
          referralId: row.id,
          actorUserId: null,
          triggeredBy: "cron_automatic",
        })
        if (result.ok) success += 1
        else if (result.skipped) ignored += 1
        else errors += 1
        continue
      }

      ignored += 1
    } catch (e) {
      errors += 1
      console.error(LOG_TAG, {
        step: "referral_error",
        referralId: row.id,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const durationMs = Date.now() - started
  const status =
    errors === 0 ? "ok" : success > 0 ? "partial" : "error"

  await finishLifecycleRun(syncRunId, {
    status,
    phase: "check_conversion",
    api_reachable: true,
    fetched: referrals.length,
    processed: success + errors,
    matched: success,
    skipped_records: ignored,
    errors_count: errors,
    duration_ms: durationMs,
    meta: {
      phase: "lifecycle_sync",
      triggered_by: "cron_automatic",
      auto_conversion: autoConversion,
      auto_first_invoice: autoInvoice,
      verified: referrals.length,
      success,
      errors,
      ignored,
    },
  })

  console.log(LOG_TAG, {
    step: "done",
    syncRunId,
    verified: referrals.length,
    success,
    errors,
    ignored,
    durationMs,
  })

  return {
    ok: errors === 0 || success > 0,
    skipped: false,
    durationMs,
    syncRunId,
    verified: referrals.length,
    success,
    errors,
    ignored,
    message: "Sync BRByte lifecycle (conversão/contrato/fatura) concluído.",
  }
}
