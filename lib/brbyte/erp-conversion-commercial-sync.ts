/**
 * Mapeamento ERP Controllr → eixo comercial do CRM (Sprint 1.2R-A).
 *
 * Controllr converted
 *   → CRM status = "aprovada" (preserva "paga" se já avançou)
 *   → CRM pipeline_stage = "ativado"
 *
 * NÃO cria reward / wallet / first_invoice_paid.
 * NÃO altera indicator_profile_id / created_by_profile_id / commercial_profile_id.
 *
 * Sprint 1.2R-B: o trigger trg_referrals_assign_commercial_on_aprovada
 * deve ignorar atribuição quando NEW.brbyte_sync_status = converted
 * (ver supabase/patch-trg-aprovada-skip-erp-converted.sql).
 */

export const ERP_CONVERTED_CRM_STATUS = "aprovada" as const
export const ERP_CONVERTED_CRM_PIPELINE_STAGE = "ativado" as const
export const ERP_CONVERTED_BRBYTE_SYNC_STATUS = "converted" as const

export const ERP_CONVERSION_COMMERCIAL_HISTORY_ACTION =
  "erp_conversion_commercial_sync" as const

/** Campos que a sincronização de conversão NUNCA pode escrever. */
export const ERP_CONVERSION_FORBIDDEN_REFERRAL_KEYS = [
  "indicator_profile_id",
  "created_by_profile_id",
  "commercial_profile_id",
  "first_invoice_paid",
  "first_invoice_paid_at",
  "reward_amount",
  "reward_type",
  "reward_eligible",
] as const

export type ErpDerivedCommercialState = {
  /** ERP confirmou converted neste fluxo. */
  erpConverted: boolean
  applyCommercialSync: boolean
  targetStatus: "aprovada" | "paga" | null
  targetPipelineStage: "ativado" | null
  brbyteSyncStatus: "converted" | null
  needsCommercialUpdate: boolean
  writeCommercialHistory: boolean
  statusChanged: boolean
  pipelineChanged: boolean
  previousStatus: string | null
  previousPipelineStage: string | null
  createsReward: false
  createsWallet: false
  setsFirstInvoicePaid: false
  callsMarkFirstInvoicePaidFromSync: false
}

function normalizeToken(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null
  return String(raw).trim().toLowerCase()
}

function emptyCommercialState(
  erpConverted: boolean,
  previousStatus: string | null,
  previousPipelineStage: string | null
): ErpDerivedCommercialState {
  return {
    erpConverted,
    applyCommercialSync: false,
    targetStatus: null,
    targetPipelineStage: null,
    brbyteSyncStatus: null,
    needsCommercialUpdate: false,
    writeCommercialHistory: false,
    statusChanged: false,
    pipelineChanged: false,
    previousStatus,
    previousPipelineStage,
    createsReward: false,
    createsWallet: false,
    setsFirstInvoicePaid: false,
    callsMarkFirstInvoicePaidFromSync: false,
  }
}

/**
 * Decide o estado comercial resultante da conversão ERP.
 * Idempotente: se já alinhado, needsCommercialUpdate=false.
 */
export function deriveCommercialStateFromErpConversion(input: {
  erpConverted: boolean
  currentStatus: string | null | undefined
  currentPipelineStage: string | null | undefined
}): ErpDerivedCommercialState {
  const previousStatus = normalizeToken(input.currentStatus)
  const previousPipelineStage = normalizeToken(input.currentPipelineStage)

  if (!input.erpConverted) {
    return emptyCommercialState(false, previousStatus, previousPipelineStage)
  }

  const targetStatus: "aprovada" | "paga" =
    previousStatus === "paga" ? "paga" : ERP_CONVERTED_CRM_STATUS
  const targetPipelineStage = ERP_CONVERTED_CRM_PIPELINE_STAGE

  const statusChanged = previousStatus !== targetStatus
  const pipelineChanged = previousPipelineStage !== targetPipelineStage
  const needsCommercialUpdate = statusChanged || pipelineChanged

  return {
    erpConverted: true,
    applyCommercialSync: true,
    targetStatus,
    targetPipelineStage,
    brbyteSyncStatus: ERP_CONVERTED_BRBYTE_SYNC_STATUS,
    needsCommercialUpdate,
    writeCommercialHistory: needsCommercialUpdate,
    statusChanged,
    pipelineChanged,
    previousStatus,
    previousPipelineStage,
    createsReward: false,
    createsWallet: false,
    setsFirstInvoicePaid: false,
    callsMarkFirstInvoicePaidFromSync: false,
  }
}

export type ErpConversionReferralUpdate = Record<string, unknown>

/**
 * Monta o UPDATE de referrals para conversão confirmada.
 * Sempre inclui eixo ERP; eixo comercial só se houver mudança real.
 */
