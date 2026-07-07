import "server-only"

import { logBrbyteReferralHistory } from "@/lib/brbyte/referral-history"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { BrbyteSyncStatus } from "@/types/referral"
import { normalizeBrbyteSyncStatus } from "@/types/referral"

const LOG_TAG = "[brbyte:reset-referral]"
const RELEASED_REWARD_STATUSES = new Set(["disponivel", "solicitado", "pago"])

export type BrbyteResetReferralResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  referralId: string
  message?: string
}

type ReferralResetRow = {
  id: string
  status: string
  first_invoice_paid: boolean
  brbyte_sync_status: string | null
  brbyte_id_interessado: string | null
  brbyte_id_cliente: string | null
  brbyte_client_pk: string | null
  brbyte_contract_pk: string | null
}

type LooseDb = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        maybeSingle: () => Promise<{
          data: ReferralResetRow | null
          error: { message: string } | null
        }>
      }
    }
    update: (values: unknown) => {
      eq: (
        col: string,
        val: string
      ) => Promise<{ error: { message: string } | null }>
    }
    insert: (values: unknown) => Promise<{
      error: { message: string } | null
    }>
  }
}

function getDb(): LooseDb {
  return createServiceRoleClient() as unknown as LooseDb
}

async function loadReferral(referralId: string): Promise<ReferralResetRow | null> {
  const { data, error } = await getDb()
    .from("referrals")
    .select(
      `
      id,
      status,
      first_invoice_paid,
      brbyte_sync_status,
      brbyte_id_interessado,
      brbyte_id_cliente,
      brbyte_client_pk,
      brbyte_contract_pk
    `
    )
    .eq("id", referralId)
    .maybeSingle()

  if (error) {
    console.error(LOG_TAG, { step: "load_referral", message: error.message })
    return null
  }

  return data
}

