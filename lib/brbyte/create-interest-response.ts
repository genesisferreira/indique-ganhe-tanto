import "server-only"

import { brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import { BRBYTE_API_PATHS } from "@/types/brbyte"

const RESPONSE_LOG_TAG = "[brbyte:create-interest:response-body]"

export {
  BRBYTE_UNCONFIRMED_INTEREST_MESSAGE,
  isUnconfirmedBrbyteCreateError,
} from "@/lib/brbyte/create-interest-messages"

const SENSITIVE_KEY_PATTERN =
  /password|passwd|cookie|token|authorization|secret|api[_-]?key/i

const DOCUMENT_KEY_PATTERN = /(^doc|_doc|document|cpf|cnpj|rg)/i

export type BrbyteInterestResolution = {
  interestPk: string | null
  clientPk: string | null
  leadPk: string | null
  planPk: string | null
  interestStatus: string | null
  source:
    | "create_response"
    | "list_lookup"
    | "message_parse"
    | "request_fallback"
    | null
}

function readPkValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  return str.length > 0 ? str : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstArrayItem(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  return asRecord(value[0])
}

function collectMessageStrings(payload: unknown): string[] {
  const messages: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || value === undefined) return
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed) messages.push(trimmed)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 5)) visit(item, depth + 1)
      return
    }
    const obj = asRecord(value)
    if (!obj) return
    for (const [key, nested] of Object.entries(obj)) {
      if (/message|msg|detail|description|title|text/i.test(key)) {
        visit(nested, depth + 1)
      }
    }
  }
  visit(payload, 0)
  return messages
}

function redactResponseValue(key: string, value: unknown, depth: number): unknown {
  if (depth > 6) return "[truncated_depth]"

  if (SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]"

  if (typeof value === "string") {
    if (DOCUMENT_KEY_PATTERN.test(key)) return "[redacted_doc]"
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 10)
      .map((item, index) => redactResponseValue(String(index), item, depth + 1))
  }

  const obj = asRecord(value)
  if (!obj) return value

  const out: Record<string, unknown> = {}
  for (const [nestedKey, nestedValue] of Object.entries(obj)) {
    out[nestedKey] = redactResponseValue(nestedKey, nestedValue, depth + 1)
  }
  return out
}

export function summarizeCreateInterestResponseBody(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload
  if (typeof payload !== "object") {
    if (typeof payload === "string") {
      return payload.length > 2000 ? `${payload.slice(0, 2000)}…` : payload
    }
    return payload
  }

  if (Array.isArray(payload)) {
    return payload
      .slice(0, 10)
      .map((item, index) => redactResponseValue(String(index), item, 0))
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    out[key] = redactResponseValue(key, value, 0)
  }
  return out
}

export function logCreateInterestResponseBody(
  httpStatus: number | null,
  payload: unknown
): void {
  console.log(RESPONSE_LOG_TAG, {
    httpStatus,
    body: summarizeCreateInterestResponseBody(payload),
  })
}

export function isCreateInterestResponseSuccessful(
  payload: unknown,
  httpStatus: number | null
): boolean {
  if (httpStatus !== 200) return false
  const obj = asRecord(payload)
  if (!obj) return true
  if (obj.success === false || obj.error === true) return false
  return true
}

function extractInterestPkFromMessage(payload: unknown): string | null {
  for (const message of collectMessageStrings(payload)) {
    const hashMatch = message.match(
      /(?:interessado|interest)\s*#?\s*(\d{1,12})/i
    )
    if (hashMatch?.[1]) return hashMatch[1]

    const pkMatch = message.match(/interest[_\s-]*pk\s*[:=]\s*(\d{1,12})/i)
    if (pkMatch?.[1]) return pkMatch[1]
  }
  return null
}

function readFieldFromContainers(
  payload: unknown,
  field: string
): string | null {
  if (!payload || typeof payload !== "object") return null

  const root = payload as Record<string, unknown>
  const data = asRecord(root.data)
  const result = asRecord(root.result)
  const interest = asRecord(root.interest)
  const dataInterest = data ? asRecord(data.interest) : null
  const firstResult = firstArrayItem(root.results)
  const dataResults = data ? firstArrayItem(data.results) : null

  const candidates = [
    root[field],
    data?.[field],
    result?.[field],
    interest?.[field],
    dataInterest?.[field],
    firstResult?.[field],
    dataResults?.[field],
  ]

  for (const candidate of candidates) {
    const value = readPkValue(candidate)
    if (value) return value
  }

  return null
}