export function buildConvertedReferralUpdate(input: {
  commercial: ErpDerivedCommercialState
  clientPk: string
  resolution: {
    interestPk?: string | null
    clientPk?: string | null
    planPk?: string | null
    addressPk?: string | null
    emailPk?: string | null
    ticketPk?: string | null
    rawResult?: unknown
  }
  payload: Record<string, unknown>
  syncRunId: string | null
  httpStatus: number | null
  syncedAtIso: string
  listClientInterestEndpoint: string
  currentWonAt?: string | null
}): ErpConversionReferralUpdate {
  const { commercial } = input
  const update: ErpConversionReferralUpdate = {
    brbyte_client_pk: input.clientPk,
    brbyte_id_cliente: input.clientPk,
    brbyte_client_synced_at: input.syncedAtIso,
    brbyte_interessado_payload: {
      action: "check_conversion",
      endpoint: input.listClientInterestEndpoint,
      converted: true,
      interest_pk: input.resolution.interestPk,
      client_pk: input.resolution.clientPk,
      plan_pk: input.resolution.planPk,
      address_pk: input.resolution.addressPk,
      email_pk: input.resolution.emailPk,
      ticket_pk: input.resolution.ticketPk,
      response: input.payload,
      result: input.resolution.rawResult,
      sync_run_id: input.syncRunId,
      checked_at: input.syncedAtIso,
    },
    brbyte_sync_status: commercial.brbyteSyncStatus ?? ERP_CONVERTED_BRBYTE_SYNC_STATUS,
    brbyte_sync_error: null,
    brbyte_last_sync_at: input.syncedAtIso,
    brbyte_last_error_at: null,
    brbyte_last_http_status: input.httpStatus,
    brbyte_last_endpoint: input.listClientInterestEndpoint,
  }

  if (
    commercial.applyCommercialSync &&
    commercial.needsCommercialUpdate &&
    commercial.targetStatus &&
    commercial.targetPipelineStage
  ) {
    if (commercial.statusChanged) {
      update.status = commercial.targetStatus
    }
    if (commercial.pipelineChanged) {
      update.pipeline_stage = commercial.targetPipelineStage
      update.moved_to_stage_at = input.syncedAtIso
    }
    if (commercial.pipelineChanged && commercial.targetPipelineStage === ERP_CONVERTED_CRM_PIPELINE_STAGE) {
      update.won_at = input.currentWonAt?.trim() || input.syncedAtIso
      update.lost_at = null
      update.lost_reason = null
    }
  }

  return update
}

export function buildCommercialRepairUpdate(input: {
  commercial: ErpDerivedCommercialState
  syncedAtIso: string
  currentWonAt?: string | null
}): ErpConversionReferralUpdate | null {
  const { commercial } = input
  if (
    !commercial.applyCommercialSync ||
    !commercial.needsCommercialUpdate ||
    !commercial.targetStatus ||
    !commercial.targetPipelineStage
  ) {
    return null
  }

  const update: ErpConversionReferralUpdate = {
    brbyte_sync_status: ERP_CONVERTED_BRBYTE_SYNC_STATUS,
    brbyte_last_sync_at: input.syncedAtIso,
  }

  if (commercial.statusChanged) {
    update.status = commercial.targetStatus
  }
  if (commercial.pipelineChanged) {
    update.pipeline_stage = commercial.targetPipelineStage
    update.moved_to_stage_at = input.syncedAtIso
  }
  if (commercial.pipelineChanged && commercial.targetPipelineStage === ERP_CONVERTED_CRM_PIPELINE_STAGE) {
    update.won_at = input.currentWonAt?.trim() || input.syncedAtIso
    update.lost_at = null
    update.lost_reason = null
  }

  return update
}

export function assertNoForbiddenReferralKeys(
  update: ErpConversionReferralUpdate
): string[] {
  return ERP_CONVERSION_FORBIDDEN_REFERRAL_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(update, key)
  )
}

export function buildCommercialConversionHistoryInsert(input: {
  referralId: string
  actorUserId: string | null
  commercial: ErpDerivedCommercialState
  clientPk: string | null
  syncRunId: string | null
}): {
  referral_id: string
  actor_profile_id: string | null
  old_status: string | null
  new_status: string
  action_note: string
  metadata: Record<string, unknown>
} | null {
  if (
    !input.commercial.writeCommercialHistory ||
    !input.commercial.targetStatus ||
    !input.commercial.targetPipelineStage
  ) {
    return null
  }

  return {
    referral_id: input.referralId,
    actor_profile_id: input.actorUserId,
    old_status: input.commercial.previousStatus,
    new_status: input.commercial.targetStatus,
    action_note:
      "Estado comercial sincronizado a partir do Controllr (conversão ERP)",
    metadata: {
      action: ERP_CONVERSION_COMMERCIAL_HISTORY_ACTION,
      source: "controllr_sync",
      old_pipeline_stage: input.commercial.previousPipelineStage,
      new_pipeline_stage: input.commercial.targetPipelineStage,
      brbyte_client_pk: input.clientPk,
      sync_run_id: input.syncRunId,
      reward_created: false,
      wallet_credited: false,
    },
  }
}

