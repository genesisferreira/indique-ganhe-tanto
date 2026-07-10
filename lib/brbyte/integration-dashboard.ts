import "server-only"

import { getBrbytePublicIntegrationFlags } from "@/lib/brbyte/config"
import {
  accumulateFirstInvoicePipeline,
  emptyFirstInvoicePipeline,
  formatBrbyteFriendlyMessage,
  getBrbytePhaseLabel,
  isBrbyteSummaryPhase,
  mapHistoryRowToLastActivity,
  pickRelevantBrbyteHistoryActivity,
  pickRelevantBrbyteHistoryError,
  resolveBrbyteConnectionStatus,
  type BrbyteConnectionStatus,
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
  connection: BrbyteConnectionStatus
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
    connection: {
      connected: false,
      testedToday: false,
      lastSuccessAt: null,
    },
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
    .limit(20)

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
    .limit(80)

  const todayHistoryPromise = supabase
    .from("brbyte_referral_history")
    .select("new_status, phase, created_at, http_status")
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

  const rewardsPromise = supabase.from("rewards").select("id, referral_id")

  const walletCreditsPromise = supabase
    .from("wallet_transactions")
    .select("reward_id")
    .eq("transaction_type", "credito")

  const [
    { data: lastRunRows },
    { data: lastCreateRow },
    { data: recentHistoryRows },
    { data: todayRows },
    { data: referralRows },
    { data: rewardRows },
    { data: walletCreditRows },
  ] = await Promise.all([
    lastRunPromise,
    lastCreatePromise,
    recentHistoryPromise,
    todayHistoryPromise,
    referralsStatusPromise,
    rewardsPromise,
    walletCreditsPromise,
  ])

  const creditRewardIds = new Set<string>()
  for (const wallet of walletCreditRows ?? []) {
    const rewardId = wallet.reward_id
    if (typeof rewardId === "string" && rewardId.trim()) {
      creditRewardIds.add(rewardId.trim())
    }
  }

  const referralHasReward = new Set<string>()
  const referralCreditReleased = new Set<string>()
  for (const reward of rewardRows ?? []) {
    if (!reward.referral_id) continue
    referralHasReward.add(reward.referral_id)
    if (reward.id && creditRewardIds.has(reward.id)) {
      referralCreditReleased.add(reward.referral_id)
    }
  }

  let todayAttempts = 0
  let todaySuccesses = 0
  let todayErrors = 0
  let lastSuccessfulActivityAt: string | null = null

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
        has_reward: referralHasReward.has(row.id),
        credit_released: referralCreditReleased.has(row.id),
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

  for (const row of historyRows) {
    if (!currentPhases.has(String(row.phase))) continue
    if (row.new_status === "error") continue
    const httpStatus =
      typeof row.http_status === "number" ? row.http_status : null
    if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 300)) continue
    lastSuccessfulActivityAt = row.created_at
    break
  }

  const lastRunRow =
    (lastRunRows ?? []).find((row: { phase?: string | null }) =>
      isBrbyteSummaryPhase(row.phase ?? null)
    ) ?? null

  const connection = resolveBrbyteConnectionStatus({
    todayAttempts,
    lastSuccessfulActivityAt,
  })

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
    connection,
    today: {
      attempts: todayAttempts,
      successes: todaySuccesses,
      errors: todayErrors,
    },
    referralsByStatus,
    firstInvoicePipeline,
  }
}
