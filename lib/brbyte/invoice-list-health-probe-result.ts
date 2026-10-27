import { classifyControllrHttpStatus } from "@/lib/brbyte/http-error-diagnostics"
import {
  compareOverdueInvoicePk,
  OVERDUE_INVOICE_LIST_PAGE_SIZE,
  parseOverdueInvoicePk,
  queryCutoffExclusiveUtc,
} from "@/lib/brbyte/overdue-invoice-list-query"
import { parseInvoiceDueDate } from "@/lib/collections/eligibility"
import {
  classifyClientContractCancellation,
  CONTROLLR_CONTRACT_STATUS_CODE,
  coalesceControllrStatus,
} from "@/lib/operational/cancelled"
import { COLLECTION_OVERDUE_THRESHOLD_DAYS } from "@/types/collections"

export const OVERDUE_FIRST_PAGE_HEALTH_MODE = "overdue_first_page_health" as const
export const OVERDUE_FIRST_PAGE_HEALTH_ATTEMPTS = 1 as const
export const OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_MIN_MS = 3_000
export const OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_MAX_MS = 60_000
export const OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_DEFAULT_MS = 60_000

export type HealthCursorMode = "absent" | "present"
export type HealthTimeoutPhase =
  | "awaiting_headers"
  | "during_body"
  | "not_applicable"
  | "NOT_OBSERVED"

export type HealthTimingValue = number | "NOT_OBSERVED"

export type OverdueFirstPageHealthTimings = {
  loginDurationMs: HealthTimingValue
  listHeadersMs: HealthTimingValue
  listBodyReadMs: HealthTimingValue
  listTotalDurationMs: HealthTimingValue
  totalDurationMs: number
  timeoutPhase: HealthTimeoutPhase
}

export type OverdueFirstPageHealthResult = {
  ok: boolean
  errorClass: string
  referenceDate: string | null
  minimumDaysOverdue: number | null
  cutoff: string | null
  cursorMode: HealthCursorMode | null
  timeoutMs: number
  attempts: 1
  httpStatus: number | null
  contentType: string | "NOT_OBSERVED"
  timings: OverdueFirstPageHealthTimings
  success: boolean
  rowCount: number | null
  reportedTotal: number | null
  validUniquePkCount: number | null
  strictlyAscending: boolean | null
  idsGreaterThanCursor: boolean | null
  parseableDueDateCount: number | null
  invalidDueDateCount: number | null
  cancelledContractCount: number | null
  blockedContractCount: number | null
  missingContractStatusCount: number | null
  shapeValid: boolean
}

