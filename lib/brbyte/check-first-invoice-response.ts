import "server-only"

import { summarizeCreateInterestResponseBody } from "@/lib/brbyte/create-interest-response"
import type { BrbyteInvoiceInfo, BrbyteInvoiceListRow } from "@/types/brbyte"

const RESPONSE_LOG_TAG = "[brbyte:check-first-invoice:response-body]"

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readPkValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  return str.length > 0 ? str : null
}

function readBool(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "t" || normalized === "yes"
  }
  return false
}

function collectErrorStrings(payload: unknown): string[] {
  const messages: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || value === null || value === undefined) return
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed) messages.push(trimmed)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 8)) visit(item, depth + 1)
      return
    }
    const obj = asRecord(value)
    if (!obj) return
    for (const [key, nested] of Object.entries(obj)) {
      if (/message|msg|error|detail|description|title|text|reason/i.test(key)) {
        visit(nested, depth + 1)
      }
    }
  }
  visit(payload, 0)
  return messages
}

export function logCheckFirstInvoiceResponseBody(
  endpoint: string,
  httpStatus: number | null,
  payload: unknown
): void {
  console.log(RESPONSE_LOG_TAG, {
    endpoint,
    httpStatus,
    body: summarizeCreateInterestResponseBody(payload),
  })
}

function collectResultRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []

  const direct = root.results
  if (Array.isArray(direct)) {
    return direct
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
  }

  const data = asRecord(root.data)
  const fromData = data?.results
  if (Array.isArray(fromData)) {
    return fromData
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
  }

  const result = asRecord(root.result)
  if (result) return [result]

  return []
}

function parseInvoiceListRow(row: Record<string, unknown>): BrbyteInvoiceListRow {
  return {
    invoicePk: readPkValue(row.invoice_pk ?? row.invoicePk),
    contractPk: readPkValue(row.contract_pk ?? row.contractPk),
    invoiceDueDate: readPkValue(
      row.invoice_due_date ?? row.invoiceDueDate ?? row.due_date
    ),
    invoiceDate: readPkValue(
      row.invoice_date ?? row.invoiceDate ?? row.invoice_date_issue
    ),
    invoicePeriod: readPkValue(
      row.invoice_period ?? row.invoicePeriod ?? row.periodo ?? row.period
    ),
    invoiceDeleted: readBool(row.invoice_deleted ?? row.invoiceDeleted),
    raw: row,
  }
}

export function extractInvoiceListRows(payload: unknown): BrbyteInvoiceListRow[] {
  return collectResultRows(payload).map(parseInvoiceListRow)
}

function resolveFirstInfoRow(payload: unknown): Record<string, unknown> | null {
  const rows = collectResultRows(payload)
  if (rows.length > 0) return rows[0]

  const root = asRecord(payload)
  if (!root) return null

  const data = asRecord(root.data)
  if (data) return data

  return root
}

export function extractInvoiceInfo(payload: unknown): BrbyteInvoiceInfo {
  const row = resolveFirstInfoRow(payload)
  if (!row) {
    return {
      invoicePk: null,
      invoiceMsg: null,
      invoiceDateCredit: null,
      isPaid: false,
      raw: null,
    }
  }

  const invoiceMsg = readPkValue(row.invoice_msg ?? row.invoiceMsg)
  const invoiceDateCredit = readPkValue(
    row.invoice_date_credit ?? row.invoiceDateCredit
  )
  const isPaid =
    invoiceMsg?.toLowerCase() === "paid" && Boolean(invoiceDateCredit)

  return {
    invoicePk: readPkValue(row.invoice_pk ?? row.invoicePk),
    invoiceMsg,
    invoiceDateCredit,
    isPaid,
    raw: row,
  }
}

function parseSortableDate(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

/** Primeira mensalidade válida: fatura não excluída, ordenada pela data de vencimento/emissão. */
export function pickFirstValidInvoice(
  rows: BrbyteInvoiceListRow[]
): BrbyteInvoiceListRow | null {
  const candidates = rows.filter((row) => row.invoicePk && !row.invoiceDeleted)
  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const aKey =
      parseSortableDate(a.invoiceDueDate) ||
      parseSortableDate(a.invoiceDate) ||
      parseSortableDate(a.invoicePeriod)
    const bKey =
      parseSortableDate(b.invoiceDueDate) ||
      parseSortableDate(b.invoiceDate) ||
      parseSortableDate(b.invoicePeriod)
    return aKey - bKey
  })

  return candidates[0] ?? null
}

export function isInvoiceApiResponseSuccessful(
  payload: unknown,
  httpStatus: number | null
): boolean {
  if (httpStatus !== 200) return false
  const obj = asRecord(payload)
  if (!obj) return false
  if (obj.success === false || obj.error === true) return false
  return true
}

export function resolveInvoiceApiErrorMessage(
  payload: unknown,
  fallback?: string | null
): string {
  const root = asRecord(payload)
  if (typeof root?.message === "string" && root.message.trim()) {
    return root.message.trim()
  }

  for (const message of collectErrorStrings(payload)) {
    if (message.trim()) return message.trim()
  }

  return fallback?.trim() || "Falha ao consultar faturas no Controllr."
}

export function parseInvoiceCreditDate(value: string | null): string | null {
  if (!value?.trim()) return null
  const parsed = Date.parse(value.trim())
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}
