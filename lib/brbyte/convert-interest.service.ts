import "server-only"

import { brbyteAdminLogin, brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import {
  getBrbyteCreateInterestConfig,
  isBrbyteCreateInterestEnabled,
} from "@/lib/brbyte/config"
import {
  extractConvertInterestResolution,
  isConvertInterestResponseSuccessful,
  isPhoneDuplicatedConvertError,
  logConvertInterestResponseBody,
  resolveConvertInterestErrorMessage,
} from "@/lib/brbyte/convert-interest-response"
import { logBrbyteReferralHistory } from "@/lib/brbyte/referral-history"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  BRBYTE_API_PATHS,
  type BrbyteConvertInterestResult,
  type BrbyteSyncRunPhase,
  type BrbyteSyncRunStatus,
} from "@/types/brbyte"
import { normalizeBrbyteSyncStatus, type BrbyteSyncStatus } from "@/types/referral"

const LOG_TAG = "[brbyte:convert-interest]"
const LOGIN_ENDPOINT = "/login"
const CONVERT_INTEREST_PHASE: BrbyteSyncRunPhase = "convert_interest"

type ReferralConvertInterestRow = {
  id: string
  brbyte_id_interessado: string | null
  brbyte_client_pk: string | null
  brbyte_sync_status: string | null
  brbyte_sync_attempts: number | null
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
    }
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
          data: ReferralConvertInterestRow | null
          error: { message: string } | null
        }>
      }
    }
  }
}

function getDb(): BrbyteLooseDb {
  return createServiceRoleClient() as unknown as BrbyteLooseDb
}

function buildConvertInterestForm(interestPk: string): Record<string, string> {
  return {
    interest_pk: interestPk,
    desc: `Convert Interessado - #${interestPk}?`,
    add_address: "1",
    add_phone: "0",
    add_email: "1",
    add_support: "1",
  }
}

