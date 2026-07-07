import "server-only"

import { getBrbytePublicIntegrationFlags } from "@/lib/brbyte/config"
import {
  accumulateFirstInvoicePipeline,
  emptyFirstInvoicePipeline,
  formatBrbyteFriendlyMessage,
  getBrbytePhaseLabel,
  mapHistoryRowToLastActivity,
  pickRelevantBrbyteHistoryActivity,
  pickRelevantBrbyteHistoryError,
  type BrbyteFirstInvoicePipeline,
  type BrbyteLastActivity,
} from "@/lib/brbyte/observability"
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
  "paid_confirmed",
  "completed",
  "error",
  "retry",
]

const RELEASED_REWARD_STATUSES = new Set(["disponivel", "solicitado", "pago"])

export type BrbyteIntegrationDashboard = {
  flags: ReturnType<typeof getBrbytePublicIntegrationFlags>
  lastSyncRun: {
    id: string
    status: string
    phase: string | null
    phaseLabel: string
    referralId: string | null
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
    errorsCount: number
  } | null
  lastActivity: BrbyteLastActivity | null
  lastCreateInterest: {
    referralId: string
    createdAt: string
    httpStatus: number | null
    message: string | null
  } | null
  lastError: BrbyteLastActivity | null
  today: {
    attempts: number
    successes: number
    errors: number
  }
  referralsByStatus: Record<BrbyteSyncStatus, number>
  firstInvoicePipeline: BrbyteFirstInvoicePipeline
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
    lastActivity: null,
    lastCreateInterest: null,
    lastError: null,
    today: {
      attempts: 0,
      successes: 0,
      errors: 0,
    },
    referralsByStatus: emptyStatusCounts(),
    firstInvoicePipeline: emptyFirstInvoicePipeline(),
  }
}

function readReferralIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null
  const record = meta as Record<string, unknown>
  const id = record.referral_id
  if (typeof id === "string" && id.trim()) return id.trim()
  return null
}

export async function loadBrbyteIntegrationDashboard(): Promise<BrbyteIntegrationDashboard> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any

  const fallback = buildEmptyBrbyteIntegrationDashboard()
  const flags = fallback.flags
  const todayIso = startOfTodayUtcIso()
  const referralsByStatus = emptyStatusCounts()
  const firstInvoicePipeline = emptyFirstInvoicePipeline()

  const lastRunPromise = supabase
    .from("brbyte_sync_runs")
    .select(
      "id, status, phase, started_at, finished_at, duration_ms, errors_count, meta"
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

  const recentHistoryPromise = supabase
    .from("brbyte_referral_history")
    .select(
      "referral_id, created_at, message, endpoint, http_status, phase, new_status"
    )
    .order("created_at", { ascending: false })
    .limit(40)

  const todayHistoryPromise = supabase
    .from("brbyte_referral_history")
    .select("new_status, phase")
    .gte("created_at", todayIso)

  const referralsStatusPromise = supabase
    .from("referrals")
    .select(
      `
      id,
      brbyte_sync_status,
      first_invoice_paid,
      brbyte_contract_pk,
      brbyte_first_invoice_pk,
      brbyte_first_invoice_paid_at
    `
    )

  const rewardsPromise = supabase
    .from("rewards")
    .select("referral_id, status")

  const [
    { data: lastRunRow },
    { data: lastCreateRow },
    { data: recentHistoryRows },
    { data: todayRows },
    { data: referralRows },
    { data: rewardRows },
  ] = await Promise.all([
    lastRunPromise,
    lastCreatePromise,
    recentHistoryPromise,
    todayHistoryPromise,
    referralsStatusPromise,
    rewardsPromise,
  ])

  const releasedReferralIds = new Set<string>()
  for (const reward of rewardRows ?? []) {
    if (
      reward.referral_id &&
      RELEASED_REWARD_STATUSES.has(String(reward.status))
    ) {
      releasedReferralIds.add(reward.referral_id)
    }
  }

  let todayAttempts = 0
  let todaySuccesses = 0
  let todayErrors = 0

  const currentPhases = new Set([
    "create_interest",
    "check_conversion",
    "check_first_invoice",
    "reset_manual",
  ])

  for (const row of todayRows ?? []) {
    if (!currentPhases.has(String(row.phase))) continue
    todayAttempts += 1
    if (row.new_status === "error") todayErrors += 1
    else todaySuccesses += 1
  }

  for (const row of referralRows ?? []) {
    const status = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
    referralsByStatus[status] += 1

    accumulateFirstInvoicePipeline(
      {
        brbyte_sync_status: row.brbyte_sync_status,
        first_invoice_paid: row.first_invoice_paid,
        brbyte_contract_pk: row.brbyte_contract_pk,
        brbyte_first_invoice_pk: row.brbyte_first_invoice_pk,
        brbyte_first_invoice_paid_at: row.brbyte_first_invoice_paid_at,
        reward_released: releasedReferralIds.has(row.id),
      },
      firstInvoicePipeline
    )
  }

  const historyRows = recentHistoryRows ?? []
  const lastActivityRow = pickRelevantBrbyteHistoryActivity(historyRows)
  const lastErrorRow = pickRelevantBrbyteHistoryError(
    historyRows.filter(
      (row: { new_status: string | null }) => row.new_status === "error"
    )
  )

  return {
    flags,
    lastSyncRun: lastRunRow?.id
      ? {
          id: lastRunRow.id,
          status: lastRunRow.status ?? "unknown",
          phase: lastRunRow.phase ?? null,
          phaseLabel: getBrbytePhaseLabel(lastRunRow.phase),
          referralId: readReferralIdFromMeta(lastRunRow.meta),
          startedAt: lastRunRow.started_at ?? "",
          finishedAt: lastRunRow.finished_at ?? null,
          durationMs: lastRunRow.duration_ms ?? null,
          errorsCount: lastRunRow.errors_count ?? 0,
        }
      : null,
    lastActivity: lastActivityRow
      ? mapHistoryRowToLastActivity(lastActivityRow)
      : null,
    lastCreateInterest:
      lastCreateRow?.referral_id && lastCreateRow.created_at
        ? {
            referralId: lastCreateRow.referral_id,
            createdAt: lastCreateRow.created_at,
            httpStatus: lastCreateRow.http_status ?? null,
            message: formatBrbyteFriendlyMessage(lastCreateRow.message, {
              phase: "create_interest",
              syncStatus: lastCreateRow.new_status,
            }),
          }
        : null,
    lastError: lastErrorRow ? mapHistoryRowToLastActivity(lastErrorRow) : null,
    today: {
      attempts: todayAttempts,
      successes: todaySuccesses,
      errors: todayErrors,
    },
    referralsByStatus,
    firstInvoicePipeline,
  }
}