/**
 * Espelha trg_referrals_assign_commercial_on_aprovada após o patch 1.2R-B.
 * true = deve chamar assign_referral_to_next_commercial
 */
export function shouldAssignCommercialOnAprovadaTrigger(input: {
  oldStatus: string | null | undefined
  newStatus: string | null | undefined
  commercialProfileId: string | null | undefined
  brbyteSyncStatus: string | null | undefined
}): boolean {
  const syncStatus = normalizeToken(input.brbyteSyncStatus)
  if (syncStatus === ERP_CONVERTED_BRBYTE_SYNC_STATUS) {
    return false
  }

  const newStatus = normalizeToken(input.newStatus)
  const oldStatus = normalizeToken(input.oldStatus)
  const commercialId =
    input.commercialProfileId == null
      ? null
      : String(input.commercialProfileId).trim() || null

  if (newStatus !== "aprovada") return false
  if (oldStatus === newStatus) return false
  if (commercialId != null) return false
  return true
}

export type ErpConversionCheckGate =
  | { kind: "controllr_check" }
  | { kind: "repair_commercial" }
  | { kind: "already_synced" }
  | { kind: "invalid"; message: string }

export function classifyErpConversionCheck(input: {
  brbyteIdInteressado: string | null | undefined
  brbyteClientPk: string | null | undefined
  brbyteSyncStatus: string | null | undefined
  currentStatus: string | null | undefined
  currentPipelineStage: string | null | undefined
  normalizeSyncStatus: (raw: string | null | undefined) => string | null
}): ErpConversionCheckGate {
  const interestPk = input.brbyteIdInteressado?.trim()
  if (!interestPk) {
    return {
      kind: "invalid",
      message:
        "Esta indicação ainda não possui Interessado vinculado no Controllr.",
    }
  }

  const commercial = deriveCommercialStateFromErpConversion({
    erpConverted: true,
    currentStatus: input.currentStatus,
    currentPipelineStage: input.currentPipelineStage,
  })
  const hasClient = Boolean(input.brbyteClientPk?.trim())
  const syncStatus = input.normalizeSyncStatus(input.brbyteSyncStatus)

  if (hasClient || syncStatus === ERP_CONVERTED_BRBYTE_SYNC_STATUS) {
    if (commercial.needsCommercialUpdate) {
      return { kind: "repair_commercial" }
    }
    return { kind: "already_synced" }
  }

  if (syncStatus !== "created") {
    return {
      kind: "invalid",
      message:
        "A verificação só está disponível quando o status da integração é Interessado criado.",
    }
  }

  return { kind: "controllr_check" }
}

export function projectErpConvertedAfterTrigger(input: {
  previousStatus: string | null | undefined
  previousPipelineStage: string | null | undefined
  commercialProfileId: string | null | undefined
  indicatorProfileId?: string | null | undefined
  createdByProfileId?: string | null | undefined
}): {
  status: "aprovada" | "paga"
  pipelineStage: "ativado"
  commercialProfileId: string | null
  indicatorProfileId: string | null
  createdByProfileId: string | null
  assignCommercialTriggered: boolean
  createsReward: false
  createsWallet: false
  setsFirstInvoicePaid: false
} {
  const plan = deriveCommercialStateFromErpConversion({
    erpConverted: true,
    currentStatus: input.previousStatus,
    currentPipelineStage: input.previousPipelineStage,
  })
  const commercialId =
    input.commercialProfileId == null
      ? null
      : String(input.commercialProfileId).trim() || null
  const indicatorId =
    input.indicatorProfileId == null
      ? null
      : String(input.indicatorProfileId).trim() || null
  const createdById =
    input.createdByProfileId == null
      ? null
      : String(input.createdByProfileId).trim() || null

  const assignCommercialTriggered = shouldAssignCommercialOnAprovadaTrigger({
    oldStatus: plan.previousStatus,
    newStatus: plan.targetStatus,
    commercialProfileId: commercialId,
    brbyteSyncStatus: plan.brbyteSyncStatus,
  })

  return {
    status: plan.targetStatus ?? ERP_CONVERTED_CRM_STATUS,
    pipelineStage: ERP_CONVERTED_CRM_PIPELINE_STAGE,
    commercialProfileId: commercialId,
    indicatorProfileId: indicatorId,
    createdByProfileId: createdById,
    assignCommercialTriggered,
    createsReward: false,
    createsWallet: false,
    setsFirstInvoicePaid: false,
  }
}
