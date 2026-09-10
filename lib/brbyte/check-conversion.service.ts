import "server-only"

import {
  extractListInterestResolution,
  isListInterestResponseSuccessful,
  lookupClientInterestByInterestPk,
  resolveListInterestErrorMessage,
} from "@/lib/brbyte/check-conversion-response"
import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import {
  getBrbyteCreateInterestConfig,
  getBrbyteOperationalConfig,
  isBrbyteAutoCheckConversionEnabled,
  isBrbyteCreateInterestEnabled,
} from "@/lib/brbyte/config"
import {
  buildCommercialConversionHistoryInsert,
  buildCommercialRepairUpdate,
  buildConvertedReferralUpdate,
  classifyErpConversionCheck,
  deriveCommercialStateFromErpConversion,
} from "@/lib/brbyte/erp-conversion-commercial-sync"
import { logBrbyteReferralHistory } from "@/lib/brbyte/referral-history"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  BRBYTE_API_PATHS,
  type BrbyteCheckConversionResult,
  type BrbyteSyncRunPhase,
  type BrbyteSyncRunStatus,
} from "@/types/brbyte"
import { normalizeBrbyteSyncStatus } from "@/types/referral"

const LOG_TAG = "[brbyte:check-conversion]"
const LOGIN_ENDPOINT = "/login"
const CHECK_CONVERSION_PHASE: BrbyteSyncRunPhase = "check_conversion"
const NOT_CONVERTED_MESSAGE = "Ainda não convertido no Controllr"

type ReferralCheckConversionRow = {
  id: string
  status: string | null
  pipeline_stage: string | null
  won_at: string | null
  brbyte_id_interessado: string | null
  brbyte_client_pk: string | null
  brbyte_sync_status: string | null
}

type BrbyteLooseDb = {
  from: (table: string) => {
    insert: (values: unknown) => {
      select: (cols: string) => {
        single: () => Promise<{
          data: { id: string } | null
          error: { message: string; code?: string } | null
        }>
      }
    } & PromiseLike<{ error: { message: string; code?: string } | null }>
    update: (values: unknown) => {
      eq: (
        col: string,
        val: string
      ) => Promise<{ error: { message: string; code?: string } | null }>
    }
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        maybeSingle: () => Promise<{
          data: ReferralCheckConversionRow | null
          error: { message: string } | null
        }>
      }
    }
  }
}

function getDb(): BrbyteLooseDb {
  return createServiceRoleClient() as unknown as BrbyteLooseDb
}

