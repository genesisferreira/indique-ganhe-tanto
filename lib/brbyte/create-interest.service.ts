import "server-only"

import { buildBrbyteInterestedObservation } from "@/lib/brbyte/interested-observation"
import {
  buildPublicPreRegistrationObservation,
  summarizeUtmCampaign,
  type PreferredInstallationPeriod,
  type PreferredContactPeriod,
} from "@/lib/public-pre-registration/observation"
import {
  BRBYTE_UNCONFIRMED_INTEREST_MESSAGE,
  extractInterestResolution,
  isCreateInterestResponseSuccessful,
  isUnconfirmedBrbyteCreateError,
  logCreateInterestResponseBody,
  lookupClientInterestByDocument,
  type BrbyteInterestResolution,
} from "@/lib/brbyte/create-interest-response"
import { truncateBrbyteField } from "@/lib/brbyte/truncate-field"
import { brbyteAdminLogin, brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import {
  getBrbyteCreateInterestConfig,
  getBrbyteCreateInterestConfigForIntegration,
  isBrbyteCreateInterestEnabled,
  type BrbyteCreateInterestConfig,
} from "@/lib/brbyte/config"
import { resolveBrbytePlanPkForReferral } from "@/lib/brbyte/plan-mapping"
import { logBrbyteReferralHistory } from "@/lib/brbyte/referral-history"
import { splitPersonName } from "@/lib/brbyte/split-name"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { isReferralContractType } from "@/lib/referral-contract-type"
import { getPublicPreRegistrationDefaultBrbytePlanPk } from "@/lib/public-pre-registration/config"
import {
  formatPublicOfferPrice,
  getPublicPreRegistrationOfferByCode,
} from "@/lib/public-pre-registration/offers"
import {
  BRBYTE_API_PATHS,
  type BrbyteCreateInterestResult,
  type BrbyteSyncRunPhase,
  type BrbyteSyncRunStatus,
} from "@/types/brbyte"
import { normalizeBrbyteSyncStatus, type BrbyteSyncStatus } from "@/types/referral"
import {
  PUBLIC_PRE_REGISTRATION_SOURCE,
  isPublicPreRegistrationReferral,
} from "@/lib/referral-reward-eligibility"

export type BrbyteCreateInterestSourceContext = "referral" | "public_pre_registration"

const LOG_TAG = "[brbyte:create-interest]"
const LOGIN_ENDPOINT = "/login"
const CREATE_INTEREST_PHASE: BrbyteSyncRunPhase = "create_interest"
const MAX_UI_RETRY_ATTEMPTS = 3

export { MAX_UI_RETRY_ATTEMPTS as BRBYTE_CREATE_INTEREST_MAX_RETRY_ATTEMPTS }

type ReferralCreateInterestRow = {
  id: string
  referred_name: string
  referred_phone: string
  referred_email: string | null
  referred_document: string | null
  referred_rg: string | null
  referred_person_type: string | null
  referred_zipcode: string | null
  referred_state: string | null
  referred_city: string | null
  referred_neighborhood: string | null
  referred_street: string | null
  referred_number: string | null
  referred_complement: string | null
  referred_observation: string | null
  referred_address: string | null
  erp_lead_source: string | null
  source: string | null
  preferred_installation_period: string | null
  preferred_contact_period: string | null
  phone_has_whatsapp: boolean | null
  source_page: string | null
  public_offer_code: string | null
  public_offer_name: string | null
  public_offer_price: number | string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  gclid: string | null
  fbclid: string | null
  ref_code: string | null
  referral_contract_type: string | null
  reward_type: string | null
  installation_fee_awareness: boolean | null
  contract_type_awareness: boolean | null
  brbyte_id_interessado: string | null
  brbyte_interessado_status: string | null
  brbyte_sync_status: string | null
  brbyte_sync_error: string | null
  brbyte_sync_attempts: number | null
  plan_id: string
  plans:
    | { name: string; speed_label?: string | null }
    | { name: string; speed_label?: string | null }[]
    | null
  indicator:
    | { full_name: string | null }
    | { full_name: string | null }[]
    | null
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
          data: ReferralCreateInterestRow | null
          error: { message: string } | null
        }>
      }
    }
  }
}

