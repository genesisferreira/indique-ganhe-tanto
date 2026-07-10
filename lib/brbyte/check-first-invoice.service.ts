import "server-only"

import {
  lookupClientInterestByInterestPk,
} from "@/lib/brbyte/check-conversion-response"
import {
  logCheckFirstInvoiceResponseBody,
  parseInvoiceCreditDate,
  pickFirstValidInvoice,
} from "@/lib/brbyte/check-first-invoice-response"
import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import {
  getBrbyteCreateInterestConfig,
  isBrbyteCreateInterestEnabled,
} from "@/lib/brbyte/config"
import { fetchInvoiceInfo } from "@/lib/brbyte/invoice-info"
import { listContractInvoices } from "@/lib/brbyte/invoice-list"
import { logBrbyteReferralHistory } from "@/lib/brbyte/referral-history"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  BRBYTE_API_PATHS,
  type BrbyteCheckFirstInvoiceResult,
  type BrbyteSyncRunPhase,
  type BrbyteSyncRunStatus,
} from "@/types/brbyte"
import { normalizeBrbyteSyncStatus } from "@/types/referral"
import { isReferralRewardEligible } from "@/lib/referral-reward-eligibility"

const LOG_TAG = "[brbyte:check-first-invoice]"
const LOGIN_ENDPOINT = "/login"
const CHECK_FIRST_INVOICE_PHASE: BrbyteSyncRunPhase = "check_first_invoice"
const NOT_PAID_MESSAGE =
  "Primeira mensalidade ainda não consta como paga no Controllr."

type ReferralCheckFirstInvoiceRow = {
  id: string
  indicator_profile_id: string | null
  reward_amount: number | string | null
  reward_type: string | null
  source: string | null
  reward_eligible: boolean | null
  erp_lead_source: string | null
  status: string
  first_invoice_paid: boolean
  first_invoice_paid_at: string | null
  brbyte_id_interessado: string | null
  brbyte_client_pk: string | null
  brbyte_id_contrato: string | null
  brbyte_contract_pk: string | null
  brbyte_first_invoice_pk: string | null
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
          data: ReferralCheckFirstInvoiceRow | null
          error: { message: string } | null
        }>
      }
    }
  }
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: Record<string, unknown> | null
    error: { message: string; code?: string } | null
  }>
}

