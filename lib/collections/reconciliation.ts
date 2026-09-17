import { isControllrInvoicePaid } from "@/lib/collections/eligibility"
import { COLLECTION_OPEN_STATUSES, type CollectionCaseStatus } from "@/types/collections"

export const RECONCILIATION_POSITIVE_PAYMENT_RULE =
  'isPaid===true OR (invoice_msg==="paid" AND invoice_date_credit presente)' as const

export type ReconciliationOutcome =
  | "close_paid"
  | "still_open"
  | "removed_or_cancelled"
  | "not_found"
  | "invalid_detail"
  | "identity_mismatch"
  | "timeout_or_error"
  | "inconclusive"

export type ReconciliationEvidence = {
  isPaid: boolean
  invoiceMsg: string | null
  invoiceDateCredit: string | null
  invoiceDeleted: boolean
}

export type ReconciliationDetailResult = {
  outcome: ReconciliationOutcome
  requestedInvoicePk: string
  returnedInvoicePk: string | null
  errorClass: string | null
  evidence: ReconciliationEvidence | null
}

const REMOVED_MSG = new Set(["cancelled", "canceled", "deleted", "removed", "cancelado", "excluido"])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readPk(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value))
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    return /^[1-9]\d*$/.test(trimmed) ? trimmed : null
  }
  return null
}

export function invoicePkFromDetailRaw(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null
  return readPk(raw.invoice_pk ?? raw.invoicePk)
}

type DeletedIndicator =
  | { kind: "absent" }
  | { kind: "boolean"; value: boolean }
  | { kind: "unexpected" }

/**
 * Remoção só com booleano literal. String/número/objeto não viram deleted
 * nem autorizam close_paid; flags booleanas contraditórias também não.
 */
function readDeletedIndicator(raw: Record<string, unknown> | null): DeletedIndicator {
  if (!raw) return { kind: "absent" }
  let booleanValue: boolean | undefined
  for (const key of ["invoice_deleted", "invoiceDeleted"]) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (value === true || value === false) {
      if (booleanValue !== undefined && booleanValue !== value) {
        return { kind: "unexpected" }
      }
      booleanValue = value
      continue
    }
    return { kind: "unexpected" }
  }
  if (booleanValue === undefined) return { kind: "absent" }
  return { kind: "boolean", value: booleanValue }
}

/** Ramo booleano de pagamento: somente true literal. Strings/números não autorizam. */
function readStrictPaidFlag(raw: Record<string, unknown> | null): boolean {
  if (!raw) return false
  for (const key of ["isPaid", "is_paid"]) {
    if (raw[key] === true) return true
  }
  return false
}

function isRemovedOrCancelled(input: {
  invoiceMsg?: string | null
  invoiceDeleted?: boolean | null
}): boolean {
  if (input.invoiceDeleted === true) return true
  const msg = input.invoiceMsg?.trim().toLowerCase() ?? ""
  return REMOVED_MSG.has(msg)
}

function looksNotFound(input: { httpStatus: number | null; message?: string | null }): boolean {
  if (input.httpStatus === 404) return true
  const message = input.message?.toLowerCase() ?? ""
  return /not found|não encontrad|nao encontrad|inexistent|unknown invoice/.test(message)
}

/**
 * Classifica o detalhe da fatura para reconciliação.
 * Não usa ausência da lista de atrasados como pagamento.
 * Lê isPaid do raw quando presente: extractInvoiceInfo recalcula isPaid
 * só com invoice_msg+crédito e perderia a perna isPaid===true da regra vigente.
 */
