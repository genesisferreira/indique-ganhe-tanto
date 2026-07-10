import "server-only"

import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { PUBLIC_PRE_REGISTRATION_SOURCE } from "@/lib/referral-reward-eligibility"

export type PublicPreRegistrationMetrics = {
  today: number
  last7Days: number
  last30Days: number
  sentToControllr: number
  integrationErrors: number
  convertedToClient: number
}

type MetricsRow = {
  created_at: string
  public_pre_registration_at: string | null
  brbyte_sync_status: string | null
  brbyte_id_interessado: string | null
  brbyte_client_pk: string | null
}

type MetricsDb = {
  from: (table: "referrals") => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        gte: (
          col: string,
          val: string
        ) => Promise<{
          data: MetricsRow[] | null
          error: { message: string } | null
        }>
      }
    }
  }
}

function getMetricsDb(): MetricsDb {
  return createServiceRoleClient() as unknown as MetricsDb
}

function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function rowTimestamp(row: MetricsRow): string {
  return row.public_pre_registration_at ?? row.created_at
}

function isSentToControllr(row: MetricsRow): boolean {
  if (row.brbyte_id_interessado?.trim()) return true
  const status = row.brbyte_sync_status?.trim()
  if (!status) return false
  return !["pending", "error", "retry"].includes(status)
}

function isIntegrationError(row: MetricsRow): boolean {
  return row.brbyte_sync_status === "error"
}

function isConvertedToClient(row: MetricsRow): boolean {
  if (row.brbyte_client_pk?.trim()) return true
  const status = row.brbyte_sync_status?.trim()
  return (
    status === "converted" ||
    status === "paid_confirmed" ||
    status === "completed"
  )
}

export function buildEmptyPublicPreRegistrationMetrics(): PublicPreRegistrationMetrics {
  return {
    today: 0,
    last7Days: 0,
    last30Days: 0,
    sentToControllr: 0,
    integrationErrors: 0,
    convertedToClient: 0,
  }
}

export async function loadPublicPreRegistrationMetrics(): Promise<PublicPreRegistrationMetrics> {
  const since30 = daysAgoIso(30)
  const { data, error } = await getMetricsDb()
    .from("referrals")
    .select(
      "created_at, public_pre_registration_at, brbyte_sync_status, brbyte_id_interessado, brbyte_client_pk"
    )
    .eq("source", PUBLIC_PRE_REGISTRATION_SOURCE)
    .gte("created_at", since30)

  if (error || !data) {
    return buildEmptyPublicPreRegistrationMetrics()
  }

  const rows = data
  const todayStart = startOfTodayIso()
  const last7 = daysAgoIso(7)

  let today = 0
  let last7Days = 0
  let last30Days = rows.length
  let sentToControllr = 0
  let integrationErrors = 0
  let convertedToClient = 0

  for (const row of rows) {
    const ts = rowTimestamp(row)
    if (ts >= todayStart) today += 1
    if (ts >= last7) last7Days += 1
    if (isSentToControllr(row)) sentToControllr += 1
    if (isIntegrationError(row)) integrationErrors += 1
    if (isConvertedToClient(row)) convertedToClient += 1
  }

  return {
    today,
    last7Days,
    last30Days,
    sentToControllr,
    integrationErrors,
    convertedToClient,
  }
}
