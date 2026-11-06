/**
 * Sprint 3.1F-H1 — modo sanitizado single-contract (puro, sem I/O).
 * Reduz a resposta do invoice/list a presença/tipos/contagens/booleanos.
 * Nunca devolve IDs, valores monetários, nomes ou payload.
 */

export const EMPLOYEE_COMMISSION_INVOICE_EVIDENCE_MODE =
  "employee_commission_invoice_evidence" as const
export const EMPLOYEE_EVIDENCE_ATTEMPTS = 1
export const EMPLOYEE_EVIDENCE_MAX_ROWS = 15
export const EMPLOYEE_EVIDENCE_MAX_TIMEOUT_MS = 70_000
export const EMPLOYEE_EVIDENCE_DEFAULT_TIMEOUT_MS = 70_000
/** Única ordenação comprovada ao vivo (3.1E-I). Campo oficial de data: NÃO comprovado. */
export const EMPLOYEE_EVIDENCE_SORT_FIELD = "invoice_pk"
export const EMPLOYEE_EVIDENCE_SORT_DIR = "ASC"
/** null = campo oficial de emissão ainda não comprovado → ordem da 1ª fatura INCONCLUSIVE. */
export const EMPLOYEE_EVIDENCE_OFFICIAL_ISSUE_DATE_FIELD: string | null = null

export const EMPLOYEE_EVIDENCE_FIELDS = [
  "invoice_pk",
  "contract_pk",
  "invoice_date",
  "invoice_date_issue",
  "invoice_date_due",
  "invoice_deleted",
  "invoice_amount",
  "invoice_amount_paid",
  "invoice_msg",
  "invoice_date_credit",
  "isPaid",
  "is_paid",
] as const

const CONTRACT_PK_RE = /^[1-9]\d{0,17}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/

export function parseEmployeeEvidenceContractPk(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value !== "string") return null
  const t = value.trim()
  return CONTRACT_PK_RE.test(t) && Number.isSafeInteger(Number(t)) ? t : null
}

export function clampEmployeeEvidenceTimeoutMs(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : EMPLOYEE_EVIDENCE_DEFAULT_TIMEOUT_MS
  return Math.min(EMPLOYEE_EVIDENCE_MAX_TIMEOUT_MS, Math.max(1_000, n))
}

/** Form oficial (where em array JSON, mesmo formato do keyset de atrasados). */
export function buildEmployeeEvidenceFormFields(contractPk: string): Record<string, string> {
  return {
    where: JSON.stringify([
      { field: "contract_pk", oper: 7, value: Number(contractPk) },
      { field: "AND" },
      { field: "invoice_deleted", oper: 7, value: false },
    ]),
    page: "1",
    start: "0",
    limit: String(EMPLOYEE_EVIDENCE_MAX_ROWS),
    sort: EMPLOYEE_EVIDENCE_SORT_FIELD,
    dir: EMPLOYEE_EVIDENCE_SORT_DIR,
  }
}

type FieldStat = {
  presentCount: number
  explicitNullCount: number
  observedTypes: string[]
  validFormatCount: number
}

export type EmployeeEvidenceResult = {
  ok: boolean
  mode: typeof EMPLOYEE_COMMISSION_INVOICE_EVIDENCE_MODE
  classification:
    | "EVIDENCE_COLLECTED"
    | "INSUFFICIENT_SAMPLE"
    | "ERP_TIMEOUT_INCONCLUSIVE"
    | "ERP_ERROR"
    | "AUTH_OR_CONFIG_FAILURE"
    | "INVALID_SHAPE"
  attempts: number
  retryExecuted: false
  timeoutMs: number
  durationMs: number
  httpStatus: number | null
  rowCount: number
  reportedTotal: number | null
  pageCoversContract: boolean
  validUniqueInvoicePk: boolean
  contractIdConsistent: boolean
  deletedRowsReturned: number
  fields: Record<string, FieldStat>
  aliasConflictCount: number
  officialIssueDateField: string | null
  stableOrderByInvoicePk: boolean
  firstInvoiceOrderProven: boolean
  paidAmountFieldProven: boolean
  documentAmountFieldProven: boolean
  partialPaymentCount: number
  overpaymentCount: number
  paymentConflictCount: number
  partialPaymentDistinguishable: boolean
  fullPaymentDistinguishable: boolean
  absenceTreatedAsPayment: false
}

function typeOf(v: unknown): string {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  return null
}

function validFor(field: string, v: unknown): boolean {
  if (v == null) return false
  switch (field) {
    case "invoice_pk":
    case "contract_pk":
      return parseEmployeeEvidenceContractPk(v) != null
    case "invoice_deleted":
    case "isPaid":
    case "is_paid":
      return typeof v === "boolean" || v === 0 || v === 1 || v === "0" || v === "1" || v === "true" || v === "false"
    case "invoice_amount":
    case "invoice_amount_paid":
      return num(v) != null && (num(v) as number) >= 0
    case "invoice_msg":
      return typeof v === "string"
    default:
      return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10)))
  }
}

function extractRows(json: unknown): { rows: Record<string, unknown>[] | null; total: number | null } {
  if (!json || typeof json !== "object") return { rows: null, total: null }
  const o = json as Record<string, unknown>
  const cand = [o.data, o.rows, o.items, (o.data as Record<string, unknown> | undefined)?.rows]
  const rows = cand.find((c) => Array.isArray(c)) as unknown[] | undefined
  const totalRaw = o.total ?? o.totalCount ?? o.count ?? (o.data as Record<string, unknown> | undefined)?.total
  const total = num(totalRaw)
  if (!rows) return { rows: null, total }
  return { rows: rows.filter((r) => r && typeof r === "object") as Record<string, unknown>[], total }
}