async function createSyncRun(
  referralId: string,
  actorUserId: string | null,
  configured: boolean
): Promise<string | null> {
  try {
    const { data, error } = await getDb()
      .from("brbyte_sync_runs")
      .insert({
        status: "running",
        configured,
        phase: CONVERT_INTEREST_PHASE,
        meta: {
          phase: CONVERT_INTEREST_PHASE,
          referral_id: referralId,
          triggered_by: "admin_manual",
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
        phase: patch.phase ?? CONVERT_INTEREST_PHASE,
        finished_at: new Date().toISOString(),
        meta: {
          phase: CONVERT_INTEREST_PHASE,
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

async function loadReferralForConvertInterest(
  referralId: string
): Promise<ReferralConvertInterestRow | null> {
  const { data, error } = await getDb()
    .from("referrals")
    .select(
      `
      id,
      brbyte_id_interessado,
      brbyte_client_pk,
      brbyte_sync_status,
      brbyte_sync_attempts
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

function validateReferralForConvert(row: ReferralConvertInterestRow): string | null {
  const interestPk = row.brbyte_id_interessado?.trim()
  if (!interestPk) {
    return "Esta indicação ainda não possui Interessado vinculado no Controllr."
  }

  if (row.brbyte_client_pk?.trim()) {
    return "Esta indicação já possui cliente vinculado no Controllr."
  }

  const syncStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
  if (syncStatus === "converted") {
    return "Interessado já foi convertido em cliente no Controllr."
  }

  if (syncStatus !== "created") {
    return "A conversão só está disponível quando o status da integração é Interessado criado."
  }

  return null
}

function syncRunAuditMeta(input: {
  referralId: string
  endpoint: string
  httpStatus?: number | null
  success?: boolean
  error?: string
  request?: Record<string, string>
}): Record<string, unknown> {
  return {
    phase: CONVERT_INTEREST_PHASE,
    referral_id: input.referralId,
    triggered_by: "admin_manual",
    endpoint: input.endpoint,
    http_status: input.httpStatus ?? null,
    success: input.success ?? false,
    error: input.error ?? null,
    request: input.request ?? null,
  }
}

async function persistReferralConversion(
  referralId: string,
  patch: {
    clientPk: string
    resolution: ReturnType<typeof extractConvertInterestResolution>
    payload: Record<string, unknown>
    request: Record<string, string>
    syncRunId: string | null
    httpStatus: number | null
    syncedAtIso: string
  }
): Promise<boolean> {
  const { error } = await getDb()
    .from("referrals")
    .update({
      brbyte_client_pk: patch.clientPk,
      brbyte_id_cliente: patch.clientPk,
      brbyte_client_synced_at: patch.syncedAtIso,
      brbyte_interessado_payload: {
        action: "convert_interest",
        endpoint: BRBYTE_API_PATHS.convertClientInterest,
        interest_pk: patch.resolution.interestPk,
        client_pk: patch.resolution.clientPk,
        plan_pk: patch.resolution.planPk,
        address_pk: patch.resolution.addressPk,
        email_pk: patch.resolution.emailPk,
        ticket_pk: patch.resolution.ticketPk,
        request: patch.request,
        response: patch.payload,
        result: patch.resolution.rawResult,
        sync_run_id: patch.syncRunId,
      },
      brbyte_sync_status: "converted",
      brbyte_sync_error: null,
      brbyte_last_sync_at: patch.syncedAtIso,
      brbyte_last_error_at: null,
      brbyte_last_http_status: patch.httpStatus,
      brbyte_last_endpoint: BRBYTE_API_PATHS.convertClientInterest,
    })
    .eq("id", referralId)

  if (error) {
    console.error(LOG_TAG, { step: "persist_conversion", message: error.message })
    return false
  }

  return true
}

async function persistReferralConvertError(
  referralId: string,
  currentAttempts: number,
  patch: {
    message: string
    httpStatus: number | null
    payload: Record<string, unknown>
  }
): Promise<void> {
  await getDb()
    .from("referrals")
    .update({
      brbyte_sync_status: "error",
      brbyte_sync_error: patch.message,
      brbyte_sync_attempts: currentAttempts + 1,
      brbyte_last_endpoint: BRBYTE_API_PATHS.convertClientInterest,
      brbyte_last_http_status: patch.httpStatus,
      brbyte_last_error_at: new Date().toISOString(),
    })
    .eq("id", referralId)
}

export async function convertBrbyteInterestFromReferral(input: {
  referralId: string
  actorUserId?: string | null
}): Promise<BrbyteConvertInterestResult> {
  const started = Date.now()
  const referralId = input.referralId.trim()

  if (!isBrbyteCreateInterestEnabled()) {
    return {
      ok: false,
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

  const config = getBrbyteCreateInterestConfig()
  if (!config) {
    return {
      ok: false,
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
    true
  )

  const row = await loadReferralForConvertInterest(referralId)
  if (!row) {
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CONVERT_INTEREST_PHASE,
      api_reachable: null,
      processed: 0,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { message: "referral_not_found" },
    })
    return {
      ok: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: null,
      message: "Indicação não encontrada.",
      durationMs: Date.now() - started,
    }
  }

  const currentAttempts =
    typeof row.brbyte_sync_attempts === "number" ? row.brbyte_sync_attempts : 0
  const interestPk = row.brbyte_id_interessado?.trim() ?? null

  const validationError = validateReferralForConvert(row)
  if (validationError) {
    await finishSyncRun(syncRunId, {
      status: "skipped",
      phase: CONVERT_INTEREST_PHASE,
      api_reachable: null,
      processed: 0,
      skipped_records: 1,
      errors_count: 0,
      duration_ms: Date.now() - started,
      error_summary: { message: validationError },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.convertClientInterest,
        success: false,
        error: validationError,
      }),
    })
    return {
      ok: false,
      skipped: true,
      reason: "validation",
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: interestPk,
      message: validationError,
      durationMs: Date.now() - started,
    }
  }

  const login = await brbyteAdminLogin(config)
  if ("error" in login) {
    const message = `Falha ao autenticar na BRByte: ${login.error}`
    const oldStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
    await persistReferralConvertError(referralId, currentAttempts, {
      message: login.error,
      httpStatus: login.httpStatus,
      payload: { step: "login" },
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: "login",
      oldStatus,
      newStatus: "error",
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
        error: login.error,
      }),
    })
    return {
      ok: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: interestPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const form = buildConvertInterestForm(interestPk!)
  const apiResult = await brbyteAdminPostForm(
    config,
    login.cookie,
    BRBYTE_API_PATHS.convertClientInterest,
    form
  )

  const payload =
    apiResult.json && typeof apiResult.json === "object"
      ? (apiResult.json as Record<string, unknown>)
      : { raw: apiResult.json }

  logConvertInterestResponseBody(apiResult.status, apiResult.json)

  const oldStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)

  if (
    !apiResult.ok ||
    !isConvertInterestResponseSuccessful(apiResult.json, apiResult.status)
  ) {
    const message = resolveConvertInterestErrorMessage(
      apiResult.json,
      apiResult.message
    )

    await persistReferralConvertError(referralId, currentAttempts, {
      message,
      httpStatus: apiResult.status,
      payload,
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CONVERT_INTEREST_PHASE,
      oldStatus,
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.convertClientInterest,
      httpStatus: apiResult.status,
      message,
      payload: {
        response: payload,
        phone_duplicated: isPhoneDuplicatedConvertError(apiResult.json),
      },
      createdBy: input.actorUserId ?? null,
    })
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CONVERT_INTEREST_PHASE,
      api_reachable: true,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: {
        message,
        httpStatus: apiResult.status,
        response: payload,
      },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.convertClientInterest,
        httpStatus: apiResult.status,
        success: false,
        error: message,
        request: form,
      }),
    })

    return {
      ok: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: interestPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const resolution = extractConvertInterestResolution(apiResult.json)
  if (!resolution.clientPk) {
    const message =
      "Controllr respondeu com sucesso, mas sem client_pk. Verifique manualmente no ERP."

    await persistReferralConvertError(referralId, currentAttempts, {
      message,
      httpStatus: apiResult.status,
      payload,
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CONVERT_INTEREST_PHASE,
      oldStatus,
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.convertClientInterest,
      httpStatus: apiResult.status,
      message,
      payload: { response: payload },
      createdBy: input.actorUserId ?? null,
    })
    await finishSyncRun(syncRunId, {
      status: "partial",
      phase: CONVERT_INTEREST_PHASE,
      api_reachable: true,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { message, response: payload },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.convertClientInterest,
        httpStatus: apiResult.status,
        success: false,
        error: message,
        request: form,
      }),
    })

    return {
      ok: false,
      referralId,
      syncRunId,
      brbyteClientPk: null,
      brbyteIdInteressado: interestPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const nowIso = new Date().toISOString()
  const persisted = await persistReferralConversion(referralId, {
    clientPk: resolution.clientPk,
    resolution,
    payload,
    request: form,
    syncRunId,
    httpStatus: apiResult.status,
    syncedAtIso: nowIso,
  })

  if (!persisted) {
    await finishSyncRun(syncRunId, {
      status: "partial",
      phase: CONVERT_INTEREST_PHASE,
      api_reachable: true,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: {
        message: "Conversão realizada no Controllr, mas falha ao salvar no banco.",
        client_pk: resolution.clientPk,
      },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.convertClientInterest,
        httpStatus: apiResult.status,
        success: false,
        error: "persist_failed",
        request: form,
      }),
    })
    return {
      ok: false,
      referralId,
      syncRunId,
      brbyteClientPk: resolution.clientPk,
      brbyteIdInteressado: resolution.interestPk ?? interestPk,
      message:
        "Interessado convertido no Controllr, mas não foi possível salvar o vínculo localmente.",
      durationMs: Date.now() - started,
    }
  }

  await logBrbyteReferralHistory({
    referralId,
    phase: CONVERT_INTEREST_PHASE,
    oldStatus,
    newStatus: "converted",
    endpoint: BRBYTE_API_PATHS.convertClientInterest,
    httpStatus: apiResult.status,
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
    phase: CONVERT_INTEREST_PHASE,
    api_reachable: true,
    processed: 1,
    errors_count: 0,
    duration_ms: Date.now() - started,
    meta: syncRunAuditMeta({
      referralId,
      endpoint: BRBYTE_API_PATHS.convertClientInterest,
      httpStatus: apiResult.status,
      success: true,
      request: form,
    }),
  })

  console.log(LOG_TAG, {
    step: "converted",
    referralId,
    brbyteClientPk: resolution.clientPk,
    brbyteIdInteressado: resolution.interestPk ?? interestPk,
    syncRunId,
  })

  return {
    ok: true,
    referralId,
    syncRunId,
    brbyteClientPk: resolution.clientPk,
    brbyteIdInteressado: resolution.interestPk ?? interestPk,
    message: "Interessado convertido em cliente no Controllr.",
    durationMs: Date.now() - started,
  }
}
