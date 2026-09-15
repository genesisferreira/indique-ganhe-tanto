import { classifyControllrHttpStatus } from "@/lib/brbyte/http-error-diagnostics"
import { invoiceListFormsIncludeContractPk } from "@/lib/brbyte/invoice-list-pagination"

export const INVOICE_LIST_PROBE_PAGE_SIZE = 1
export const INVOICE_LIST_PROBE_ATTEMPTS = 1
export const INVOICE_LIST_PROBE_TIMEOUT_MIN_MS = 3_000
export const INVOICE_LIST_PROBE_TIMEOUT_MAX_MS = 12_000
export const INVOICE_LIST_PROBE_TIMEOUT_DEFAULT_MS = 8_000

export const INVOICE_LIST_PROBE_FORMAT_IDS = ["devtools_where_json"] as const

export type InvoiceListProbeFormatId =
  (typeof INVOICE_LIST_PROBE_FORMAT_IDS)[number]

/** Wiki BrByte REST-HTTP: oper 5 =, 7 IS, 4 >=, 3 <=. AND junta regras. */
export const INVOICE_LIST_PROBE_WHERE_FILTERS = [
  { field: "client_status", oper: 5, value: 0 },
  { field: "AND" },
  { field: "invoice_deleted", oper: 7, value: false },
  { field: "AND" },
  { field: "invoice_date_due", oper: 4, value: "2026-09-01 00:00:00" },
  { field: "AND" },
  { field: "invoice_date_due", oper: 3, value: "2026-09-30 23:59:59" },
] as const

export const INVOICE_LIST_PROBE_CONTRACT_NOTES = [
  "Formato observado no DevTools: where JSON + page/start/limit/sort/dir, sem contract_pk.",
  "reportedTotal é o total do recorte filtrado, não a base global (3188 no print era filtrado, limit=15).",
  "operadores field/oper/value vêm da wiki BrByte REST-HTTP, não de um HAR versionado neste repositório.",
  "Este probe não declara cobertura da base completa nem percorre outras páginas.",
] as const

export type InvoiceListProbeResult = {
  ok: boolean
  formId: InvoiceListProbeFormatId
  formatIndex: number
  fieldKeys: string[]
  attempts: 1
  timeoutMs: number
  durationMs: number
  httpStatus: number | null
  errorClass: string
  sanitizedError: string | null
  shapeValid: boolean
  pageCount: number | null
  reportedTotal: number | null
  fullBaseCoverageClaimed: false
  contractNotes: string[]
}

export function clampInvoiceListProbeTimeoutMs(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n)) return INVOICE_LIST_PROBE_TIMEOUT_DEFAULT_MS
  const rounded = Math.floor(n)
  return Math.min(
    INVOICE_LIST_PROBE_TIMEOUT_MAX_MS,
    Math.max(INVOICE_LIST_PROBE_TIMEOUT_MIN_MS, rounded)
  )
}

export function parseInvoiceListProbeFormatIndex(_raw?: unknown): number {
  return 0
}

export function buildInvoiceListProbeWhereJson(): string {
  return JSON.stringify(INVOICE_LIST_PROBE_WHERE_FILTERS)
}

export function buildInvoiceListProbeFormFields(): Record<string, string> {
  return {
    where: buildInvoiceListProbeWhereJson(),
    page: "1",
    start: "0",
    limit: String(INVOICE_LIST_PROBE_PAGE_SIZE),
    sort: "client_complete_name",
    dir: "ASC",
  }
}

export function selectInvoiceListProbeForm(_formatIndex?: unknown): {
  formId: InvoiceListProbeFormatId
  formatIndex: number
  fields: Record<string, string>
  fieldKeys: string[]
} {
  const fields = buildInvoiceListProbeFormFields()
  if (invoiceListFormsIncludeContractPk([fields])) {
    throw new Error("Probe recusou formulário com contract_pk.")
  }
  return {
    formId: INVOICE_LIST_PROBE_FORMAT_IDS[0],
    formatIndex: 0,
    fields,
    fieldKeys: Object.keys(fields),
  }
}

function isAbortMessage(message: string | undefined): boolean {
  if (!message) return false
  return /abort/i.test(message)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function probeListPageCount(payload: unknown): number {
  const root = asRecord(payload)
  if (!root) return 0
  if (Array.isArray(root.results)) return root.results.length
  const data = asRecord(root.data)
  if (Array.isArray(data?.results)) return data.results.length
  return 0
}

function probeListReportedTotal(payload: unknown, pageCount: number): number | null {
  const root = asRecord(payload)
  if (!root) return null
  const candidates = [
    root.total,
    root.recordsTotal,
    root.recordsFiltered,
    root.count,
    asRecord(root.data)?.total,
    asRecord(root.data)?.recordsTotal,
  ]
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value)
    }
  }
  return pageCount > 0 ? null : 0
}

function probeListShapeValid(payload: unknown, httpStatus: number | null): boolean {
  if (httpStatus !== 200) return false
  const obj = asRecord(payload)
  if (!obj) return false
  if (obj.success === false || obj.error === true) return false
  return true
}

export function summarizeInvoiceListProbeResult(input: {
  formatIndex?: unknown
  timeoutMs: number
  durationMs: number
  httpStatus: number | null
  json: unknown
  transportMessage?: string
}): InvoiceListProbeResult {
  const selected = selectInvoiceListProbeForm()
  const aborted = isAbortMessage(input.transportMessage)
  const shapeValid = probeListShapeValid(input.json, input.httpStatus)
  let pageCount: number | null = null
  let reportedTotal: number | null = null
  if (shapeValid) {
    pageCount = probeListPageCount(input.json)
    reportedTotal = probeListReportedTotal(input.json, pageCount)
  }

  const errorClass = aborted
    ? "timeout_aborted"
    : classifyControllrHttpStatus(input.httpStatus)

  let sanitizedError: string | null = null
  if (aborted) {
    sanitizedError = "Operação abortada pelo timeout local do CRM."
  } else if (/login|cookie|credencia/i.test(input.transportMessage ?? "")) {
    sanitizedError = "Falha no login operacional do Controllr."
  } else if (input.httpStatus != null && input.httpStatus !== 200) {
    sanitizedError = `HTTP ${input.httpStatus}`
  } else if (!shapeValid) {
    sanitizedError = "Falha de transporte ou corpo sem shape de listagem."
  }

  const root = asRecord(input.json)
  if (root && ("raw" in root || "password" in root || "cookie" in root)) {
    sanitizedError = sanitizedError ?? "Corpo não JSON de listagem; conteúdo omitido."
  }

  return {
    ok: shapeValid && !aborted,
    formId: selected.formId,
    formatIndex: selected.formatIndex,
    fieldKeys: selected.fieldKeys,
    attempts: INVOICE_LIST_PROBE_ATTEMPTS,
    timeoutMs: input.timeoutMs,
    durationMs: Math.max(0, Math.floor(input.durationMs)),
    httpStatus: input.httpStatus,
    errorClass,
    sanitizedError,
    shapeValid,
    pageCount,
    reportedTotal,
    fullBaseCoverageClaimed: false,
    contractNotes: [...INVOICE_LIST_PROBE_CONTRACT_NOTES],
  }
}
