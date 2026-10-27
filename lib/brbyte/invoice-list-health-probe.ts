import "server-only"

import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import {
  OVERDUE_FIRST_PAGE_HEALTH_ATTEMPTS,
  clampOverdueFirstPageHealthTimeoutMs,
  summarizeOverdueFirstPageHealthResult,
  type OverdueFirstPageHealthResult,
} from "@/lib/brbyte/invoice-list-health-probe-result"
import { listOverdueInvoicesPage } from "@/lib/brbyte/invoice-list"
import {
  eligibilityReferenceDateUtcFromInstant,
  queryCutoffExclusiveUtc,
} from "@/lib/brbyte/overdue-invoice-list-query"
import { readUniqueResumableDiscoveryRunSnapshot } from "@/lib/collections/discovery-run-snapshot"
import { isInvoiceApiResponseSuccessful } from "@/lib/brbyte/check-first-invoice-response"
import { loadCollectionOperationalSettings } from "@/lib/operational/settings.service"

const LOG_TAG = "[collections:invoice-list-health-probe]"

export type OverdueFirstPageHealthDeps = {
  loadSettings?: () => Promise<{ minimumDaysOverdue: number; isEnabled: boolean }>
  readRunSnapshot?: typeof readUniqueResumableDiscoveryRunSnapshot
  getConfig?: typeof getBrbyteOperationalConfig
  login?: typeof brbyteAdminLogin
  listPage?: typeof listOverdueInvoicesPage
}

/**
 * Modo administrativo read-only: 1ª página operacional de atrasados.
 * Não importa nem chama discovery runner, persist, advance, release,
 * módulo de reconciliação ou assignment.
 */