export function classifyInvoiceDetailForReconciliation(input: {
  requestedInvoicePk: string
  ok: boolean
  httpStatus: number | null
  message?: string | null
  abortClass?: string | null
  info: {
    invoicePk?: string | null
    invoiceMsg?: string | null
    invoiceDateCredit?: string | null
    isPaid?: boolean | null
    raw?: Record<string, unknown> | null
  } | null
  payload?: unknown
}): ReconciliationDetailResult {
  const requested = input.requestedInvoicePk.trim()
  const abort = input.abortClass?.trim() ?? ""
  if (abort === "timeout" || abort === "transport" || abort === "external_abort") {
    return {
      outcome: "timeout_or_error",
      requestedInvoicePk: requested,
      returnedInvoicePk: null,
      errorClass: abort === "timeout" ? "detail_timeout" : "detail_error",
      evidence: null,
    }
  }

  if (!input.ok) {
    if (looksNotFound(input)) {
      return {
        outcome: "not_found",
        requestedInvoicePk: requested,
        returnedInvoicePk: null,
        errorClass: "detail_not_found",
        evidence: null,
      }
    }
    return {
      outcome: "timeout_or_error",
      requestedInvoicePk: requested,
      returnedInvoicePk: null,
      errorClass: "detail_error",
      evidence: null,
    }
  }

  const raw = input.info?.raw ?? asRecord(input.payload)
  const returnedPk = invoicePkFromDetailRaw(raw)
  if (!raw || !returnedPk) {
    return {
      outcome: "invalid_detail",
      requestedInvoicePk: requested,
      returnedInvoicePk: null,
      errorClass: "invalid_detail",
      evidence: null,
    }
  }
  if (returnedPk !== requested) {
    return {
      outcome: "identity_mismatch",
      requestedInvoicePk: requested,
      returnedInvoicePk: returnedPk,
      errorClass: "identity_mismatch",
      evidence: null,
    }
  }

  const invoiceMsg = input.info?.invoiceMsg ?? (typeof raw.invoice_msg === "string" ? raw.invoice_msg : null)
  const invoiceDateCredit =
    input.info?.invoiceDateCredit ??
    (typeof raw.invoice_date_credit === "string" ? raw.invoice_date_credit : null)
  const deletedIndicator = readDeletedIndicator(raw)
  const invoiceDeleted = deletedIndicator.kind === "boolean" ? deletedIndicator.value : false
  const rawPaid = readStrictPaidFlag(raw)
  const paid = isControllrInvoicePaid({
    isPaid: rawPaid || input.info?.isPaid === true,
    invoiceMsg,
    invoiceDateCredit,
  })
  const evidence: ReconciliationEvidence = {
    isPaid: paid,
    invoiceMsg: invoiceMsg ?? null,
    invoiceDateCredit: invoiceDateCredit ?? null,
    invoiceDeleted,
  }

  if (deletedIndicator.kind === "unexpected") {
    return {
      outcome: "inconclusive",
      requestedInvoicePk: requested,
      returnedInvoicePk: returnedPk,
      errorClass: "inconclusive_removal_indicator",
      evidence,
    }
  }

  if (isRemovedOrCancelled({ invoiceMsg, invoiceDeleted })) {
    return {
      outcome: "removed_or_cancelled",
      requestedInvoicePk: requested,
      returnedInvoicePk: returnedPk,
      errorClass: null,
      evidence,
    }
  }

  if (paid) {
    return {
      outcome: "close_paid",
      requestedInvoicePk: requested,
      returnedInvoicePk: returnedPk,
      errorClass: null,
      evidence,
    }
  }

  return {
    outcome: "still_open",
    requestedInvoicePk: requested,
    returnedInvoicePk: returnedPk,
    errorClass: null,
    evidence,
  }
}

export function shouldWriteReconciliationClosePaid(input: {
  outcome: ReconciliationOutcome
  currentStatus: CollectionCaseStatus | string | null | undefined
}): boolean {
  if (input.outcome !== "close_paid") return false
  return (COLLECTION_OPEN_STATUSES as readonly string[]).includes(input.currentStatus ?? "")
}

export function reconciliationAdvancesCursor(outcome: ReconciliationOutcome): boolean {
  return outcome !== "timeout_or_error"
}
