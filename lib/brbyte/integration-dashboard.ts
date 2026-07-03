import "server-only"

import { getBrbytePublicIntegrationFlags } from "@/lib/brbyte/config"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { BrbyteSyncStatus } from "@/types/referral"
import { normalizeBrbyteSyncStatus } from "@/types/referral"

const STATUS_KEYS: BrbyteSyncStatus[] = [
  "pending",
  "created",
  "converted",
  "waiting_conversion",
  "waiting_contract",
  "waiting_invoice",
  "synced",
  "completed",
  "error",
  "retry",
]

export type BrbyteIntegrationDashboard = {
  flags: ReturnType<typeof getBrbytePublicIntegrationFlags>
  lastSyncRun: {
    id: string
    status: string
    phase: string | null
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
    errorsCount: number
  } | null
  lastCreateInterest: {
    referralId: string
    createdAt: string
    httpStatus: number | null
    message: string | null
  } | null
  lastError: {
    referralId: string | null
    createdAt: string
    message: string | null
    endpoint: string | null
    httpStatus: number | null
  } | null
  today: {
    attempts: number
    successes: number
    errors: number
  }
  referralsByStatus: Record<BrbyteSyncStatus, number>
}

function startOfTodayUtcIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function emptyStatusCounts(): Record<BrbyteSyncStatus, number> {
  return STATUS_KEYS.reduce(
    (acc, key) => {
      acc[key] = 0
      return acc
    },
    {} as Record<BrbyteSyncStatus, number>
  )
}

export function buildEmptyBrbyteIntegrationDashboard(): BrbyteIntegrationDashboard {
  return {
    flags: getBrbytePublicIntegrationFlags(),
    lastSyncRun: null,
    lastCreateInterest: null,
    lastError: null,
    today: {
      attempts: 0,
      successes: 0,
      errors: 0,
    },
    referralsByStatus: emptyStatusCounts(),
  }
}

export async function loadBrbyteIntegrationDashboard(): Promise<BrbyteIntegrationDashboard> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any

  const fallback = buildEmptyBrbyteIntegrationDashboard()
  const flags = fallback.flags
  const todayIso = startOfTodayUtcIso()
  const referralsByStatus = emptyStatusCounts()

  const lastRunPromise = supabase
    .from("brbyte_sync_runs")
    .select(
      "id, status, phase, started_at, finished_at, duration_ms, errors_count"
    )
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastCreatePromise = supabase
    .from("brbyte_referral_history")
    .select("referral_id, created_at, http_status, message, new_status")
    .eq("phase", "create_interest")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastErrorPromise = supabase
    .from("brbyte_referral_history")
    .select("referral_id, created_at, message, endpoint, http_status")
    .eq("new_status", "error")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const todayHistoryPromise = supabase
    .from("brbyte_referral_history")
    .select("new_status, phase")
    .gte("created_at", todayIso)

  const referralsStatusPromise = supabase
    .from("referrals")
    .select("brbyte_sync_status")

  const [
    { data: lastRunRow },
    { data: lastCreateRow },
    { data: lastErrorRow },
    { data: todayRows },
    { data: referralRows },
  ] = await Promise.all([
    lastRunPromise,
    lastCreatePromise,
    lastErrorPromise,
    todayHistoryPromise,
    referralsStatusPromise,
  ])

  let todayAttempts = 0
  let todaySuccesses = 0
  let todayErrors = 0

  for (const row of todayRows ?? []) {
    if (row.phase !== "create_interest") continue
    todayAttempts += 1
    if (row.new_status === "created") todaySuccesses += 1
    if (row.new_status === "error") todayErrors += 1
  }

  for (const row of referralRows ?? []) {
    const status = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
    referralsByStatus[status] += 1
  }

  return {
    flags,
    lastSyncRun: lastRunRow?.id
      ? {
          id: lastRunRow.id,
          status: lastRunRow.status ?? "unknown",
          phase: lastRunRow.phase ?? null,
          startedAt: lastRunRow.started_at ?? "",
          finishedAt: lastRunRow.finished_at ?? null,
          durationMs: lastRunRow.duration_ms ?? null,
          errorsCount: lastRunRow.errors_count ?? 0,
        }
      : null,
    lastCreateInterest:
      lastCreateRow?.referral_id && lastCreateRow.created_at
        ? {
            referralId: lastCreateRow.referral_id,
            createdAt: lastCreateRow.created_at,
            httpStatus: lastCreateRow.http_status ?? null,
            message: lastCreateRow.message ?? null,
          }
        : null,
    lastError: lastErrorRow?.created_at
      ? {
          referralId: lastErrorRow.referral_id ?? null,
          createdAt: lastErrorRow.created_at,
          message: lastErrorRow.message ?? null,
          endpoint: lastErrorRow.endpoint ?? null,
          httpStatus: lastErrorRow.http_status ?? null,
        }
      : null,
    today: {
      attempts: todayAttempts,
      successes: todaySuccesses,
      errors: todayErrors,
    },
    referralsByStatus,
  }
}
