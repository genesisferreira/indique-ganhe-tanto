/**
 * 3.1F-J15B — regras fechadas do Controllr para contrato, primeira fatura,
 * crédito do indicador e comissão fixa. Sem I/O e sem valor de fatura no reward.
 */

export const INDICATOR_PAYMENT_RULE = "invoice_date_credit_present" as const
export const INDICATOR_FULL_AMOUNT_MATCH_REQUIRED = false
export const PARTIAL_PAYMENT_BLOCKS_REWARD = false
export const NEGOTIATED_PAYMENT_ACCEPTED = true
export const REWARD_AMOUNT_SOURCE = "program_plan_rule" as const
export const INVOICE_PAID_AMOUNT_USED_FOR_REWARD = false
export const ACTIVE_CONTRACT_STATUS = 0
export const INVOICE_EQUAL_OPER = 5
export const INVOICE_IS_OPER = 7
export const INDICATOR_CREDIT_KEY_TYPE = "indicator_first_invoice_credit" as const

export function indicatorRuleVersion(input: {
  planId?: string | null
  rewardAmount?: string | number | null
}): string {
  const planId = input.planId?.trim()
  if (planId) return `plan:${planId}`
  if (input.rewardAmount != null && String(input.rewardAmount).trim()) {
    return `rule:${String(input.rewardAmount).trim()}`
  }
  return "rule:missing"
}

export function buildIndicatorFirstInvoiceCreditKey(input: {
  referralId: string
  invoicePk: string
  ruleVersion: string
}): string {
  return [
    INDICATOR_CREDIT_KEY_TYPE,
    input.referralId.trim(),
    input.invoicePk.trim(),
    input.ruleVersion.trim(),
  ].join(":")
}

export function classifyAutomaticReward(input: {
  eligible: boolean
  invoiceFound: boolean
  creditValid: boolean
  rewardExists: boolean
  walletExists: boolean
  origin: "indicator" | "legacy" | "employee" | "partner" | "other"
}): "created" | "replayed" | "blocked" | "inconclusive" {
  if (input.origin === "employee" || input.origin === "partner") return "blocked"
  if (!input.invoiceFound) return "inconclusive"
  if (!input.creditValid || !input.eligible) return "blocked"
  if (input.rewardExists && input.walletExists) return "replayed"
  if (input.rewardExists !== input.walletExists) return "blocked"
  return "created"
}

export function shouldAlertFirstAutomaticReward(previousAutomaticRewards: number): boolean {
  return previousAutomaticRewards === 0
}

export const PERCENTAGE_COMMISSION_ENABLED = false
export const FIRST_INVOICE_VALUE_COMMISSION_ENABLED = false

const PK_RE = /^[1-9]\d{0,17}$/
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/

export type ClosedInvoice = {
  invoicePk: string
  contractPk: string
  clientPk: string
  documentAtMs: number
  creditAtIso: string | null
}

export type ActiveContractDecision =
  | { status: "found"; contractPk: string }
  | { status: "none" | "ambiguous" | "inconclusive" }

export function parsePositiveIntegerPk(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!PK_RE.test(trimmed)) return null
  const asNumber = Number(trimmed)
  return Number.isSafeInteger(asNumber) ? trimmed : null
}

function parseOfficialDateTime(value: unknown): number | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  const match = DATE_TIME_RE.exec(trimmed)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  const ms = Date.parse(trimmed.replace(" ", "T") + "Z")
  if (!Number.isFinite(ms)) return null
  const check = new Date(ms)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return ms
}

export function parseOfficialCreditDate(value: unknown): string | null {
  const ms = parseOfficialDateTime(value)
  return ms == null ? null : new Date(ms).toISOString()
}

export function creditDateProvesIndicatorPayment(value: unknown): boolean {
  return parseOfficialCreditDate(value) != null
}

export function buildOfficialInvoiceWhere(clientPk: string, contractPk: string) {
  const client = Number(clientPk)
  const contract = Number(contractPk)
  return [
    { field: "client.client_pk", oper: INVOICE_EQUAL_OPER, value: client },
    { field: "AND" },
    { field: "invoice.contract_pk", oper: INVOICE_EQUAL_OPER, value: contract },
    { field: "AND" },
    { field: "invoice_deleted", oper: INVOICE_IS_OPER, value: false },
  ]
}