async function hasReleasedReward(referralId: string): Promise<boolean> {
  const db = getDb() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string
        ) => Promise<{
          data: { id: string; status: string }[] | null
          error: { message: string } | null
        }>
      }
    }
  }

  const { data: rewards, error: rewardsError } = await db
    .from("rewards")
    .select("id, status")
    .eq("referral_id", referralId)

  if (rewardsError) {
    console.error(LOG_TAG, { step: "load_rewards", message: rewardsError.message })
    return true
  }

  const rewardList = rewards ?? []
  for (const reward of rewardList) {
    if (RELEASED_REWARD_STATUSES.has(reward.status)) {
      return true
    }
  }

  if (rewardList.length === 0) return false

  const walletDb = getDb() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        in: (
          col: string,
          vals: string[]
        ) => {
          eq: (
            col2: string,
            val2: string
          ) => {
            limit: (n: number) => Promise<{
              data: { id: string }[] | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  }

  const rewardIds = rewardList.map((r) => r.id)
  const { data: txs } = await walletDb
    .from("wallet_transactions")
    .select("id")
    .in("reward_id", rewardIds)
    .eq("transaction_type", "credito")
    .limit(1)

  return Boolean(txs && txs.length > 0)
}

function buildResetPatch(): Record<string, unknown> {
  return {
    brbyte_sync_status: "pending",
    brbyte_sync_error: null,
    brbyte_sync_attempts: 0,
    brbyte_last_error_at: null,
    brbyte_last_http_status: null,
    brbyte_last_endpoint: null,
    brbyte_last_sync_at: null,
    brbyte_id_interessado: null,
    brbyte_interessado_status: null,
    brbyte_interessado_created_at: null,
    brbyte_interessado_last_sync_at: null,
    brbyte_interessado_payload: null,
    brbyte_id_cliente: null,
    brbyte_id_tercero: null,
    brbyte_id_contrato: null,
    brbyte_no_contrato: null,
    brbyte_matched_at: null,
    brbyte_client_pk: null,
    brbyte_client_synced_at: null,
    brbyte_contract_pk: null,
    brbyte_first_invoice_pk: null,
    brbyte_first_invoice_paid_at: null,
    brbyte_first_invoice_payload: null,
  }
}

export async function resetBrbyteReferralIntegration(input: {
  referralId: string
  actorUserId: string
}): Promise<BrbyteResetReferralResult> {
  const referralId = input.referralId.trim()
  if (!referralId) {
    return {
      ok: false,
      referralId,
      message: "ID da indicação é obrigatório.",
    }
  }

  const referral = await loadReferral(referralId)
  if (!referral) {
    return {
      ok: false,
      referralId,
      message: "Indicação não encontrada.",
    }
  }

  if (referral.first_invoice_paid) {
    return {
      ok: false,
      skipped: true,
      reason: "first_invoice_paid",
      referralId,
      message:
        "Não é possível resetar: a primeira mensalidade já foi confirmada nesta indicação.",
    }
  }

  const syncStatus = normalizeBrbyteSyncStatus(referral.brbyte_sync_status)
  if (syncStatus === "paid_confirmed" || syncStatus === "completed") {
    return {
      ok: false,
      skipped: true,
      reason: "sync_status_locked",
      referralId,
      message:
        "Não é possível resetar: a integração BRByte já está concluída para esta indicação.",
    }
  }

  if (await hasReleasedReward(referralId)) {
    return {
      ok: false,
      skipped: true,
      reason: "reward_released",
      referralId,
      message:
        "Não é possível resetar: já existe recompensa liberada vinculada a esta indicação.",
    }
  }

  const oldBrbyteStatus = syncStatus
  const snapshotBefore = {
    brbyte_sync_status: referral.brbyte_sync_status,
    brbyte_id_interessado: referral.brbyte_id_interessado,
    brbyte_id_cliente: referral.brbyte_id_cliente,
    brbyte_client_pk: referral.brbyte_client_pk,
    brbyte_contract_pk: referral.brbyte_contract_pk,
  }

  const { error: updateError } = await getDb()
    .from("referrals")
    .update(buildResetPatch())
    .eq("id", referralId)

  if (updateError) {
    console.error(LOG_TAG, { step: "update_referral", message: updateError.message })
    return {
      ok: false,
      referralId,
      message: `Falha ao resetar integração BRByte: ${updateError.message}`,
    }
  }

  const { error: histError } = await getDb().from("referral_history").insert({
    referral_id: referralId,
    actor_profile_id: input.actorUserId,
    old_status: referral.status,
    new_status: referral.status,
    action_note: "Integração BRByte resetada manualmente pelo admin master",
    metadata: {
      action: "brbyte_reset_manual",
      old_brbyte_sync_status: oldBrbyteStatus,
      new_brbyte_sync_status: "pending",
      snapshot_before: snapshotBefore,
    },
  })

  if (histError) {
    console.error(LOG_TAG, { step: "referral_history", message: histError.message })
  }

  await logBrbyteReferralHistory({
    referralId,
    phase: "reset_manual",
    oldStatus: oldBrbyteStatus,
    newStatus: "pending" satisfies BrbyteSyncStatus,
    message: "Integração BRByte resetada manualmente",
    payload: {
      action: "brbyte_reset_manual",
      snapshot_before: snapshotBefore,
    },
    createdBy: input.actorUserId,
  })

  try {
    await getDb().from("audit_logs").insert({
      actor_profile_id: input.actorUserId,
      target_profile_id: null,
      entity_name: "referral",
      entity_id: referralId,
      action: "update",
      old_data: snapshotBefore,
      new_data: { brbyte_sync_status: "pending" },
      metadata: {
        source: "brbyte_reset_manual",
        action: "brbyte_reset_manual",
      },
    })
  } catch (e) {
    console.error(LOG_TAG, {
      step: "audit_log",
      message: e instanceof Error ? e.message : String(e),
    })
  }

  return {
    ok: true,
    referralId,
    message: "Integração BRByte resetada. A indicação pode ser testada novamente.",
  }
}