export function clampOverdueFirstPageHealthTimeoutMs(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n)) return OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_DEFAULT_MS
  const rounded = Math.floor(n)
  return Math.min(
    OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_MAX_MS,
    Math.max(OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_MIN_MS, rounded)
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function aggregateOverdueFirstPageHealthRows(input: {
  rows: Array<{
    invoicePk: string | null
    invoiceDueDate: string | null
    raw?: Record<string, unknown> | null
  }>
  cursorLastInvoicePk: string | null
  shapeValid: boolean
  reportedTotal: number | null
}): Pick<
  OverdueFirstPageHealthResult,
  | "rowCount"
  | "reportedTotal"
  | "validUniquePkCount"
  | "strictlyAscending"
  | "idsGreaterThanCursor"
  | "parseableDueDateCount"
  | "invalidDueDateCount"
  | "cancelledContractCount"
  | "blockedContractCount"
  | "missingContractStatusCount"
  | "shapeValid"
> {
  if (!input.shapeValid) {
    return {
      rowCount: null,
      reportedTotal: null,
      validUniquePkCount: null,
      strictlyAscending: null,
      idsGreaterThanCursor: null,
      parseableDueDateCount: null,
      invalidDueDateCount: null,
      cancelledContractCount: null,
      blockedContractCount: null,
      missingContractStatusCount: null,
      shapeValid: false,
    }
  }

  const rowCount = input.rows.length
  const pks: string[] = []
  const unique = new Set<string>()
  let parseableDueDateCount = 0
  let invalidDueDateCount = 0
  let cancelledContractCount = 0
  let blockedContractCount = 0
  let missingContractStatusCount = 0

  for (const row of input.rows) {
    const pk = parseOverdueInvoicePk(row.invoicePk)
    if (pk) {
      pks.push(pk)
      unique.add(pk)
    }
    if (parseInvoiceDueDate(row.invoiceDueDate)) {
      parseableDueDateCount += 1
    } else {
      invalidDueDateCount += 1
    }
    const raw = asRecord(row.raw) ?? {}
    const status = coalesceControllrStatus(raw, ["contract_status", "contractStatus"])
    if (status == null) {
      missingContractStatusCount += 1
    } else if (status === CONTROLLR_CONTRACT_STATUS_CODE.CANCELED) {
      cancelledContractCount += 1
    } else if (status === CONTROLLR_CONTRACT_STATUS_CODE.BLOCKED) {
      blockedContractCount += 1
    } else {
      void classifyClientContractCancellation({ contractStatus: status, raw })
    }
  }

  let strictlyAscending = true
  for (let i = 1; i < pks.length; i += 1) {
    if (compareOverdueInvoicePk(pks[i - 1], pks[i]) >= 0) {
      strictlyAscending = false
      break
    }
  }
  if (unique.size !== pks.length) {
    strictlyAscending = false
  }

  let idsGreaterThanCursor: boolean | null = true
  const cursor = parseOverdueInvoicePk(input.cursorLastInvoicePk)
  if (!cursor) {
    idsGreaterThanCursor = input.cursorLastInvoicePk == null ? true : false
  } else {
    for (const pk of pks) {
      if (compareOverdueInvoicePk(pk, cursor) <= 0) {
        idsGreaterThanCursor = false
        break
      }
    }
  }

  return {
    rowCount,
    reportedTotal: input.reportedTotal,
    validUniquePkCount: unique.size,
    strictlyAscending: pks.length === 0 ? true : strictlyAscending,
    idsGreaterThanCursor,
    parseableDueDateCount,
    invalidDueDateCount,
    cancelledContractCount,
    blockedContractCount,
    missingContractStatusCount,
    shapeValid: true,
  }
}

export function resolveHealthTimeoutPhase(input: {
  aborted: boolean
  httpStatus: number | null
  bodyReadComplete?: boolean
}): HealthTimeoutPhase {
  if (!input.aborted) return "not_applicable"
  if (input.httpStatus == null) return "awaiting_headers"
  if (input.bodyReadComplete === false) return "during_body"
  return "during_body"
}

export function summarizeOverdueFirstPageHealthResult(input: {
  timeoutMs: number
  referenceDate: string | null
  minimumDaysOverdue: number | null
  cursorMode: HealthCursorMode | null
  loginDurationMs: HealthTimingValue
  listTotalDurationMs: HealthTimingValue
  totalDurationMs: number
  httpStatus: number | null
  contentType?: string | null
  aborted?: boolean
  bodyReadComplete?: boolean
  transportMessage?: string
  earlyErrorClass?: string | null
  rows?: Array<{
    invoicePk: string | null
    invoiceDueDate: string | null
    raw?: Record<string, unknown> | null
  }>
  reportedTotal?: number | null
  shapeValid?: boolean
  cursorLastInvoicePk?: string | null
}): OverdueFirstPageHealthResult {
  const cutoff =
    input.referenceDate && input.minimumDaysOverdue
      ? queryCutoffExclusiveUtc(input.referenceDate, input.minimumDaysOverdue)
      : input.referenceDate
        ? queryCutoffExclusiveUtc(
            input.referenceDate,
            input.minimumDaysOverdue ?? COLLECTION_OVERDUE_THRESHOLD_DAYS
          )
        : null

  const aborted = Boolean(input.aborted)
  const timeoutPhase = resolveHealthTimeoutPhase({
    aborted,
    httpStatus: input.httpStatus,
    bodyReadComplete: input.bodyReadComplete,
  })

  let errorClass = input.earlyErrorClass ?? "ok"
  if (!input.earlyErrorClass) {
    if (aborted) {
      errorClass =
        timeoutPhase === "awaiting_headers"
          ? "list_timeout_headers"
          : "list_timeout_body"
    } else if (/login|cookie|credencia/i.test(input.transportMessage ?? "")) {
      errorClass = "login_failed"
    } else if (input.httpStatus != null && input.httpStatus !== 200) {
      errorClass = classifyControllrHttpStatus(input.httpStatus)
    } else if (input.shapeValid === false) {
      errorClass = "invalid_list_shape"
    }
  }

  const aggregates = aggregateOverdueFirstPageHealthRows({
    rows: input.rows ?? [],
    cursorLastInvoicePk: input.cursorLastInvoicePk ?? null,
    shapeValid: Boolean(input.shapeValid),
    reportedTotal: input.reportedTotal ?? null,
  })

  const success = Boolean(input.shapeValid) && !aborted && errorClass === "ok"
  const contentType =
    typeof input.contentType === "string" && input.contentType.trim()
      ? input.contentType.trim()
      : "NOT_OBSERVED"

  return {
    ok: success,
    errorClass,
    referenceDate: input.referenceDate,
    minimumDaysOverdue: input.minimumDaysOverdue,
    cutoff,
    cursorMode: input.cursorMode,
    timeoutMs: input.timeoutMs,
    attempts: OVERDUE_FIRST_PAGE_HEALTH_ATTEMPTS,
    httpStatus: input.httpStatus,
    contentType,
    timings: {
      loginDurationMs: input.loginDurationMs,
      listHeadersMs: "NOT_OBSERVED",
      listBodyReadMs: "NOT_OBSERVED",
      listTotalDurationMs: input.listTotalDurationMs,
      totalDurationMs: Math.max(0, Math.floor(input.totalDurationMs)),
      timeoutPhase,
    },
    success,
    ...aggregates,
  }
}

export const OVERDUE_FIRST_PAGE_HEALTH_PAGE_SIZE = OVERDUE_INVOICE_LIST_PAGE_SIZE
