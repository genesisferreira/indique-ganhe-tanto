import "server-only"

import {
  createBrbyteInterestFromReferral,
  type BrbyteCreateInterestSourceContext,
} from "@/lib/brbyte/create-interest.service"
import {
  automaticInterestKeyForPreRegistration,
  isExplicitInterestOperation,
  settleInterestOperation,
} from "@/lib/brbyte/interest-queue"
import { interestRetryDue } from "@/lib/referral-share/controllr-origin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

const LEASE_TTL_MS = 120_000

type OperationRow = {
  id: string
  referral_id: string
  operation_type: string
  status: string
  idempotency_key: string | null
  origin: string | null
  flow: string
  attempts: number | null
  lease_until: string | null
  last_attempt_at: string | null
}

type Chain = {
  select: (cols: string) => Chain
  eq: (col: string, val: string) => Chain
  in: (col: string, vals: string[]) => Chain
  order: (col: string, opts: { ascending: boolean }) => Chain
  limit: (n: number) => Promise<{
    data: OperationRow[] | null
    error: { message: string } | null
  }>
  maybeSingle: () => Promise<{
    data: { brbyte_sync_status: string | null } | null
    error: { message: string } | null
  }>
  update: (values: Record<string, unknown>) => Chain
}

type LooseDb = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: { ok?: boolean } | null; error: { message: string } | null }>
  from: (table: string) => Chain
}

function db(): LooseDb {
  return createServiceRoleClient() as unknown as LooseDb
}

export async function enqueueAutomaticInterestOperation(input: {
  referralId: string
  idempotencyKey: string
}): Promise<boolean> {
  const { data, error } = await db().rpc("enqueue_automatic_interest_operation", {
    p_referral_id: input.referralId,
    p_idempotency_key: input.idempotencyKey,
  })
  return !error && data?.ok === true
}

export async function enqueuePreRegistrationInterestOperation(
  referralId: string
): Promise<boolean> {
  return enqueueAutomaticInterestOperation({
    referralId,
    idempotencyKey: automaticInterestKeyForPreRegistration(referralId),
  })
}

export async function loadDueInterestOperations(nowMs: number): Promise<OperationRow[]> {
  const { data, error } = await db()
    .from("brbyte_interest_operations")
    .select(
      "id, referral_id, operation_type, status, idempotency_key, origin, flow, attempts, lease_until, last_attempt_at"
    )
    .eq("operation_type", "create_interest")
    .in("status", ["pending", "retryable"])
    .in("flow", ["automatic_current", "admin_explicit"])
    .order("created_at", { ascending: true })
    .limit(50)

  if (error || !data) return []
  return data.filter((row) => operationIsDue(row, nowMs))
}

function operationIsDue(row: OperationRow, nowMs: number): boolean {
  if (
    !isExplicitInterestOperation({
      operationType: row.operation_type,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      origin: row.origin,
      flow: row.flow,
      attempts: row.attempts,
    })
  ) {
    return false
  }
  const leaseAt = row.lease_until ? Date.parse(row.lease_until) : Number.NaN
  const leased = Number.isFinite(leaseAt) && leaseAt > nowMs
  return interestRetryDue({
    attempts: row.attempts ?? 0,
    lastSyncAt: leased
      ? new Date(leaseAt - LEASE_TTL_MS).toISOString()
      : row.last_attempt_at,
    endpoint: leased ? "create_interest:in_progress" : null,
    nowMs,
    leaseTtlMs: LEASE_TTL_MS,
  })
}

async function claimOperation(id: string, nowMs: number): Promise<void> {
  await db()
    .from("brbyte_interest_operations")
    .update({ lease_until: new Date(nowMs + LEASE_TTL_MS).toISOString() })
    .eq("id", id)
}

async function releaseOperationLease(id: string): Promise<void> {
  await db()
    .from("brbyte_interest_operations")
    .update({ lease_until: null })
    .eq("id", id)
}

function sourceContextFor(row: OperationRow): BrbyteCreateInterestSourceContext {
  if (row.flow === "admin_explicit") return "admin_manual"
  if (row.origin === "public_pre_registration") return "public_pre_registration"
  if (row.origin === "neutral_network_pre_registration") return "neutral_network_pre_registration"
  if (
    row.origin === "referral_share_link" ||
    row.origin === "employee_sales_opportunity" ||
    row.origin === "partner_merchant_referral"
  ) {
    return "referral_share"
  }
  return "cron_retry"
}

export async function runExplicitInterestOperation(
  row: OperationRow
): Promise<"created" | "skipped"> {
  const nowMs = Date.now()
  await claimOperation(row.id, nowMs)
  try {
    const result = await createBrbyteInterestFromReferral({
      referralId: row.referral_id,
      actorUserId: null,
      sourceContext: sourceContextFor(row),
    })
    const { data: referral } = await db()
      .from("referrals")
      .select("brbyte_sync_status")
      .eq("id", row.referral_id)
      .maybeSingle()
    const next = settleInterestOperation({
      ok: result.ok,
      skipped: result.skipped,
      hasInterestId: Boolean(result.brbyteIdInteressado),
      attempts: row.attempts ?? 0,
      referralStatus: referral?.brbyte_sync_status,
    })
    await db()
      .from("brbyte_interest_operations")
      .update({
        status: next,
        attempts: next === "retryable" ? (row.attempts ?? 0) + 1 : row.attempts ?? 0,
        last_attempt_at: new Date().toISOString(),
        lease_until: null,
      })
      .eq("id", row.id)
    return result.ok && result.brbyteIdInteressado ? "created" : "skipped"
  } catch {
    const next = settleInterestOperation({
      ok: false,
      hasInterestId: false,
      attempts: row.attempts ?? 0,
    })
    await db()
      .from("brbyte_interest_operations")
      .update({
        status: next,
        attempts: (row.attempts ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        lease_until: null,
      })
      .eq("id", row.id)
    return "skipped"
  } finally {
    await releaseOperationLease(row.id)
  }
}