export function buildOfficialContractWhere(clientPk: string) {
  return [
    { field: "client.client_pk", oper: INVOICE_EQUAL_OPER, value: Number(clientPk) },
  ]
}

function readClientPk(row: Record<string, unknown>): string | null {
  return (
    parsePositiveIntegerPk(row.client_pk) ??
    parsePositiveIntegerPk(row["client.client_pk"])
  )
}

export function classifyContractRow(
  row: Record<string, unknown>,
  expectedClientPk: string
): "active" | "excluded" | "other_client" | "inconclusive" {
  const clientPk = readClientPk(row)
  const contractPk = parsePositiveIntegerPk(row.contract_pk)
  if (!clientPk || !contractPk) return "inconclusive"
  if (clientPk !== expectedClientPk) return "other_client"
  if (row.contract_deleted === true) return "excluded"
  if (row.contract_deleted !== false) return "inconclusive"
  if (typeof row.contract_status !== "number" || !Number.isInteger(row.contract_status)) {
    return "inconclusive"
  }
  if (row.contract_status === ACTIVE_CONTRACT_STATUS) return "active"
  return "excluded"
}

export function selectActiveContract(
  rows: Record<string, unknown>[],
  expectedClientPk: string
): ActiveContractDecision {
  const active: string[] = []
  for (const row of rows) {
    const kind = classifyContractRow(row, expectedClientPk)
    if (kind === "inconclusive" || kind === "other_client") return { status: "inconclusive" }
    if (kind === "active") {
      const pk = parsePositiveIntegerPk(row.contract_pk)
      if (!pk) return { status: "inconclusive" }
      active.push(pk)
    }
  }
  const unique = [...new Set(active)]
  if (unique.length === 1) return { status: "found", contractPk: unique[0] }
  if (unique.length === 0) return { status: "none" }
  return { status: "ambiguous" }
}

export function parseClosedInvoice(
  row: Record<string, unknown>,
  expected: { clientPk: string; contractPk: string }
): ClosedInvoice | "reject" {
  if (row.invoice_deleted !== false) return "reject"
  const invoicePk = parsePositiveIntegerPk(row.invoice_pk)
  const contractPk = parsePositiveIntegerPk(row.contract_pk)
  const clientPk = readClientPk(row)
  const documentAtMs = parseOfficialDateTime(row.invoice_date_document)
  if (!invoicePk || !contractPk || !clientPk || documentAtMs == null) return "reject"
  if (contractPk !== expected.contractPk || clientPk !== expected.clientPk) return "reject"
  return {
    invoicePk,
    contractPk,
    clientPk,
    documentAtMs,
    creditAtIso: parseOfficialCreditDate(row.invoice_date_credit),
  }
}

export function selectFirstInvoice(
  rows: Record<string, unknown>[],
  expected: { clientPk: string; contractPk: string }
): ClosedInvoice | null {
  const accepted: ClosedInvoice[] = []
  for (const row of rows) {
    const parsed = parseClosedInvoice(row, expected)
    if (parsed !== "reject") accepted.push(parsed)
  }
  accepted.sort((a, b) => {
    if (a.documentAtMs !== b.documentAtMs) return a.documentAtMs - b.documentAtMs
    return Number(a.invoicePk) - Number(b.invoicePk)
  })
  return accepted[0] ?? null
}

export function fixedCommissionMayAccrue(input: {
  origin: "indicator" | "employee" | "partner" | "other"
  activeContract: boolean
  validInvoice: boolean
  entitlementExists: boolean
  fixedRuleActive: boolean
  method: "fixed_amount" | "percentage" | "first_invoice_value"
}): boolean {
  if (input.origin !== "employee" && input.origin !== "partner") return false
  if (input.method !== "fixed_amount") return false
  return (
    input.activeContract &&
    input.validInvoice &&
    input.fixedRuleActive &&
    !input.entitlementExists
  )
}

export function classifyTransport(input: {
  httpStatus: number | null
  timedOut: boolean
  malformed: boolean
}): "ok" | "inconclusive" {
  if (input.timedOut || input.malformed || input.httpStatus !== 200) return "inconclusive"
  return "ok"
}