export function summarizeEmployeeEvidence(input: {
  contractPk: string
  timeoutMs: number
  durationMs: number
  httpStatus: number | null
  json: unknown
  transport: "ok" | "timeout" | "error" | "auth_or_config"
}): EmployeeEvidenceResult {
  const base: EmployeeEvidenceResult = {
    ok: false,
    mode: EMPLOYEE_COMMISSION_INVOICE_EVIDENCE_MODE,
    classification: "ERP_ERROR",
    attempts: input.transport === "auth_or_config" ? 0 : EMPLOYEE_EVIDENCE_ATTEMPTS,
    retryExecuted: false,
    timeoutMs: input.timeoutMs,
    durationMs: input.durationMs,
    httpStatus: input.httpStatus,
    rowCount: 0,
    reportedTotal: null,
    pageCoversContract: false,
    validUniqueInvoicePk: false,
    contractIdConsistent: false,
    deletedRowsReturned: 0,
    fields: {},
    aliasConflictCount: 0,
    officialIssueDateField: EMPLOYEE_EVIDENCE_OFFICIAL_ISSUE_DATE_FIELD,
    stableOrderByInvoicePk: false,
    firstInvoiceOrderProven: false,
    paidAmountFieldProven: false,
    documentAmountFieldProven: false,
    partialPaymentCount: 0,
    overpaymentCount: 0,
    paymentConflictCount: 0,
    partialPaymentDistinguishable: false,
    fullPaymentDistinguishable: false,
    absenceTreatedAsPayment: false,
  }
  if (input.transport === "timeout") return { ...base, classification: "ERP_TIMEOUT_INCONCLUSIVE" }
  if (input.transport === "auth_or_config") return { ...base, classification: "AUTH_OR_CONFIG_FAILURE" }
  if (input.transport === "error") return base
  const { rows, total } = extractRows(input.json)
  if (!rows) return { ...base, classification: "INVALID_SHAPE" }

  const fields: Record<string, FieldStat> = {}
  for (const f of EMPLOYEE_EVIDENCE_FIELDS) {
    const types = new Set<string>()
    let present = 0, nul = 0, valid = 0
    for (const r of rows) {
      if (Object.prototype.hasOwnProperty.call(r, f)) {
        present += 1
        if (r[f] === null) nul += 1
        types.add(typeOf(r[f]))
        if (validFor(f, r[f])) valid += 1
      }
    }
    fields[f] = { presentCount: present, explicitNullCount: nul, observedTypes: [...types].sort(), validFormatCount: valid }
  }

  const pks = rows.map((r) => parseEmployeeEvidenceContractPk(r.invoice_pk))
  const validUnique = pks.every((p) => p != null) && new Set(pks).size === pks.length
  let stable = validUnique
  for (let i = 1; stable && i < pks.length; i += 1) {
    if (BigInt(pks[i] as string) <= BigInt(pks[i - 1] as string)) stable = false
  }
  const contractConsistent =
    rows.length > 0 && rows.every((r) => parseEmployeeEvidenceContractPk(r.contract_pk) === input.contractPk)
  const deleted = rows.filter((r) => r.invoice_deleted === true || r.invoice_deleted === 1 || r.invoice_deleted === "1" || r.invoice_deleted === "true").length

  let aliasConflicts = 0, partial = 0, over = 0, conflicts = 0
  for (const r of rows) {
    const a = r.isPaid, b = r.is_paid
    if (a !== undefined && b !== undefined && String(a) !== String(b)) aliasConflicts += 1
    const doc = num(r.invoice_amount)
    const paid = num(r.invoice_amount_paid)
    const msgPaid = r.invoice_msg === "paid"
    const credited = typeof r.invoice_date_credit === "string" && r.invoice_date_credit.trim() !== ""
    if (doc != null && paid != null) {
      if (paid > 0 && paid < doc) partial += 1
      if (paid > doc) over += 1
      if (msgPaid && paid < doc) conflicts += 1
    }
    if (msgPaid !== credited) conflicts += 1
  }

  const coverage = total != null && rows.length <= EMPLOYEE_EVIDENCE_MAX_ROWS && total === rows.length
  const paidProven = rows.length > 0 && fields.invoice_amount_paid.validFormatCount === rows.length
  const docProven = rows.length > 0 && fields.invoice_amount.validFormatCount === rows.length
  const issueField = EMPLOYEE_EVIDENCE_OFFICIAL_ISSUE_DATE_FIELD
  const firstOrder =
    issueField != null && contractConsistent && stable && coverage &&
    fields[issueField]?.validFormatCount === rows.length

  return {
    ...base,
    ok: true,
    classification: rows.length === 0 ? "INSUFFICIENT_SAMPLE" : "EVIDENCE_COLLECTED",
    rowCount: rows.length,
    reportedTotal: total,
    pageCoversContract: coverage,
    validUniqueInvoicePk: validUnique,
    contractIdConsistent: contractConsistent,
    deletedRowsReturned: deleted,
    fields,
    aliasConflictCount: aliasConflicts,
    stableOrderByInvoicePk: stable,
    firstInvoiceOrderProven: firstOrder,
    paidAmountFieldProven: paidProven,
    documentAmountFieldProven: docProven,
    partialPaymentCount: partial,
    overpaymentCount: over,
    paymentConflictCount: conflicts,
    partialPaymentDistinguishable: paidProven && docProven,
    fullPaymentDistinguishable: paidProven && docProven && conflicts === 0,
  }
}
