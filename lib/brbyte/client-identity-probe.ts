import "server-only"

import { randomUUID } from "node:crypto"
import { brbyteAdminLogin, brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import { extractInvoiceInfo, isInvoiceApiResponseSuccessful } from "@/lib/brbyte/check-first-invoice-response"
import { listOverdueInvoicesPage } from "@/lib/brbyte/invoice-list"
import {
  OVERDUE_INVOICE_LIST_PAGE_SIZE,
  OVERDUE_INVOICE_LIST_SORT_DIR,
  OVERDUE_INVOICE_LIST_SORT_FIELD,
  eligibilityReferenceDateUtcFromInstant,
} from "@/lib/brbyte/overdue-invoice-list-query"
import {
  CLIENT_IDENTITY_DETAIL_MARGIN_MS,
  CLIENT_IDENTITY_DETAIL_MIN_BUDGET_MS,
  CLIENT_IDENTITY_HEALTH_ATTEMPTS,
  CLIENT_IDENTITY_HEALTH_MODE,
  CLIENT_IDENTITY_WALL_BUDGET_MS,
  analyzeDetailIdentity,
  analyzeListIdentity,
  buildIdentitySection,
  clampClientIdentityTimeoutMs,
  classifyClientIdentity,
  emptyDetailAnalysis,
  emptyListAnalysis,
  selectDetailRowIndexes,
  type ClientIdentityClassification,
  type ClientIdentityHealthResult,
  type DetailObservation,
  type IdentityRowInput,
} from "@/lib/brbyte/client-identity-probe-result"
import { loadCollectionOperationalSettings } from "@/lib/operational/settings.service"
import { BRBYTE_API_PATHS } from "@/types/brbyte"

const LOG_TAG = "[collections:client-identity-health]"

export type ClientIdentityHealthDeps = {
  now?: () => number
  newRequestId?: () => string
  loadSettings?: () => Promise<{ minimumDaysOverdue: number }>
  getConfig?: typeof getBrbyteOperationalConfig
  login?: typeof brbyteAdminLogin
  listPage?: typeof listOverdueInvoicesPage
  postForm?: typeof brbyteAdminPostForm
  log?: (tag: string, payload: Record<string, unknown>) => void
}

/**
 * Modo administrativo read-only `client_identity_health`.
 * 1 login + 1 invoice/list (page=1, start=0, limit=15, invoice_pk ASC, sem
 * cursor) + no máximo 2 invoice/list_info, cada um com maxAttempts=1.
 * Somente leitura: nenhum módulo de escrita, nenhuma leitura/escrita da run.
 * Resposta e logs sem IDs, PII ou payload.
 */
export async function runClientIdentityHealthProbe(
  input: { timeoutMs?: unknown },
  deps: ClientIdentityHealthDeps = {}
): Promise<ClientIdentityHealthResult> {
  const now = deps.now ?? Date.now
  const requestId = (deps.newRequestId ?? randomUUID)()
  const timeoutMs = clampClientIdentityTimeoutMs(input.timeoutMs)
  const started = now()
  const startedAt = new Date(started).toISOString()
  const loadSettings = deps.loadSettings ?? loadCollectionOperationalSettings
  const getConfig = deps.getConfig ?? getBrbyteOperationalConfig
  const login = deps.login ?? brbyteAdminLogin
  const listPage = deps.listPage ?? listOverdueInvoicesPage
  const postForm = deps.postForm ?? brbyteAdminPostForm
  const log = deps.log ?? ((tag, payload) => console.log(tag, payload))

  // Referência UTC congelada no início da chamada.
  const referenceInstant = new Date(started)
  const referenceDate = eligibilityReferenceDateUtcFromInstant(referenceInstant)

  let minimumDaysOverdue: number | null = null
  let loginDurationMs: number | "NOT_OBSERVED" = "NOT_OBSERVED"
  let listDurationMs: number | "NOT_OBSERVED" = "NOT_OBSERVED"
  let detailDurationMs: number | "NOT_OBSERVED" = "NOT_OBSERVED"
  let listHttpStatus: number | null = null
  let listShapeValid = false
  let listRowCount: number | null = null
  let listAnalysis = emptyListAnalysis()
  let listAnalyzed = false
  let detailAnalysis = emptyDetailAnalysis()
  let detailSkippedForBudget = false
  const detailHttpStatuses: number[] = []

  const finish = (
    classification: ClientIdentityClassification,
    errorClass: string
  ): ClientIdentityHealthResult => {
    const finishedMs = now()
    const ok =
      classification !== "AUTH_OR_CONFIG_FAILURE" &&
      classification !== "INVALID_RESPONSE" &&
      classification !== "INCONCLUSIVE_TIMEOUT_OR_BUDGET"
    const result: ClientIdentityHealthResult = {
      ok,
      mode: CLIENT_IDENTITY_HEALTH_MODE,
      requestId,
      startedAt,
      finishedAt: new Date(finishedMs).toISOString(),
      attempts: CLIENT_IDENTITY_HEALTH_ATTEMPTS,
      timeoutMs,
      errorClass,
      referenceDate,
      minimumDaysOverdue,
      query: {
        page: 1,
        start: 0,
        limit: OVERDUE_INVOICE_LIST_PAGE_SIZE,
        sort: OVERDUE_INVOICE_LIST_SORT_FIELD,
        dir: OVERDUE_INVOICE_LIST_SORT_DIR,
        cursor: "absent",
      },
      timings: {
        totalDurationMs: finishedMs - started,
        loginDurationMs,
        listDurationMs,
        detailDurationMs,
      },
      list: {
        httpStatus: listHttpStatus,
        rowCount: listRowCount,
        shapeValid: listShapeValid,
        validInvoicePkCount: listAnalyzed ? listAnalysis.validInvoicePkCount : null,
        contractPkPresentCount: listAnalyzed ? listAnalysis.contractPkPresentCount : null,
      },
      identity: buildIdentitySection(listAnalysis, detailAnalysis, classification),
      detail: {
        requestedCount: detailAnalysis.requestedCount,
        successfulCount: detailAnalysis.successfulCount,
        timedOutCount: detailAnalysis.timedOutCount,
        skippedForBudget: detailSkippedForBudget,
        candidateField: detailAnalysis.candidateField,
        presentCount: detailAnalysis.presentCount,
        validCount: detailAnalysis.validCount,
        types: { ...detailAnalysis.types },
        identityAgreementCount: detailAnalysis.identityAgreementCount,
        identityConflictCount: detailAnalysis.identityConflictCount,
        contractConflictCount: detailAnalysis.contractConflictCount,
        aliasConflictCount: detailAnalysis.aliasConflictCount,
        httpStatuses: [...detailHttpStatuses],
      },
      classification,
    }
    log(LOG_TAG, {
      requestId,
      classification,
      errorClass,
      attempts: result.attempts,
      timeoutMs,
      totalDurationMs: result.timings.totalDurationMs,
      loginDurationMs,
      listDurationMs,
      detailDurationMs,
      listHttpStatus,
      listRowCount,
      listShapeValid,
      candidateField: result.identity.candidateField,
      presentCount: result.identity.presentCount,
      validCount: result.identity.validCount,
      distinctCount: result.identity.distinctCount,
      contractConflictCount: result.identity.contractConflictCount,
      aliasConflictCount: result.identity.aliasConflictCount,
      detailRequestedCount: result.detail.requestedCount,
      detailSuccessfulCount: result.detail.successfulCount,
    })
    return result
  }

  try {
    const settings = await loadSettings()
    minimumDaysOverdue = settings.minimumDaysOverdue
  } catch {
    return finish("AUTH_OR_CONFIG_FAILURE", "settings_read_failed")
  }
  if (!referenceDate) return finish("AUTH_OR_CONFIG_FAILURE", "invalid_reference_date")

  const config = getConfig()
  if (!config) return finish("AUTH_OR_CONFIG_FAILURE", "missing_controllr_credentials")

  const loginStarted = now()
  const loginResult = await login({ ...config, timeoutMs })
  loginDurationMs = now() - loginStarted
  if ("error" in loginResult) {
    return loginResult.abortClass === "timeout"
      ? finish("INCONCLUSIVE_TIMEOUT_OR_BUDGET", "login_timeout")
      : finish("AUTH_OR_CONFIG_FAILURE", "login_failed")
  }

  const listStarted = now()
  const page = await listPage({
    config: { ...config, timeoutMs },
    cookie: loginResult.cookie,
    referenceDate,
    referenceInstant,
    page: 1,
    timeoutMs,
    minimumDaysOverdue: minimumDaysOverdue ?? undefined,
  })
  listDurationMs = now() - listStarted
  listHttpStatus = page.httpStatus
  if (page.abortClass === "timeout") {
    return finish("INCONCLUSIVE_TIMEOUT_OR_BUDGET", "list_timeout")
  }
  listShapeValid =
    page.ok && isInvoiceApiResponseSuccessful(page.payload, page.httpStatus)
  if (!listShapeValid) return finish("INVALID_RESPONSE", "list_invalid_response")

  const rows: IdentityRowInput[] = page.rows.map((r) => ({
    invoicePk: r.invoicePk,
    contractPk: r.contractPk,
    raw: (r.raw as Record<string, unknown> | null) ?? null,
  }))
  listRowCount = rows.length
  listAnalysis = analyzeListIdentity(rows)
  listAnalyzed = true
  if (rows.length === 0) {
    return finish("INCONCLUSIVE_TIMEOUT_OR_BUDGET", "empty_page")
  }

  if (listAnalysis.proven) {
    return finish("CLIENT_ID_PROVEN_IN_LIST", "none")
  }

  // List insuficiente: no máximo dois invoice_info, uma tentativa cada.
  const observations: DetailObservation[] = []
  let detailTimedOut = false
  let detailFailed = false
  const detailStarted = now()
  for (const index of selectDetailRowIndexes(rows)) {
    const remaining = CLIENT_IDENTITY_WALL_BUDGET_MS - (now() - started)
    if (remaining < CLIENT_IDENTITY_DETAIL_MIN_BUDGET_MS) {
      detailSkippedForBudget = true
      break
    }
    const row = rows[index]
    const t0 = now()
    const res = await postForm(
      { ...config, timeoutMs },
      loginResult.cookie,
      BRBYTE_API_PATHS.invoiceListInfo,
      { invoice_pk: String(row.invoicePk).trim() },
      {
        maxAttempts: 1,
        timeoutMs: Math.min(timeoutMs, remaining - CLIENT_IDENTITY_DETAIL_MARGIN_MS),
      }
    )
    if (typeof res.status === "number") detailHttpStatuses.push(res.status)
    const timedOut = !res.ok && res.abortClass === "timeout"
    const success = res.ok && isInvoiceApiResponseSuccessful(res.json, res.status)
    const info = success ? extractInvoiceInfo(res.json) : null
    observations.push({
      ok: Boolean(success && info?.raw),
      httpStatus: res.status ?? null,
      timedOut,
      durationMs: now() - t0,
      raw: (info?.raw as Record<string, unknown> | null) ?? null,
      listRaw: row.raw,
      contractPk: row.contractPk,
    })
    if (timedOut) {
      detailTimedOut = true
      break
    }
    if (!success) {
      detailFailed = true
      break
    }
  }
  if (observations.length > 0) detailDurationMs = now() - detailStarted
  detailAnalysis = analyzeDetailIdentity(observations, listAnalysis.primaryField)

  const classification = classifyClientIdentity({
    list: listAnalysis,
    detail: detailAnalysis,
    detailSkippedForBudget,
    detailTimedOut,
    detailFailed,
  })
  const errorClass = detailTimedOut
    ? "detail_timeout"
    : detailSkippedForBudget
      ? "detail_budget_exhausted"
      : detailFailed
        ? "detail_invalid_response"
        : "none"
  return finish(classification, errorClass)
}