export function extractInterestPk(payload: unknown): string | null {
  const directPaths = [
    readFieldFromContainers(payload, "interest_pk"),
    readFieldFromContainers(payload, "client_interest_pk"),
    readFieldFromContainers(payload, "id_interessado"),
    readFieldFromContainers(payload, "idInteressado"),
    readFieldFromContainers(payload, "brbyte_id_interessado"),
    readFieldFromContainers(payload, "id"),
  ]

  for (const value of directPaths) {
    if (value) return value
  }

  return extractInterestPkFromMessage(payload)
}

export function extractInterestMeta(
  payload: unknown,
  requestFallback?: {
    leadPk?: string | null
    planPk?: string | null
  }
): Omit<BrbyteInterestResolution, "source"> {
  return {
    interestPk: extractInterestPk(payload),
    clientPk: readFieldFromContainers(payload, "client_pk"),
    leadPk:
      readFieldFromContainers(payload, "lead_pk") ??
      requestFallback?.leadPk ??
      null,
    planPk:
      readFieldFromContainers(payload, "plan_pk") ??
      requestFallback?.planPk ??
      null,
    interestStatus:
      readFieldFromContainers(payload, "interest_status") ??
      readFieldFromContainers(payload, "status") ??
      readFieldFromContainers(payload, "nomenclatura_status") ??
      readFieldFromContainers(payload, "nomenclaturaEstado"),
  }
}

export function extractInterestResolution(
  payload: unknown,
  requestFallback?: {
    leadPk?: string | null
    planPk?: string | null
  }
): BrbyteInterestResolution {
  const meta = extractInterestMeta(payload, requestFallback)
  const messagePk = meta.interestPk ? null : extractInterestPkFromMessage(payload)

  return {
    ...meta,
    interestPk: meta.interestPk ?? messagePk,
    source: meta.interestPk
      ? "create_response"
      : messagePk
        ? "message_parse"
        : null,
  }
}

function resolutionFromListPayload(
  payload: unknown,
  requestFallback?: {
    leadPk?: string | null
    planPk?: string | null
  }
): BrbyteInterestResolution | null {
  const root = asRecord(payload)
  if (!root) return null

  const candidates: unknown[] = [root]
  const data = asRecord(root.data)
  if (data) candidates.push(data)
  if (Array.isArray(root.results)) candidates.push(...root.results.slice(0, 5))
  if (data && Array.isArray(data.results)) {
    candidates.push(...data.results.slice(0, 5))
  }

  for (const candidate of candidates) {
    const meta = extractInterestMeta(candidate, requestFallback)
    if (meta.interestPk) {
      return { ...meta, source: "list_lookup" }
    }
  }

  const fallbackPk = extractInterestPk(payload)
  if (!fallbackPk) return null

  const meta = extractInterestMeta(payload, requestFallback)
  return { ...meta, interestPk: fallbackPk, source: "list_lookup" }
}

export async function lookupClientInterestByDocument(input: {
  config: BrbyteCreateInterestConfig
  cookie: string
  interestDoc1: string
  requestFallback?: {
    leadPk?: string | null
    planPk?: string | null
  }
}): Promise<BrbyteInterestResolution | null> {
  const doc = input.interestDoc1.replace(/\D/g, "")
  if (!doc) return null

  const lookupForms: Record<string, string>[] = [
    { "where[interest_doc1]": doc },
    { where: JSON.stringify({ interest_doc1: doc }) },
    { interest_doc1: doc },
  ]

  for (const fields of lookupForms) {
    const result = await brbyteAdminPostForm(
      input.config,
      input.cookie,
      BRBYTE_API_PATHS.listClientInterest,
      fields
    )

    if (!result.ok) continue

    logCreateInterestResponseBody(result.status, result.json)
    const resolved = resolutionFromListPayload(result.json, input.requestFallback)
    if (resolved?.interestPk) return resolved
  }

  return null
}