function getDb(): BrbyteLooseDb {
  return createServiceRoleClient() as unknown as BrbyteLooseDb
}

function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "")
}

function planFieldsFromRow(row: ReferralCreateInterestRow): {
  name: string | null
  code: string | null
} {
  const plans = row.plans
  if (!plans) return { name: null, code: null }
  const plan = Array.isArray(plans) ? plans[0] : plans
  return {
    name: plan?.name?.trim() || null,
    code: plan?.speed_label?.trim() || null,
  }
}

function indicatorNameFromRow(row: ReferralCreateInterestRow): string | null {
  const indicator = row.indicator
  if (!indicator) return null
  const profile = Array.isArray(indicator) ? indicator[0] : indicator
  return profile?.full_name?.trim() || null
}

function requestFallbackFromForm(form: Record<string, string>): {
  leadPk: string | null
  planPk: string | null
} {
  return {
    leadPk: form.lead_pk?.trim() || null,
    planPk: form.plan_pk?.trim() || null,
  }
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
        phase: CREATE_INTEREST_PHASE,
        meta: {
          phase: CREATE_INTEREST_PHASE,
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
        phase: patch.phase ?? CREATE_INTEREST_PHASE,
        finished_at: new Date().toISOString(),
        meta: {
          phase: CREATE_INTEREST_PHASE,
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

async function loadReferralForCreateInterest(
  referralId: string
): Promise<ReferralCreateInterestRow | null> {
  const { data, error } = await getDb()
    .from("referrals")
    .select(
      `
      id,
      referred_name,
      referred_phone,
      referred_email,
      referred_document,
      referred_rg,
      referred_person_type,
      referred_zipcode,
      referred_state,
      referred_city,
      referred_neighborhood,
      referred_street,
      referred_number,
      referred_complement,
      referred_observation,
      referred_address,
      erp_lead_source,
      source,
      preferred_installation_period,
      preferred_contact_period,
      phone_has_whatsapp,
      source_page,
      public_offer_code,
      public_offer_name,
      public_offer_price,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      gclid,
      fbclid,
      ref_code,
      referral_contract_type,
      reward_type,
      installation_fee_awareness,
      contract_type_awareness,
      brbyte_id_interessado,
      brbyte_interessado_status,
      brbyte_sync_status,
      brbyte_sync_error,
      brbyte_sync_attempts,
      plan_id,
      plans:plan_id ( name, speed_label ),
      indicator:indicator_profile_id ( full_name )
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

function buildCreateInterestForm(
  row: ReferralCreateInterestRow,
  config: BrbyteCreateInterestConfig,
  planPk: string
): Record<string, string> {
  const { firstName, lastName } = splitPersonName(row.referred_name)
  const contractType = isReferralContractType(row.referral_contract_type?.trim())
    ? row.referral_contract_type!.trim()
    : "tanto_vantagens"
  const { name: planoNome } = planFieldsFromRow(row)
  const isPublic = isPublicPreRegistrationReferral({
    source: row.source,
    erp_lead_source: row.erp_lead_source,
  })

  const catalogOffer = getPublicPreRegistrationOfferByCode(row.public_offer_code)
  const offerName =
    row.public_offer_name?.trim() ||
    catalogOffer?.name ||
    planoNome ||
    "Não informado"
  const offerPriceLabel =
    catalogOffer?.displayPrice ||
    formatPublicOfferPrice(
      row.public_offer_price != null ? Number(row.public_offer_price) : null
    ) ||
    "Não informado"

  const interestObsBuild = isPublic
    ? buildPublicPreRegistrationObservation({
        preferredInstallationPeriod:
          (row.preferred_installation_period as PreferredInstallationPeriod) ??
          "no_preference",
        offerName,
        offerPriceLabel,
        phoneHasWhatsapp: row.phone_has_whatsapp === true,
        preferredContactPeriod:
          (row.preferred_contact_period as PreferredContactPeriod) ?? null,
        campaignSummary: summarizeUtmCampaign({
          utm_source: row.utm_source,
          utm_medium: row.utm_medium,
          utm_campaign: row.utm_campaign,
          utm_content: row.utm_content,
          utm_term: row.utm_term,
          gclid: row.gclid,
          fbclid: row.fbclid,
          ref_code: row.ref_code,
        }),
        observacaoCliente: row.referred_observation,
      })
    : buildBrbyteInterestedObservation({
        erpLeadSource: row.erp_lead_source,
        indicadorNome: indicatorNameFromRow(row),
        tipoContratacao: contractType,
        planoNome,
        tipoRecompensa: row.reward_type,
        cpfIndicado: row.referred_document,
        enderecoInstalacao: row.referred_street,
        numeroInstalacao: row.referred_number,
        bairroInstalacao: row.referred_neighborhood,
        cidadeInstalacao: row.referred_city,
        estadoInstalacao: row.referred_state,
        cepInstalacao: row.referred_zipcode,
        observacaoIndicado: row.referred_observation,
        enderecoIndicado: row.referred_address,
        installationFeeAwareness: row.installation_fee_awareness,
        contractTypeAwareness: row.contract_type_awareness,
      })
  const interestObsResult = truncateBrbyteField(interestObsBuild.value)
  if (interestObsBuild.truncated || interestObsResult.truncated) {
    console.warn(LOG_TAG, {
      step: "interest_obs_truncated",
      originalLength: Math.max(
        interestObsBuild.originalLength,
        interestObsResult.originalLength
      ),
      finalLength: interestObsResult.value.length,
      maxLength: 255,
    })
  }
  const interestObs = interestObsResult.value

  const personType = row.referred_person_type?.trim() === "pj" ? "1" : "0"

  return {
    lead_pk: config.defaultLeadPk,
    interest_status: config.defaultInterestStatus,
    interest_type: personType,
    interest_name: firstName,
    interest_lastname: lastName,
    interest_doc1: onlyDigits(row.referred_document),
    interest_doc2: (row.referred_rg ?? "").trim(),
    interest_phone_number: onlyDigits(row.referred_phone),
    interest_email_addr: (row.referred_email ?? "").trim(),
    interest_addr_zipcode: onlyDigits(row.referred_zipcode),
    interest_addr_state: (row.referred_state ?? "").trim().toUpperCase(),
    interest_addr_city: (row.referred_city ?? "").trim(),
    interest_addr_neighborhood: (row.referred_neighborhood ?? "").trim(),
    interest_addr_address: (row.referred_street ?? "").trim(),
    interest_addr_number: (row.referred_number ?? "").trim(),
    interest_addr_obs: (row.referred_complement ?? "").trim(),
    plan_pk: planPk,
    interest_obs: interestObs,
  }
}

function validateReferralForCreate(row: ReferralCreateInterestRow): string | null {
  const syncStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
  if (isUnconfirmedBrbyteCreateError(row.brbyte_sync_error)) {
    return BRBYTE_UNCONFIRMED_INTEREST_MESSAGE
  }
  if (row.brbyte_id_interessado?.trim() && syncStatus !== "error") {
    return "Esta indicação já possui Interessado vinculado no Controllr."
  }
  if (!row.referred_name?.trim()) {
    return "Nome do indicado é obrigatório."
  }
  if (!onlyDigits(row.referred_document)) {
    return "CPF do indicado é obrigatório para criar Interessado."
  }
  if (!onlyDigits(row.referred_phone)) {
    return "Telefone do indicado é obrigatório."
  }
  return null
}

async function persistReferralSyncState(
  referralId: string,
  currentAttempts: number,
  patch: {
    brbyteSyncStatus: BrbyteSyncStatus
    brbyteSyncError?: string | null
    brbyteLastEndpoint?: string | null
    brbyteLastHttpStatus?: number | null
    brbyteLastSyncAt?: string | null
    brbyteLastErrorAt?: string | null
    incrementAttempt?: boolean
  }
): Promise<boolean> {
  const nextAttempts =
    currentAttempts + (patch.incrementAttempt === false ? 0 : 1)

  const update: Record<string, unknown> = {
    brbyte_sync_status: patch.brbyteSyncStatus,
    brbyte_sync_error: patch.brbyteSyncError ?? null,
    brbyte_sync_attempts: nextAttempts,
    brbyte_last_endpoint: patch.brbyteLastEndpoint ?? null,
    brbyte_last_http_status: patch.brbyteLastHttpStatus ?? null,
  }

  if (patch.brbyteLastSyncAt) {
    update.brbyte_last_sync_at = patch.brbyteLastSyncAt
  }
  if (patch.brbyteLastErrorAt) {
    update.brbyte_last_error_at = patch.brbyteLastErrorAt
  } else if (patch.brbyteSyncStatus !== "error") {
    update.brbyte_last_error_at = null
  }

  const { error } = await getDb().from("referrals").update(update).eq("id", referralId)

  if (error) {
    console.error(LOG_TAG, { step: "persist_sync_state", message: error.message })
    return false
  }
  return true
}

async function persistReferralInterestLink(
  referralId: string,
  currentAttempts: number,
  patch: {
    brbyteIdInteressado: string
    brbyteInteressadoStatus: string | null
    clientPk?: string | null
    leadPk?: string | null
    planPk?: string | null
    payload: Record<string, unknown>
    createdAtIso: string
    httpStatus: number | null
  }
): Promise<boolean> {
  const nextAttempts = currentAttempts + 1

  const update: Record<string, unknown> = {
    brbyte_id_interessado: patch.brbyteIdInteressado,
    brbyte_interessado_status: patch.brbyteInteressadoStatus,
    brbyte_interessado_created_at: patch.createdAtIso,
    brbyte_interessado_last_sync_at: patch.createdAtIso,
    brbyte_interessado_payload: patch.payload,
    brbyte_sync_status: "created",
    brbyte_sync_error: null,
    brbyte_sync_attempts: nextAttempts,
    brbyte_last_sync_at: patch.createdAtIso,
    brbyte_last_error_at: null,
    brbyte_last_http_status: patch.httpStatus,
    brbyte_last_endpoint: BRBYTE_API_PATHS.createClientInterest,
  }

  if (patch.clientPk?.trim()) {
    update.brbyte_id_cliente = patch.clientPk.trim()
  }

  const { error } = await getDb()
    .from("referrals")
    .update(update)
    .eq("id", referralId)

  if (error) {
    console.error(LOG_TAG, { step: "persist_referral", message: error.message })
    return false
  }
  return true
}

async function persistUnconfirmedReferralInterest(
  referralId: string,
  currentAttempts: number,
  patch: {
    payload: Record<string, unknown>
    httpStatus: number | null
    request: Record<string, string>
  }
): Promise<boolean> {
  const { error } = await getDb()
    .from("referrals")
    .update({
      brbyte_sync_status: "error",
      brbyte_sync_error: BRBYTE_UNCONFIRMED_INTEREST_MESSAGE,
      brbyte_sync_attempts: currentAttempts,
      brbyte_last_endpoint: BRBYTE_API_PATHS.createClientInterest,
      brbyte_last_http_status: patch.httpStatus,
      brbyte_last_error_at: new Date().toISOString(),
      brbyte_interessado_payload: {
        unconfirmed_create: true,
        response: patch.payload,
        request: patch.request,
      },
    })
    .eq("id", referralId)

  if (error) {
    console.error(LOG_TAG, {
      step: "persist_unconfirmed",
      message: error.message,
    })
    return false
  }
  return true
}

function buildInterestPayload(input: {
  resolution: BrbyteInterestResolution
  planPkSource: string
  syncRunId: string | null
  request: Record<string, string>
  response: Record<string, unknown>
}): Record<string, unknown> {
  return {
    action: "create_interest",
    endpoint: BRBYTE_API_PATHS.createClientInterest,
    interest_pk: input.resolution.interestPk,
    client_pk: input.resolution.clientPk,
    lead_pk: input.resolution.leadPk,
    plan_pk: input.resolution.planPk,
    resolution_source: input.resolution.source,
    plan_pk_source: input.planPkSource,
    request: input.request,
    response: input.response,
    sync_run_id: input.syncRunId,
  }
}

function syncRunAuditMeta(input: {
  referralId: string
  endpoint: string
  httpStatus?: number | null
  success?: boolean
  error?: string
  request?: Record<string, string>
  triggeredBy?: string
}): Record<string, unknown> {
  return {
    phase: CREATE_INTEREST_PHASE,
    referral_id: input.referralId,
    triggered_by: input.triggeredBy ?? "admin_manual",
    endpoint: input.endpoint,
    http_status: input.httpStatus ?? null,
    success: input.success ?? false,
    error: input.error ?? null,
    request: input.request ?? null,
  }
}

export async function createBrbyteInterestFromReferral(input: {
  referralId: string
  actorUserId?: string | null
  sourceContext?: BrbyteCreateInterestSourceContext
}): Promise<BrbyteCreateInterestResult> {
  const started = Date.now()
  const referralId = input.referralId.trim()
  const isPublicFlow = input.sourceContext === "public_pre_registration"
  const triggeredBy = isPublicFlow
    ? PUBLIC_PRE_REGISTRATION_SOURCE
    : "admin_manual"

  if (!isPublicFlow && !isBrbyteCreateInterestEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: "disabled",
      referralId,
      syncRunId: null,
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
      message: "Criação de Interessado BRByte está desabilitada.",
      durationMs: Date.now() - started,
    }
  }

  const config = isPublicFlow
    ? getBrbyteCreateInterestConfigForIntegration()
    : getBrbyteCreateInterestConfig()
  if (!config) {
    return {
      ok: false,
      skipped: true,
      reason: "not_configured",
      referralId,
      syncRunId: null,
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
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

  const row = await loadReferralForCreateInterest(referralId)
  if (!row) {
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CREATE_INTEREST_PHASE,
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
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
      message: "Indicação não encontrada.",
      durationMs: Date.now() - started,
    }
  }

  const currentAttempts =
    typeof row.brbyte_sync_attempts === "number" ? row.brbyte_sync_attempts : 0

  const validationError = validateReferralForCreate(row)
  if (validationError) {
    await finishSyncRun(syncRunId, {
      status: "skipped",
      phase: CREATE_INTEREST_PHASE,
      api_reachable: null,
      processed: 0,
      skipped_records: 1,
      errors_count: 0,
      duration_ms: Date.now() - started,
      error_summary: { message: validationError },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.createClientInterest,
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
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
      message: validationError,
      durationMs: Date.now() - started,
    }
  }

  const { name: planName, code: planCode } = planFieldsFromRow(row)
  const isPublicRow = isPublicPreRegistrationReferral({
    source: row.source,
    erp_lead_source: row.erp_lead_source,
  })

  let planPk: string | null = null
  let planResolutionMessage: string | null = null
  let planPkSource: string = "plan_mapping"

  if (isPublicRow) {
    planPk = getPublicPreRegistrationDefaultBrbytePlanPk()
    planPkSource = "public_default_plan_pk"
    if (!planPk) {
      planResolutionMessage =
        "PUBLIC_PRE_REGISTRATION_DEFAULT_BRBYTE_PLAN_PK não configurado"
    }
  } else {
    const planResolution = await resolveBrbytePlanPkForReferral(
      {
        planId: row.plan_id,
        planCode,
        planName,
      },
      config
    )
    if (planResolution.ok) {
      planPk = planResolution.planPk
      planPkSource = planResolution.source
    } else {
      planResolutionMessage = planResolution.message
    }
  }

  if (!planPk) {
    const message =
      planResolutionMessage ?? "Plano Controllr não configurado."
    const oldStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
    await persistReferralSyncState(referralId, currentAttempts, {
      brbyteSyncStatus: "error",
      brbyteSyncError: message,
      brbyteLastEndpoint: BRBYTE_API_PATHS.createClientInterest,
      brbyteLastErrorAt: new Date().toISOString(),
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CREATE_INTEREST_PHASE,
      oldStatus,
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.createClientInterest,
      message,
      payload: { reason: isPublicRow ? "public_default_plan_pk" : "plan_mapping" },
      createdBy: input.actorUserId ?? null,
    })
    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CREATE_INTEREST_PHASE,
      api_reachable: null,
      processed: 0,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { message },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.createClientInterest,
        success: false,
        error: message,
      }),
    })
    return {
      ok: false,
      referralId,
      syncRunId,
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
      message,
      durationMs: Date.now() - started,
    }
  }

  const login = await brbyteAdminLogin(config)
  if ("error" in login) {
    const message = `Falha ao autenticar na BRByte: ${login.error}`
    const oldStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
    await persistReferralSyncState(referralId, currentAttempts, {
      brbyteSyncStatus: "error",
      brbyteSyncError: login.error,
      brbyteLastEndpoint: LOGIN_ENDPOINT,
      brbyteLastHttpStatus: login.httpStatus,
      brbyteLastErrorAt: new Date().toISOString(),
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
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
      message,
      durationMs: Date.now() - started,
    }
  }

  const form = buildCreateInterestForm(row, config, planPk)
  const apiResult = await brbyteAdminPostForm(
    config,
    login.cookie,
    BRBYTE_API_PATHS.createClientInterest,
    form
  )

  const payload =
    apiResult.json && typeof apiResult.json === "object"
      ? (apiResult.json as Record<string, unknown>)
      : { raw: apiResult.json }

  logCreateInterestResponseBody(apiResult.status, apiResult.json)

  if (
    !apiResult.ok ||
    !isCreateInterestResponseSuccessful(apiResult.json, apiResult.status)
  ) {
    const message =
      (typeof payload.message === "string" && payload.message) ||
      apiResult.message ||
      "Falha ao criar Interessado na BRByte."

    await persistReferralSyncState(referralId, currentAttempts, {
      brbyteSyncStatus: "error",
      brbyteSyncError: message,
      brbyteLastEndpoint: BRBYTE_API_PATHS.createClientInterest,
      brbyteLastHttpStatus: apiResult.status,
      brbyteLastErrorAt: new Date().toISOString(),
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CREATE_INTEREST_PHASE,
      oldStatus: normalizeBrbyteSyncStatus(row.brbyte_sync_status),
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.createClientInterest,
      httpStatus: apiResult.status,
      message,
      payload: { response: payload },
      createdBy: input.actorUserId ?? null,
    })

    await finishSyncRun(syncRunId, {
      status: "error",
      phase: CREATE_INTEREST_PHASE,
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
        endpoint: BRBYTE_API_PATHS.createClientInterest,
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
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
      message,
      durationMs: Date.now() - started,
    }
  }

  const requestFallback = requestFallbackFromForm(form)
  let resolution = extractInterestResolution(apiResult.json, requestFallback)

  if (!resolution.interestPk) {
    const lookup = await lookupClientInterestByDocument({
      config,
      cookie: login.cookie,
      interestDoc1: form.interest_doc1,
      requestFallback,
    })
    if (lookup?.interestPk) {
      resolution = lookup
    }
  }

  if (!resolution.interestPk) {
    const message = BRBYTE_UNCONFIRMED_INTEREST_MESSAGE

    await persistUnconfirmedReferralInterest(referralId, currentAttempts, {
      payload,
      httpStatus: apiResult.status,
      request: form,
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CREATE_INTEREST_PHASE,
      oldStatus: normalizeBrbyteSyncStatus(row.brbyte_sync_status),
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.createClientInterest,
      httpStatus: apiResult.status,
      message,
      payload: {
        unconfirmed_create: true,
        response: payload,
      },
      createdBy: input.actorUserId ?? null,
    })

    await finishSyncRun(syncRunId, {
      status: "partial",
      phase: CREATE_INTEREST_PHASE,
      api_reachable: true,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: {
        message,
        response: payload,
        http_status: apiResult.status,
        unconfirmed_create: true,
      },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.createClientInterest,
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
      brbyteIdInteressado: null,
      brbyteInteressadoStatus: null,
      message,
      durationMs: Date.now() - started,
    }
  }

  const brbyteId = resolution.interestPk
  const brbyteStatus =
    resolution.interestStatus ?? config.defaultInterestStatus
  const nowIso = new Date().toISOString()

  const persisted = await persistReferralInterestLink(referralId, currentAttempts, {
    brbyteIdInteressado: brbyteId,
    brbyteInteressadoStatus: brbyteStatus,
    clientPk: resolution.clientPk,
    leadPk: resolution.leadPk,
    planPk: resolution.planPk,
    payload: buildInterestPayload({
      resolution,
      planPkSource,
      syncRunId,
      request: form,
      response: payload,
    }),
    createdAtIso: nowIso,
    httpStatus: apiResult.status,
  })

  if (!persisted) {
    await logBrbyteReferralHistory({
      referralId,
      phase: CREATE_INTEREST_PHASE,
      oldStatus: normalizeBrbyteSyncStatus(row.brbyte_sync_status),
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.createClientInterest,
      httpStatus: apiResult.status,
      message: "Interessado criado na BRByte, mas falha ao salvar no banco.",
      payload: { brbyte_id_interessado: brbyteId },
      createdBy: input.actorUserId ?? null,
    })
    await finishSyncRun(syncRunId, {
      status: "partial",
      phase: CREATE_INTEREST_PHASE,
      api_reachable: true,
      processed: 1,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: {
        message: "Interessado criado na BRByte, mas falha ao salvar no banco.",
        brbyte_id_interessado: brbyteId,
      },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.createClientInterest,
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
      brbyteIdInteressado: brbyteId,
      brbyteInteressadoStatus: brbyteStatus,
      message:
        "Interessado criado na BRByte, mas não foi possível salvar o vínculo localmente.",
      durationMs: Date.now() - started,
    }
  }

  await logBrbyteReferralHistory({
    referralId,
    phase: CREATE_INTEREST_PHASE,
    oldStatus: normalizeBrbyteSyncStatus(row.brbyte_sync_status),
    newStatus: "created",
    endpoint: BRBYTE_API_PATHS.createClientInterest,
    httpStatus: apiResult.status,
    message: "Interessado criado no Controllr com sucesso.",
    payload: {
      brbyte_id_interessado: brbyteId,
      plan_pk_source: planPkSource,
      sync_run_id: syncRunId,
    },
    createdBy: input.actorUserId ?? null,
  })

  await finishSyncRun(syncRunId, {
    status: "ok",
    phase: CREATE_INTEREST_PHASE,
    api_reachable: true,
    processed: 1,
    errors_count: 0,
    duration_ms: Date.now() - started,
    meta: syncRunAuditMeta({
      referralId,
      endpoint: BRBYTE_API_PATHS.createClientInterest,
      httpStatus: apiResult.status,
      success: true,
      request: form,
    }),
  })

  console.log(LOG_TAG, {
    step: "created",
    referralId,
    brbyteIdInteressado: brbyteId,
    resolutionSource: resolution.source,
    syncRunId,
    planPkSource,
  })

  return {
    ok: true,
    referralId,
    syncRunId,
    brbyteIdInteressado: brbyteId,
    brbyteInteressadoStatus: brbyteStatus,
    message: "Interessado criado no Controllr com sucesso.",
    durationMs: Date.now() - started,
  }
}