async function createSyncRun(
  referralId: string,
  actorUserId: string | null,
  configured: boolean,
  triggeredBy: string
): Promise<string | null> {
  try {
    const { data, error } = await getDb()
      .from("brbyte_sync_runs")
      .insert({
        status: "running",
        configured,
        phase: CHECK_CONVERSION_PHASE,
        meta: {
          phase: CHECK_CONVERSION_PHASE,
          referral_id: referralId,
          triggered_by: triggeredBy,
          actor_user_id: actorUserId,
        },
      })
      .select("id")
      .single()

    if (error) {
      console.error(LOG_TAG, { step: "create_sync_run", message: error.message })
      return null
    }
    return data?.id ?? null
  } catch (e) {
    console.error(LOG_TAG, {
      step: "create_sync_run",
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

async function finishSyncRun(
  runId: string | null,
  patch: {
    status: BrbyteSyncRunStatus
    phase?: BrbyteSyncRunPhase | string
    api_reachable?: boolean | null
    processed?: number
    skipped_records?: number
    errors_count?: number
    duration_ms?: number
    error_summary?: Record<string, unknown> | null
    meta?: Record<string, unknown>
  }
): Promise<void> {
  if (!runId) return
  try {
    const { error } = await getDb()
      .from("brbyte_sync_runs")
      .update({
        ...patch,
        phase: patch.phase ?? CHECK_CONVERSION_PHASE,
        finished_at: new Date().toISOString(),
        meta: {
          phase: CHECK_CONVERSION_PHASE,
          ...(patch.meta ?? {}),
        },
      })
      .eq("id", runId)

    if (error) {
      console.error(LOG_TAG, { step: "finish_sync_run", message: error.message })
    }
  } catch (e) {
    console.error(LOG_TAG, {
      step: "finish_sync_run",
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

async function loadReferralForCheckConversion(
  referralId: string
): Promise<ReferralCheckConversionRow | null> {
  const { data, error } = await getDb()
    .from("referrals")
    .select(
      `
      id,
      status,
      pipeline_stage,
      won_at,
      brbyte_id_interessado,
      brbyte_client_pk,
      brbyte_sync_status
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

function classifyReferralForCheck(row: ReferralCheckConversionRow) {
  return classifyErpConversionCheck({
    brbyteIdInteressado: row.brbyte_id_interessado,
    brbyteClientPk: row.brbyte_client_pk,
    brbyteSyncStatus: row.brbyte_sync_status,
    currentStatus: row.status,
    currentPipelineStage: row.pipeline_stage,
    normalizeSyncStatus: normalizeBrbyteSyncStatus,
  })
}

async function insertCommercialConversionHistory(input: {
  referralId: string
  actorUserId: string | null
  commercial: ReturnType<typeof deriveCommercialStateFromErpConversion>
  clientPk: string | null
  syncRunId: string | null
}): Promise<void> {
  const row = buildCommercialConversionHistoryInsert(input)
  if (!row) return

  const { error } = await getDb().from("referral_history").insert(row)
  if (error) {
    console.error(LOG_TAG, {
      step: "referral_history_commercial",
      message: error.message,
    })
  }
}

function syncRunAuditMeta(input: {
  referralId: string
  endpoint: string
  httpStatus?: number | null
  success?: boolean
  converted?: boolean
  error?: string
  triggeredBy?: string
}): Record<string, unknown> {
  return {
    phase: CHECK_CONVERSION_PHASE,
    referral_id: input.referralId,
    triggered_by: input.triggeredBy ?? "admin_manual",
    endpoint: input.endpoint,
    http_status: input.httpStatus ?? null,
    success: input.success ?? false,
    converted: input.converted ?? false,
    error: input.error ?? null,
  }
}

async function persistReferralConversionFromCheck(
  referralId: string,
  patch: {
    clientPk: string
    resolution: ReturnType<typeof extractListInterestResolution>
    payload: Record<string, unknown>
    syncRunId: string | null
    httpStatus: number | null
    syncedAtIso: string
    actorUserId: string | null
    currentStatus: string | null
    currentPipelineStage: string | null
    currentWonAt: string | null
  }
): Promise<{ ok: boolean; commercialUpdated: boolean }> {
  const commercial = deriveCommercialStateFromErpConversion({
    erpConverted: true,
    currentStatus: patch.currentStatus,
    currentPipelineStage: patch.currentPipelineStage,
  })

  const updatePayload = buildConvertedReferralUpdate({
    commercial,
    clientPk: patch.clientPk,
    resolution: patch.resolution,
    payload: patch.payload,
    syncRunId: patch.syncRunId,
    httpStatus: patch.httpStatus,
    syncedAtIso: patch.syncedAtIso,
    listClientInterestEndpoint: BRBYTE_API_PATHS.listClientInterest,
    currentWonAt: patch.currentWonAt,
  })

  const { error } = await getDb()
    .from("referrals")
    .update(updatePayload)
    .eq("id", referralId)

  if (error) {
    console.error(LOG_TAG, { step: "persist_conversion", message: error.message })
    return { ok: false, commercialUpdated: false }
  }

  await insertCommercialConversionHistory({
    referralId,
    actorUserId: patch.actorUserId,
    commercial,
    clientPk: patch.clientPk,
    syncRunId: patch.syncRunId,
  })

  return { ok: true, commercialUpdated: commercial.needsCommercialUpdate }
}

async function repairCommercialStateForConvertedReferral(input: {
  row: ReferralCheckConversionRow
  actorUserId: string | null
  syncRunId: string | null
}): Promise<{ ok: boolean; updated: boolean; message: string }> {
  const commercial = deriveCommercialStateFromErpConversion({
    erpConverted: true,
    currentStatus: input.row.status,
    currentPipelineStage: input.row.pipeline_stage,
  })

  const repairPayload = buildCommercialRepairUpdate({
    commercial,
    syncedAtIso: new Date().toISOString(),
    currentWonAt: input.row.won_at,
  })

  if (!repairPayload) {
    return {
      ok: true,
      updated: false,
      message: "Estado comercial já alinhado à conversão Controllr.",
    }
  }

  const { error } = await getDb()
    .from("referrals")
    .update(repairPayload)
    .eq("id", input.row.id)

  if (error) {
    console.error(LOG_TAG, { step: "repair_commercial", message: error.message })
    return {
      ok: false,
      updated: false,
      message: `Falha ao alinhar status/pipeline após conversão ERP: ${error.message}`,
    }
  }

  await insertCommercialConversionHistory({
    referralId: input.row.id,
    actorUserId: input.actorUserId,
    commercial,
    clientPk: input.row.brbyte_client_pk,
    syncRunId: input.syncRunId,
  })

  await logBrbyteReferralHistory({
    referralId: input.row.id,
    phase: CHECK_CONVERSION_PHASE,
    oldStatus: normalizeBrbyteSyncStatus(input.row.brbyte_sync_status),
    newStatus: "converted",
    message:
      "Estado comercial alinhado à conversão Controllr (reparo idempotente).",
    payload: {
      action: "erp_conversion_commercial_repair",
      old_status: commercial.previousStatus,
      new_status: commercial.targetStatus,
      old_pipeline_stage: commercial.previousPipelineStage,
      new_pipeline_stage: commercial.targetPipelineStage,
      brbyte_client_pk: input.row.brbyte_client_pk,
      reward_created: false,
      wallet_credited: false,
    },
    createdBy: input.actorUserId,
  })

  return {
    ok: true,
    updated: true,
    message:
      "Estado comercial sincronizado a partir da conversão já confirmada no Controllr.",
  }
}

async function persistReferralCheckPending(
  referralId: string,
  patch: {
    payload: Record<string, unknown>
    syncRunId: string | null
    httpStatus: number | null
    checkedAtIso: string
    interestPk: string
  }
): Promise<boolean> {
  const { error } = await getDb()
    .from("referrals")
    .update({
      brbyte_sync_status: "created",
      brbyte_sync_error: null,
      brbyte_last_sync_at: patch.checkedAtIso,
      brbyte_last_http_status: patch.httpStatus,
      brbyte_last_endpoint: BRBYTE_API_PATHS.listClientInterest,
      brbyte_interessado_payload: {
        action: "check_conversion",
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        converted: false,
        interest_pk: patch.interestPk,
        response: patch.payload,
        sync_run_id: patch.syncRunId,
        checked_at: patch.checkedAtIso,
      },
    })
    .eq("id", referralId)

  if (error) {
    console.error(LOG_TAG, { step: "persist_check_pending", message: error.message })
    return false
  }

  return true
}

export async function checkBrbyteInterestConversionFromReferral(input: {
  referralId: string
  actorUserId?: string | null
  triggeredBy?: "admin_manual" | "cron_automatic"
}): Promise<BrbyteCheckConversionResult> {
  const started = Date.now()
  const referralId = input.referralId.trim()
  const triggeredBy = input.triggeredBy ?? "admin_manual"
  const isCron = triggeredBy === "cron_automatic"

  if (isCron) {
    if (!isBrbyteAutoCheckConversionEnabled()) {
      return {
        ok: false,
        converted: false,
        skipped: true,
        reason: "disabled",
        referralId,
        syncRunId: null,
        brbyteClientPk: null,
        brbyteIdInteressado: null,
        message: "Verificação automática de conversão desabilitada.",
        durationMs: Date.now() - started,
      }
    }
  } else if (!isBrbyteCreateInterestEnabled()) {
    return {
      ok: false,
      converted: false,
      skipped: true,
      reason: "disabled",
      referralId,
      syncRunId: null,
      brbyteClientPk: null,
      brbyteIdInteressado: null,
      message: "Integração BRByte desabilitada neste ambiente.",
      durationMs: Date.now() - started,
    }
  }

  const config = isCron
    ? getBrbyteOperationalConfig()
    : getBrbyteCreateInterestConfig()
  if (!config) {
    return {
      ok: false,
      converted: false,
      skipped: true,
      reason: "not_configured",
      referralId,
      syncRunId: null,
      brbyteClientPk: null,
      brbyteIdInteressado: null,
      message: "Integração BRByte incompleta. Verifique variáveis de ambiente.",
      durationMs: Date.now() - started,
    }
  }

  const syncRunId = await createSyncRun(
    referralId,
    input.actorUserId ?? null,
    true,
    triggeredBy
  )

  const row = await loadReferralForCheckConversion(referralId)
  if (!row) {
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: null,
      processed: 0,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { message: "referral_not_found" },
    })
    return {
      ok: false,
      converted: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: null,
      message: "Indicação não encontrada.",
      durationMs: Date.now() - started,
    }
  }

  const interestPk = row.brbyte_id_interessado?.trim() ?? null
  const gate = classifyReferralForCheck(row)

  if (gate.kind === "invalid") {
    await finishSyncRun(syncRunId, {
      status: "skipped",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: null,
      processed: 0,
      skipped_records: 1,
      errors_count: 0,
      duration_ms: Date.now() - started,
      error_summary: { message: gate.message },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        success: false,
        converted: false,
        error: gate.message,
      }),
    })
    return {
      ok: false,
      converted: false,
      skipped: true,
      reason: "validation",
      referralId,
      syncRunId,
      brbyteClientPk: row.brbyte_client_pk,
      brbyteIdInteressado: interestPk,
      message: gate.message,
      durationMs: Date.now() - started,
    }
  }

  if (gate.kind === "already_synced") {
    await finishSyncRun(syncRunId, {
      status: "skipped",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: null,
      processed: 0,
      skipped_records: 1,
      duration_ms: Date.now() - started,
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        success: true,
        converted: true,
      }),
    })
    return {
      ok: true,
      converted: true,
      skipped: true,
      reason: "already_converted",
      referralId,
      syncRunId,
      brbyteClientPk: row.brbyte_client_pk,
      brbyteIdInteressado: interestPk,
      message:
        "Conversão Controllr e estado comercial já sincronizados (idempotente).",
      durationMs: Date.now() - started,
    }
  }

  if (gate.kind === "repair_commercial") {
    const repaired = await repairCommercialStateForConvertedReferral({
      row,
      actorUserId: input.actorUserId ?? null,
      syncRunId,
    })
    await finishSyncRun(syncRunId, {
      status: repaired.ok ? "ok" : "error",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: null,
      processed: repaired.updated ? 1 : 0,
      errors_count: repaired.ok ? 0 : 1,
      duration_ms: Date.now() - started,
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        success: repaired.ok,
        converted: true,
        error: repaired.ok ? undefined : repaired.message,
      }),
    })
    return {
      ok: repaired.ok,
      converted: true,
      referralId,
      syncRunId,
      brbyteClientPk: row.brbyte_client_pk,
      brbyteIdInteressado: interestPk,
      message: repaired.message,
      durationMs: Date.now() - started,
    }
  }

  const login = await brbyteAdminLogin(config)
  if ("error" in login) {
    const message = `Falha ao autenticar na BRByte: ${login.error}`
    const oldStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
    await logBrbyteReferralHistory({
      referralId,
      phase: "login",
      oldStatus,
      newStatus: oldStatus,
      endpoint: LOGIN_ENDPOINT,
      httpStatus: login.httpStatus,
      message: login.error,
      createdBy: input.actorUserId ?? null,
    })
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: "login",
      api_reachable: false,
      processed: 0,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: {
        message: login.error,
        step: "login",
        http_status: login.httpStatus,
      },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: LOGIN_ENDPOINT,
        httpStatus: login.httpStatus,
        success: false,
        converted: false,
        error: login.error,
      }),
    })
    return {
      ok: false,
      converted: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: interestPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const lookup = await lookupClientInterestByInterestPk({
    config,
    cookie: login.cookie,
    interestPk: interestPk!,
  })

  if (!lookup.payload || lookup.httpStatus !== 200) {
    const message = resolveListInterestErrorMessage(lookup.payload)
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: lookup.httpStatus !== null,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { message },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        httpStatus: lookup.httpStatus,
        success: false,
        converted: false,
        error: message,
      }),
    })
    return {
      ok: false,
      converted: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: interestPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const payload = lookup.payload
  const oldStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)

  if (!isListInterestResponseSuccessful(lookup.payload, lookup.httpStatus)) {
    const message = resolveListInterestErrorMessage(lookup.payload)
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: lookup.httpStatus !== null,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { message, response: payload },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        httpStatus: lookup.httpStatus,
        success: false,
        converted: false,
        error: message,
      }),
    })
    return {
      ok: false,
      converted: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: interestPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const resolution =
    lookup.resolution ?? extractListInterestResolution(lookup.payload)
  const nowIso = new Date().toISOString()

  if (!resolution.clientPk) {
    await persistReferralCheckPending(referralId, {
      payload,
      syncRunId,
      httpStatus: lookup.httpStatus,
      checkedAtIso: nowIso,
      interestPk: interestPk!,
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CHECK_CONVERSION_PHASE,
      oldStatus,
      newStatus: "created",
      endpoint: BRBYTE_API_PATHS.listClientInterest,
      httpStatus: lookup.httpStatus,
      message: NOT_CONVERTED_MESSAGE,
      payload: { response: payload, converted: false },
      createdBy: input.actorUserId ?? null,
    })
    await finishSyncRun(syncRunId, {
      status: "ok",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: true,
      processed: 1,
      skipped_records: 1,
      errors_count: 0,
      duration_ms: Date.now() - started,
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        httpStatus: lookup.httpStatus,
        success: true,
        converted: false,
      }),
    })

    return {
      ok: true,
      converted: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: resolution.interestPk ?? interestPk,
      message: NOT_CONVERTED_MESSAGE,
      durationMs: Date.now() - started,
    }
  }

  const persisted = await persistReferralConversionFromCheck(referralId, {
    clientPk: resolution.clientPk,
    resolution,
    payload,
    syncRunId,
    httpStatus: lookup.httpStatus,
    syncedAtIso: nowIso,
    actorUserId: input.actorUserId ?? null,
    currentStatus: row.status,
    currentPipelineStage: row.pipeline_stage,
    currentWonAt: row.won_at,
  })

  if (!persisted.ok) {
    await finishSyncRun(syncRunId, {
      status: "partial",
      phase: CHECK_CONVERSION_PHASE,
      api_reachable: true,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: {
        message: "Conversão detectada no Controllr, mas falha ao salvar no banco.",
        client_pk: resolution.clientPk,
      },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        httpStatus: lookup.httpStatus,
        success: false,
        converted: true,
        error: "persist_failed",
      }),
    })
    return {
      ok: false,
      converted: true,
      referralId,
      syncRunId,
      brbyteClientPk: resolution.clientPk,
      brbyteIdInteressado: resolution.interestPk ?? interestPk,
      message:
        "Conversão detectada no Controllr, mas não foi possível salvar o vínculo localmente.",
      durationMs: Date.now() - started,
    }
  }

  await logBrbyteReferralHistory({
    referralId,
    phase: CHECK_CONVERSION_PHASE,
    oldStatus,
    newStatus: "converted",
    endpoint: BRBYTE_API_PATHS.listClientInterest,
    httpStatus: lookup.httpStatus,
    message: "Interessado convertido em cliente no Controllr.",
    payload: {
      client_pk: resolution.clientPk,
      interest_pk: resolution.interestPk ?? interestPk,
      plan_pk: resolution.planPk,
      address_pk: resolution.addressPk,
      email_pk: resolution.emailPk,
      ticket_pk: resolution.ticketPk,
      sync_run_id: syncRunId,
    },
    createdBy: input.actorUserId ?? null,
  })

  await finishSyncRun(syncRunId, {
    status: "ok",
    phase: CHECK_CONVERSION_PHASE,
    api_reachable: true,
    processed: 1,
    errors_count: 0,
    duration_ms: Date.now() - started,
    meta: syncRunAuditMeta({
      referralId,
      endpoint: BRBYTE_API_PATHS.listClientInterest,
      httpStatus: lookup.httpStatus,
      success: true,
      converted: true,
    }),
  })

  console.log(LOG_TAG, {
    step: "converted_detected",
    referralId,
    brbyteClientPk: resolution.clientPk,
    brbyteIdInteressado: resolution.interestPk ?? interestPk,
    syncRunId,
  })

  return {
    ok: true,
    converted: true,
    referralId,
    syncRunId,
    brbyteClientPk: resolution.clientPk,
    brbyteIdInteressado: resolution.interestPk ?? interestPk,
    message: "Interessado convertido em cliente no Controllr.",
    durationMs: Date.now() - started,
  }
}