export async function runOverdueFirstPageHealthProbe(
  input: { timeoutMs?: unknown },
  deps: OverdueFirstPageHealthDeps = {}
): Promise<OverdueFirstPageHealthResult> {
  const timeoutMs = clampOverdueFirstPageHealthTimeoutMs(input.timeoutMs)
  const started = Date.now()
  const loadSettings = deps.loadSettings ?? loadCollectionOperationalSettings
  const readRunSnapshot =
    deps.readRunSnapshot ?? readUniqueResumableDiscoveryRunSnapshot
  const getConfig = deps.getConfig ?? getBrbyteOperationalConfig
  const login = deps.login ?? brbyteAdminLogin
  const listPage = deps.listPage ?? listOverdueInvoicesPage

  const settings = await loadSettings()
  const minimumDaysOverdue = settings.minimumDaysOverdue

  const runRead = await readRunSnapshot()
  if (!runRead.ok) {
    const result = summarizeOverdueFirstPageHealthResult({
      timeoutMs,
      referenceDate: null,
      minimumDaysOverdue,
      cursorMode: null,
      loginDurationMs: "NOT_OBSERVED",
      listTotalDurationMs: "NOT_OBSERVED",
      totalDurationMs: Date.now() - started,
      httpStatus: null,
      earlyErrorClass: runRead.errorClass,
      shapeValid: false,
    })
    console.log(LOG_TAG, {
      errorClass: result.errorClass,
      attempts: OVERDUE_FIRST_PAGE_HEALTH_ATTEMPTS,
      timeoutMs: result.timeoutMs,
      totalDurationMs: result.timings.totalDurationMs,
    })
    return result
  }

  const snapshot = runRead.snapshot
  const referenceInstant = new Date(snapshot.referenceInstant)
  const eligibilityReferenceDateUtc =
    eligibilityReferenceDateUtcFromInstant(referenceInstant) ??
    snapshot.referenceDate
  const cutoff = queryCutoffExclusiveUtc(
    eligibilityReferenceDateUtc,
    minimumDaysOverdue
  )

  const config = getConfig()
  if (!config) {
    const result = summarizeOverdueFirstPageHealthResult({
      timeoutMs,
      referenceDate: eligibilityReferenceDateUtc,
      minimumDaysOverdue,
      cursorMode: snapshot.cursorMode,
      loginDurationMs: "NOT_OBSERVED",
      listTotalDurationMs: "NOT_OBSERVED",
      totalDurationMs: Date.now() - started,
      httpStatus: null,
      earlyErrorClass: "missing_controllr_credentials",
      shapeValid: false,
      cursorLastInvoicePk: snapshot.cursorLastInvoicePk,
    })
    console.log(LOG_TAG, {
      errorClass: result.errorClass,
      cursorMode: result.cursorMode,
      cutoff,
      attempts: result.attempts,
    })
    return result
  }

  const loginStarted = Date.now()
  const loginResult = await login({ ...config, timeoutMs })
  const loginDurationMs = Date.now() - loginStarted
  if ("error" in loginResult) {
    const aborted = Boolean(loginResult.abortClass === "timeout")
    const result = summarizeOverdueFirstPageHealthResult({
      timeoutMs,
      referenceDate: eligibilityReferenceDateUtc,
      minimumDaysOverdue,
      cursorMode: snapshot.cursorMode,
      loginDurationMs,
      listTotalDurationMs: "NOT_OBSERVED",
      totalDurationMs: Date.now() - started,
      httpStatus: loginResult.httpStatus,
      aborted,
      transportMessage: loginResult.error,
      earlyErrorClass: aborted ? "login_timeout" : "login_failed",
      shapeValid: false,
      cursorLastInvoicePk: snapshot.cursorLastInvoicePk,
    })
    console.log(LOG_TAG, {
      errorClass: result.errorClass,
      httpStatus: result.httpStatus,
      loginDurationMs,
      attempts: result.attempts,
    })
    return result
  }

  const listStarted = Date.now()
  const page = await listPage({
    config: { ...config, timeoutMs },
    cookie: loginResult.cookie,
    referenceDate: snapshot.referenceDate,
    referenceInstant,
    page: 1,
    afterInvoicePk: snapshot.cursorLastInvoicePk,
    timeoutMs,
    minimumDaysOverdue,
  })
  const listTotalDurationMs = Date.now() - listStarted

  const aborted = page.abortClass === "timeout"
  const shapeValid =
    !aborted &&
    isInvoiceApiResponseSuccessful(page.payload, page.httpStatus) &&
    page.ok

  const result = summarizeOverdueFirstPageHealthResult({
    timeoutMs,
    referenceDate: eligibilityReferenceDateUtc,
    minimumDaysOverdue,
    cursorMode: snapshot.cursorMode,
    loginDurationMs,
    listTotalDurationMs,
    totalDurationMs: Date.now() - started,
    httpStatus: page.httpStatus,
    aborted,
    bodyReadComplete: page.bodyReadComplete,
    transportMessage: page.message,
    shapeValid,
    rows: page.rows.map((row) => ({
      invoicePk: row.invoicePk,
      invoiceDueDate: row.invoiceDueDate,
      raw: row.raw ?? null,
    })),
    reportedTotal: page.total,
    cursorLastInvoicePk: snapshot.cursorLastInvoicePk,
  })

  console.log(LOG_TAG, {
    errorClass: result.errorClass,
    cursorMode: result.cursorMode,
    cutoff: result.cutoff,
    httpStatus: result.httpStatus,
    contentType: result.contentType,
    attempts: result.attempts,
    timeoutMs: result.timeoutMs,
    loginDurationMs: result.timings.loginDurationMs,
    listTotalDurationMs: result.timings.listTotalDurationMs,
    listHeadersMs: result.timings.listHeadersMs,
    listBodyReadMs: result.timings.listBodyReadMs,
    totalDurationMs: result.timings.totalDurationMs,
    timeoutPhase: result.timings.timeoutPhase,
    success: result.success,
    rowCount: result.rowCount,
    reportedTotal: result.reportedTotal,
    validUniquePkCount: result.validUniquePkCount,
    strictlyAscending: result.strictlyAscending,
    idsGreaterThanCursor: result.idsGreaterThanCursor,
    parseableDueDateCount: result.parseableDueDateCount,
    invalidDueDateCount: result.invalidDueDateCount,
    cancelledContractCount: result.cancelledContractCount,
    blockedContractCount: result.blockedContractCount,
    missingContractStatusCount: result.missingContractStatusCount,
    shapeValid: result.shapeValid,
  })

  return result
}