function getDb(): BrbyteLooseDb {
  return createServiceRoleClient() as unknown as BrbyteLooseDb
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
        phase: CHECK_FIRST_INVOICE_PHASE,
        meta: {
          phase: CHECK_FIRST_INVOICE_PHASE,
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
    marked_paid?: number
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
        phase: patch.phase ?? CHECK_FIRST_INVOICE_PHASE,
        finished_at: new Date().toISOString(),
        meta: {
          phase: CHECK_FIRST_INVOICE_PHASE,
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

async function loadReferralForCheck(
  referralId: string
): Promise<ReferralCheckFirstInvoiceRow | null> {
  const { data, error } = await getDb()
    .from("referrals")
    .select(
      `
      id,
      indicator_profile_id,
      reward_amount,
      reward_type,
      source,
      reward_eligible,
      erp_lead_source,
      status,
      first_invoice_paid,
      first_invoice_paid_at,
      brbyte_id_interessado,
      brbyte_client_pk,
      brbyte_id_contrato,
      brbyte_contract_pk,
      brbyte_first_invoice_pk,
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

function resolveStoredContractPk(row: ReferralCheckFirstInvoiceRow): string | null {
  return (
    row.brbyte_contract_pk?.trim() ||
    row.brbyte_id_contrato?.trim() ||
    null
  )
}

function validateReferralForCheck(row: ReferralCheckFirstInvoiceRow): string | null {
  if (row.first_invoice_paid) {
    return "Primeira mensalidade já confirmada para esta indicação."
  }

  const clientPk = row.brbyte_client_pk?.trim()
  if (!clientPk) {
    return "Esta indicação ainda não possui cliente convertido no Controllr."
  }

  const syncStatus = normalizeBrbyteSyncStatus(row.brbyte_sync_status)
  const allowedStatuses = new Set([
    "converted",
    "waiting_invoice",
    "waiting_contract",
    "synced",
  ])
  if (!allowedStatuses.has(syncStatus)) {
    return "A verificação da primeira mensalidade só está disponível após a conversão do cliente."
  }

  return null
}

async function hasExistingFirstInvoiceReward(
  referralId: string
): Promise<boolean> {
  const db = getDb() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string
        ) => {
          maybeSingle: () => Promise<{
            data: { id: string } | null
            error: { message: string } | null
          }>
        }
      }
    }
  }

  const { data: reward } = await db
    .from("rewards")
    .select("id")
    .eq("referral_id", referralId)
    .maybeSingle()

  if (!reward?.id) return false

  const walletDb = getDb() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string
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

  const { data: txs } = await walletDb
    .from("wallet_transactions")
    .select("id")
    .eq("reward_id", reward.id)
    .eq("transaction_type", "credito")
    .limit(1)

  return Boolean(txs && txs.length > 0)
}

async function ensureRewardForReferral(
  row: ReferralCheckFirstInvoiceRow
): Promise<{ ok: boolean; rewardId?: string; message?: string }> {
  if (!isReferralRewardEligible(row)) {
    return {
      ok: true,
      message: "Registro sem elegibilidade financeira (pré-cadastro público).",
    }
  }

  if (!row.indicator_profile_id) {
    return { ok: false, message: "Indicação sem indicador vinculado." }
  }

  const amount = Number(row.reward_amount)
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      ok: false,
      message: "Valor de recompensa inválido ou ausente na indicação.",
    }
  }

  const db = getDb() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean }
          ) => Promise<{
            data: { id: string }[] | null
            error: { message: string } | null
          }>
        }
      }
      insert: (values: unknown) => {
        select: (cols: string) => Promise<{
          data: { id: string }[] | null
          error: { message: string; code?: string } | null
        }>
      }
    }
  }

  const { data: existingRows, error: existingError } = await db
    .from("rewards")
    .select("id")
    .eq("referral_id", row.id)
    .order("created_at", { ascending: true })

  if (existingError) {
    return {
      ok: false,
      message: `Falha ao verificar recompensa: ${existingError.message}`,
    }
  }

  if (existingRows && existingRows.length > 0) {
    return { ok: true, rewardId: existingRows[0].id }
  }

  const rewardType =
    row.reward_type === "desconto_fatura" ? "desconto_fatura" : "pix"

  const { data: inserted, error: insertError } = await db
    .from("rewards")
    .insert({
      referral_id: row.id,
      indicator_profile_id: row.indicator_profile_id,
      amount,
      reward_type: rewardType,
      status: "pendente",
      available_at: null,
      paid_at: null,
    })
    .select("id")

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await db
        .from("rewards")
        .select("id")
        .eq("referral_id", row.id)
        .order("created_at", { ascending: true })
      if (raced && raced.length > 0) {
        return { ok: true, rewardId: raced[0].id }
      }
    }
    return {
      ok: false,
      message: `Falha ao criar recompensa: ${insertError.message}`,
    }
  }

  const rewardId = inserted?.[0]?.id
  if (!rewardId) {
    return { ok: false, message: "Recompensa criada sem identificador retornado." }
  }

  return { ok: true, rewardId, message: "Recompensa criada automaticamente." }
}

async function persistContractPk(
  referralId: string,
  contractPk: string,
  source: string
): Promise<void> {
  const syncedAt = new Date().toISOString()
  await getDb()
    .from("referrals")
    .update({
      brbyte_contract_pk: contractPk,
      brbyte_id_contrato: contractPk,
      brbyte_last_sync_at: syncedAt,
      brbyte_last_endpoint: source,
    })
    .eq("id", referralId)
}

async function persistWaitingInvoice(
  referralId: string,
  patch: {
    contractPk: string
    invoicePk: string | null
    listPayload: Record<string, unknown> | null
    infoPayload: Record<string, unknown> | null
    syncRunId: string | null
    httpStatus: number | null
    checkedAtIso: string
  }
): Promise<void> {
  await getDb()
    .from("referrals")
    .update({
      brbyte_contract_pk: patch.contractPk,
      brbyte_id_contrato: patch.contractPk,
      brbyte_first_invoice_pk: patch.invoicePk,
      brbyte_sync_status: "waiting_invoice",
      brbyte_sync_error: null,
      brbyte_last_sync_at: patch.checkedAtIso,
      brbyte_last_http_status: patch.httpStatus,
      brbyte_last_endpoint: BRBYTE_API_PATHS.invoiceListInfo,
      brbyte_first_invoice_payload: {
        action: "check_first_invoice",
        paid: false,
        contract_pk: patch.contractPk,
        invoice_pk: patch.invoicePk,
        list: patch.listPayload,
        info: patch.infoPayload,
        sync_run_id: patch.syncRunId,
        checked_at: patch.checkedAtIso,
      },
    })
    .eq("id", referralId)
}

async function persistPaidInvoice(
  referralId: string,
  patch: {
    contractPk: string
    invoicePk: string
    paidAtIso: string
    listPayload: Record<string, unknown> | null
    infoPayload: Record<string, unknown> | null
    syncRunId: string | null
    httpStatus: number | null
    rpcResult: Record<string, unknown>
  }
): Promise<void> {
  await getDb()
    .from("referrals")
    .update({
      brbyte_contract_pk: patch.contractPk,
      brbyte_id_contrato: patch.contractPk,
      brbyte_first_invoice_pk: patch.invoicePk,
      brbyte_first_invoice_paid_at: patch.paidAtIso,
      brbyte_sync_status: "paid_confirmed",
      brbyte_sync_error: null,
      brbyte_last_sync_at: patch.paidAtIso,
      brbyte_last_http_status: patch.httpStatus,
      brbyte_last_endpoint: BRBYTE_API_PATHS.invoiceListInfo,
      brbyte_first_invoice_payload: {
        action: "check_first_invoice",
        paid: true,
        contract_pk: patch.contractPk,
        invoice_pk: patch.invoicePk,
        list: patch.listPayload,
        info: patch.infoPayload,
        sync_run_id: patch.syncRunId,
        rpc: patch.rpcResult,
        checked_at: patch.paidAtIso,
      },
    })
    .eq("id", referralId)
}

async function logAudit(
  actorProfileId: string | null,
  referralId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await getDb()
      .from("audit_logs")
      .insert({
        actor_profile_id: actorProfileId,
        target_profile_id: null,
        entity_name: "referral",
        entity_id: referralId,
        action: "update",
        old_data: null,
        new_data: metadata,
        metadata: {
          source: "brbyte_check_first_invoice",
          ...metadata,
        },
      })
  } catch (e) {
    console.error(LOG_TAG, {
      step: "audit_log",
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

function syncRunAuditMeta(input: {
  referralId: string
  endpoint: string
  httpStatus?: number | null
  success?: boolean
  paid?: boolean
  contractPk?: string | null
  invoicePk?: string | null
  error?: string
}): Record<string, unknown> {
  return {
    phase: CHECK_FIRST_INVOICE_PHASE,
    referral_id: input.referralId,
    triggered_by: "admin_manual",
    endpoint: input.endpoint,
    http_status: input.httpStatus ?? null,
    success: input.success ?? false,
    paid: input.paid ?? false,
    contract_pk: input.contractPk ?? null,
    invoice_pk: input.invoicePk ?? null,
    error: input.error ?? null,
  }
}

export async function checkBrbyteFirstInvoiceFromReferral(input: {
  referralId: string
  actorUserId?: string | null
}): Promise<BrbyteCheckFirstInvoiceResult> {
  const started = Date.now()
  const referralId = input.referralId.trim()

  if (!isBrbyteCreateInterestEnabled()) {
    return {
      ok: false,
      paid: false,
      skipped: true,
      reason: "disabled",
      referralId,
      syncRunId: null,
      contractPk: null,
      invoicePk: null,
      brbyteClientPk: null,
      message: "Integração BRByte desabilitada neste ambiente.",
      durationMs: Date.now() - started,
    }
  }

  const config = getBrbyteCreateInterestConfig()
  if (!config) {
    return {
      ok: false,
      paid: false,
      skipped: true,
      reason: "not_configured",
      referralId,
      syncRunId: null,
      contractPk: null,
      invoicePk: null,
      brbyteClientPk: null,
      message: "Credenciais BRByte não configuradas.",
      durationMs: Date.now() - started,
    }
  }

  const referral = await loadReferralForCheck(referralId)
  if (!referral) {
    return {
      ok: false,
      paid: false,
      referralId,
      syncRunId: null,
      contractPk: null,
      invoicePk: null,
      brbyteClientPk: null,
      message: "Indicação não encontrada.",
      durationMs: Date.now() - started,
    }
  }

  if (referral.first_invoice_paid || (await hasExistingFirstInvoiceReward(referralId))) {
    return {
      ok: true,
      paid: true,
      idempotent: true,
      referralId,
      syncRunId: null,
      contractPk: resolveStoredContractPk(referral),
      invoicePk: referral.brbyte_first_invoice_pk,
      brbyteClientPk: referral.brbyte_client_pk,
      message: "Primeira mensalidade já confirmada para esta indicação.",
      durationMs: Date.now() - started,
    }
  }

  const validationError = validateReferralForCheck(referral)
  if (validationError) {
    return {
      ok: false,
      paid: false,
      skipped: true,
      reason: "invalid_state",
      referralId,
      syncRunId: null,
      contractPk: resolveStoredContractPk(referral),
      invoicePk: referral.brbyte_first_invoice_pk,
      brbyteClientPk: referral.brbyte_client_pk,
      message: validationError,
      durationMs: Date.now() - started,
    }
  }

  const syncRunId = await createSyncRun(referralId, input.actorUserId ?? null, true)
  const clientPk = referral.brbyte_client_pk!.trim()
  let contractPk = resolveStoredContractPk(referral)

  const login = await brbyteAdminLogin(config)
  if ("error" in login) {
    await finishSyncRun(syncRunId, {
      status: "error",
      api_reachable: false,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { step: "login", message: login.error },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: LOGIN_ENDPOINT,
        httpStatus: login.httpStatus,
        success: false,
        error: login.error,
      }),
    })

    await logBrbyteReferralHistory({
      referralId,
      phase: CHECK_FIRST_INVOICE_PHASE,
      oldStatus: referral.brbyte_sync_status,
      newStatus: "error",
      endpoint: LOGIN_ENDPOINT,
      httpStatus: login.httpStatus,
      message: login.error,
      createdBy: input.actorUserId ?? null,
    })

    return {
      ok: false,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk: null,
      brbyteClientPk: clientPk,
      message: login.error,
      durationMs: Date.now() - started,
    }
  }

  if (!contractPk) {
    const interestPk = referral.brbyte_id_interessado?.trim()
    if (!interestPk) {
      const message =
        "Contrato não encontrado no CRM e Interessado não vinculado para consulta."
      await finishSyncRun(syncRunId, {
        status: "error",
        api_reachable: true,
        errors_count: 1,
        duration_ms: Date.now() - started,
        error_summary: { step: "resolve_contract", message },
      })
      return {
        ok: false,
        paid: false,
        referralId,
        syncRunId,
        contractPk: null,
        invoicePk: null,
        brbyteClientPk: clientPk,
        message,
        durationMs: Date.now() - started,
      }
    }

    const lookup = await lookupClientInterestByInterestPk({
      config,
      cookie: login.cookie,
      interestPk,
    })

    logCheckFirstInvoiceResponseBody(
      BRBYTE_API_PATHS.listClientInterest,
      lookup.httpStatus,
      lookup.payload
    )

    contractPk =
      lookup.resolution?.contractPk?.trim() ||
      readContractPkFromPayload(lookup.payload)

    if (!contractPk) {
      const message =
        "Contrato ainda não disponível no Controllr para este cliente."
      await getDb()
        .from("referrals")
        .update({
          brbyte_sync_status: "waiting_contract",
          brbyte_sync_error: null,
          brbyte_last_sync_at: new Date().toISOString(),
          brbyte_last_http_status: lookup.httpStatus,
          brbyte_last_endpoint: BRBYTE_API_PATHS.listClientInterest,
        })
        .eq("id", referralId)
      await finishSyncRun(syncRunId, {
        status: "partial",
        api_reachable: true,
        skipped_records: 1,
        duration_ms: Date.now() - started,
        meta: syncRunAuditMeta({
          referralId,
          endpoint: BRBYTE_API_PATHS.listClientInterest,
          httpStatus: lookup.httpStatus,
          success: false,
          paid: false,
          error: message,
        }),
      })
      await logBrbyteReferralHistory({
        referralId,
        phase: CHECK_FIRST_INVOICE_PHASE,
        oldStatus: referral.brbyte_sync_status,
        newStatus: "waiting_contract",
        endpoint: BRBYTE_API_PATHS.listClientInterest,
        httpStatus: lookup.httpStatus,
        message,
        payload: lookup.payload ?? undefined,
        createdBy: input.actorUserId ?? null,
      })
      return {
        ok: true,
        paid: false,
        referralId,
        syncRunId,
        contractPk: null,
        invoicePk: null,
        brbyteClientPk: clientPk,
        message,
        durationMs: Date.now() - started,
      }
    }

    await persistContractPk(
      referralId,
      contractPk,
      BRBYTE_API_PATHS.listClientInterest
    )
  }

  const listResult = await listContractInvoices({
    config,
    cookie: login.cookie,
    contractPk,
  })

  logCheckFirstInvoiceResponseBody(
    BRBYTE_API_PATHS.invoiceList,
    listResult.httpStatus,
    listResult.payload
  )

  if (!listResult.ok) {
    await finishSyncRun(syncRunId, {
      status: "error",
      api_reachable: true,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { step: "invoice_list", message: listResult.message },
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.invoiceList,
        httpStatus: listResult.httpStatus,
        success: false,
        contractPk,
        error: listResult.message,
      }),
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CHECK_FIRST_INVOICE_PHASE,
      oldStatus: referral.brbyte_sync_status,
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.invoiceList,
      httpStatus: listResult.httpStatus,
      message: listResult.message ?? "Falha ao listar faturas.",
      payload: listResult.payload ?? undefined,
      createdBy: input.actorUserId ?? null,
    })
    return {
      ok: false,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk: null,
      brbyteClientPk: clientPk,
      message: listResult.message,
      durationMs: Date.now() - started,
    }
  }

  const firstInvoice = pickFirstValidInvoice(listResult.rows)
  if (!firstInvoice?.invoicePk) {
    const message = "Nenhuma fatura encontrada para o contrato no Controllr."
    await persistWaitingInvoice(referralId, {
      contractPk,
      invoicePk: null,
      listPayload: listResult.payload,
      infoPayload: null,
      syncRunId,
      httpStatus: listResult.httpStatus,
      checkedAtIso: new Date().toISOString(),
    })
    await finishSyncRun(syncRunId, {
      status: "partial",
      api_reachable: true,
      skipped_records: 1,
      duration_ms: Date.now() - started,
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.invoiceList,
        httpStatus: listResult.httpStatus,
        success: true,
        paid: false,
        contractPk,
      }),
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CHECK_FIRST_INVOICE_PHASE,
      oldStatus: referral.brbyte_sync_status,
      newStatus: "waiting_invoice",
      endpoint: BRBYTE_API_PATHS.invoiceList,
      httpStatus: listResult.httpStatus,
      message,
      payload: listResult.payload ?? undefined,
      createdBy: input.actorUserId ?? null,
    })
    return {
      ok: true,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk: null,
      brbyteClientPk: clientPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const invoicePk = firstInvoice.invoicePk
  const infoResult = await fetchInvoiceInfo({
    config,
    cookie: login.cookie,
    invoicePk,
  })

  logCheckFirstInvoiceResponseBody(
    BRBYTE_API_PATHS.invoiceListInfo,
    infoResult.httpStatus,
    infoResult.payload
  )

  if (!infoResult.ok || !infoResult.info) {
    await finishSyncRun(syncRunId, {
      status: "error",
      api_reachable: true,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { step: "invoice_info", message: infoResult.message },
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CHECK_FIRST_INVOICE_PHASE,
      oldStatus: referral.brbyte_sync_status,
      newStatus: "error",
      endpoint: BRBYTE_API_PATHS.invoiceListInfo,
      httpStatus: infoResult.httpStatus,
      message: infoResult.message ?? "Falha ao consultar fatura.",
      createdBy: input.actorUserId ?? null,
    })
    return {
      ok: false,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk,
      brbyteClientPk: clientPk,
      message: infoResult.message,
      durationMs: Date.now() - started,
    }
  }

  if (!infoResult.info.isPaid) {
    await persistWaitingInvoice(referralId, {
      contractPk,
      invoicePk,
      listPayload: listResult.payload,
      infoPayload: infoResult.payload,
      syncRunId,
      httpStatus: infoResult.httpStatus,
      checkedAtIso: new Date().toISOString(),
    })
    await finishSyncRun(syncRunId, {
      status: "ok",
      api_reachable: true,
      processed: 1,
      skipped_records: 1,
      duration_ms: Date.now() - started,
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.invoiceListInfo,
        httpStatus: infoResult.httpStatus,
        success: true,
        paid: false,
        contractPk,
        invoicePk,
      }),
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CHECK_FIRST_INVOICE_PHASE,
      oldStatus: referral.brbyte_sync_status,
      newStatus: "waiting_invoice",
      endpoint: BRBYTE_API_PATHS.invoiceListInfo,
      httpStatus: infoResult.httpStatus,
      message: NOT_PAID_MESSAGE,
      payload: {
        list: listResult.payload,
        info: infoResult.payload,
      },
      createdBy: input.actorUserId ?? null,
    })
    return {
      ok: true,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk,
      brbyteClientPk: clientPk,
      message: NOT_PAID_MESSAGE,
      durationMs: Date.now() - started,
    }
  }

  const paidAtIso =
    parseInvoiceCreditDate(infoResult.info.invoiceDateCredit) ??
    new Date().toISOString()

  const rewardEligible = isReferralRewardEligible(referral)

  if (!rewardEligible) {
    await persistPaidInvoice(referralId, {
      contractPk,
      invoicePk,
      paidAtIso,
      listPayload: listResult.payload,
      infoPayload: infoResult.payload,
      syncRunId,
      httpStatus: infoResult.httpStatus,
      rpcResult: {
        skipped_financial: true,
        reason: "public_pre_registration_or_not_reward_eligible",
      },
    })
    await finishSyncRun(syncRunId, {
      status: "ok",
      api_reachable: true,
      processed: 1,
      duration_ms: Date.now() - started,
      meta: syncRunAuditMeta({
        referralId,
        endpoint: BRBYTE_API_PATHS.invoiceListInfo,
        httpStatus: infoResult.httpStatus,
        success: true,
        paid: true,
        contractPk,
        invoicePk,
      }),
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: CHECK_FIRST_INVOICE_PHASE,
      oldStatus: referral.brbyte_sync_status,
      newStatus: "paid_confirmed",
      endpoint: BRBYTE_API_PATHS.invoiceListInfo,
      httpStatus: infoResult.httpStatus,
      message:
        "Primeira mensalidade paga confirmada (sem liberação financeira — pré-cadastro).",
      payload: {
        list: listResult.payload,
        info: infoResult.payload,
        financial_skipped: true,
      },
      createdBy: input.actorUserId ?? null,
    })
    await logAudit(input.actorUserId ?? null, referralId, {
      paid: true,
      financial_skipped: true,
      contract_pk: contractPk,
      invoice_pk: invoicePk,
    })
    return {
      ok: true,
      paid: true,
      idempotent: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk,
      brbyteClientPk: clientPk,
      message:
        "Primeira mensalidade confirmada no ERP. Registro sem recompensa (pré-cadastro).",
      durationMs: Date.now() - started,
    }
  }

  const rewardEnsure = await ensureRewardForReferral(referral)
  if (!rewardEnsure.ok) {
    await finishSyncRun(syncRunId, {
      status: "error",
      api_reachable: true,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { step: "ensure_reward", message: rewardEnsure.message },
    })
    return {
      ok: false,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk,
      brbyteClientPk: clientPk,
      message: rewardEnsure.message,
      durationMs: Date.now() - started,
    }
  }

  const { data: rpcData, error: rpcError } = await getDb().rpc(
    "mark_first_invoice_paid_from_sync",
    {
      p_referral_id: referralId,
      p_paid_at: paidAtIso,
      p_external_reference: invoicePk,
      p_payload: {
        source: "brbyte_check_first_invoice",
        contract_pk: contractPk,
        invoice_pk: invoicePk,
        invoice_msg: infoResult.info.invoiceMsg,
        invoice_date_credit: infoResult.info.invoiceDateCredit,
        list: listResult.payload,
        info: infoResult.payload,
        sync_run_id: syncRunId,
      },
    }
  )

  if (rpcError) {
    await finishSyncRun(syncRunId, {
      status: "error",
      api_reachable: true,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { step: "release_reward", message: rpcError.message },
    })
    await logBrbyteReferralHistory({
      referralId,
      phase: "release_reward",
      oldStatus: referral.brbyte_sync_status,
      newStatus: "error",
      endpoint: "mark_first_invoice_paid_from_sync",
      message: rpcError.message,
      createdBy: input.actorUserId ?? null,
    })
    return {
      ok: false,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk,
      brbyteClientPk: clientPk,
      message: `Falha ao liberar recompensa: ${rpcError.message}`,
      durationMs: Date.now() - started,
    }
  }

  const rpcResult = (rpcData ?? {}) as Record<string, unknown>
  if (rpcResult.ok === false && rpcResult.idempotent !== true) {
    const message =
      typeof rpcResult.message === "string"
        ? rpcResult.message
        : "Não foi possível liberar a recompensa."
    await finishSyncRun(syncRunId, {
      status: "error",
      api_reachable: true,
      errors_count: 1,
      duration_ms: Date.now() - started,
      error_summary: { step: "release_reward", message, rpc: rpcResult },
    })
    return {
      ok: false,
      paid: false,
      referralId,
      syncRunId,
      contractPk,
      invoicePk,
      brbyteClientPk: clientPk,
      message,
      durationMs: Date.now() - started,
    }
  }

  const idempotent = rpcResult.idempotent === true

  await persistPaidInvoice(referralId, {
    contractPk,
    invoicePk,
    paidAtIso,
    listPayload: listResult.payload,
    infoPayload: infoResult.payload,
    syncRunId,
    httpStatus: infoResult.httpStatus,
    rpcResult,
  })

  await finishSyncRun(syncRunId, {
    status: "ok",
    api_reachable: true,
    processed: 1,
    marked_paid: idempotent ? 0 : 1,
    duration_ms: Date.now() - started,
    meta: syncRunAuditMeta({
      referralId,
      endpoint: BRBYTE_API_PATHS.invoiceListInfo,
      httpStatus: infoResult.httpStatus,
      success: true,
      paid: true,
      contractPk,
      invoicePk,
    }),
  })

  await logBrbyteReferralHistory({
    referralId,
    phase: idempotent ? CHECK_FIRST_INVOICE_PHASE : "release_reward",
    oldStatus: referral.brbyte_sync_status,
    newStatus: "paid_confirmed",
    endpoint: BRBYTE_API_PATHS.invoiceListInfo,
    httpStatus: infoResult.httpStatus,
    message: idempotent
      ? "Primeira mensalidade já confirmada (idempotente)."
      : "Primeira mensalidade paga — recompensa liberada.",
    payload: {
      contract_pk: contractPk,
      invoice_pk: invoicePk,
      rpc: rpcResult,
    },
    createdBy: input.actorUserId ?? null,
  })

  await logAudit(input.actorUserId ?? null, referralId, {
    action: "first_invoice_paid",
    contract_pk: contractPk,
    invoice_pk: invoicePk,
    paid_at: paidAtIso,
    idempotent,
    reward_id: rpcResult.reward_id ?? rewardEnsure.rewardId ?? null,
    transaction_id: rpcResult.transaction_id ?? null,
  })

  return {
    ok: true,
    paid: true,
    idempotent,
    referralId,
    syncRunId,
    contractPk,
    invoicePk,
    brbyteClientPk: clientPk,
    message: idempotent
      ? "Primeira mensalidade já confirmada para esta indicação."
      : "Primeira mensalidade paga no Controllr — recompensa liberada.",
    durationMs: Date.now() - started,
  }
}

function readContractPkFromPayload(
  payload: Record<string, unknown> | null
): string | null {
  if (!payload) return null
  const results = payload.results
  if (!Array.isArray(results) || results.length === 0) return null
  const row = results[0]
  if (!row || typeof row !== "object") return null
  const record = row as Record<string, unknown>
  const pk =
    record.contract_pk ?? record.contractPk ?? record.id_contrato ?? null
  if (pk === undefined || pk === null) return null
  const str = String(pk).trim()
  return str.length > 0 ? str : null
}
