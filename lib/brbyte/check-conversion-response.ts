import "server-only"

import { brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import { summarizeCreateInterestResponseBody } from "@/lib/brbyte/create-interest-response"
import { BRBYTE_API_PATHS } from "@/types/brbyte"

const RESPONSE_LOG_TAG = "[brbyte:check-conversion:response-body]"

export type BrbyteListInterestResolution = {
  clientPk: string | null
  contractPk: string | null
  interestPk: string | null
  planPk: string | null
  addressPk: string | null
  emailPk: string | null
  ticketPk: string | null
  rawResult: Record<string, unknown> | null
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

export function logCheckConversionResponseBody(
  httpStatus: number | null,
  payload: unknown
): void {
  console.log(RESPONSE_LOG_TAG, {
    httpStatus,
    body: summarizeCreateInterestResponseBody(payload),
  })
}

function resolveFirstResultRow(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload)
  if (!root) return null

  const direct = firstArrayItem(root.results)
  if (direct) return direct

  const data = asRecord(root.data)
  const fromData = data ? firstArrayItem(data.results) : null
  if (fromData) return fromData

  const result = asRecord(root.result)
  if (result) return result

  return root
}

export function extractListInterestResolution(
  payload: unknown
): BrbyteListInterestResolution {
  const row = resolveFirstResultRow(payload)

  if (!row) {
    return {
      clientPk: null,
      contractPk: null,
      interestPk: null,
      planPk: null,
      addressPk: null,
      emailPk: null,
      ticketPk: null,
      rawResult: null,
    }
  }

  return {
    clientPk: readPkValue(row.client_pk),
    contractPk:
      readPkValue(row.contract_pk) ??
      readPkValue(row.contractPk) ??
      readPkValue(row.id_contrato),
    interestPk: readPkValue(row.interest_pk),
    planPk: readPkValue(row.plan_pk),
    addressPk: readPkValue(row.address_pk),
    emailPk: readPkValue(row.email_pk),
    ticketPk: readPkValue(row.ticket_pk),
    rawResult: row,
  }
}

export function isListInterestResponseSuccessful(
  payload: unknown,
  httpStatus: number | null
): boolean {
  if (httpStatus !== 200) return false
  const obj = asRecord(payload)
  if (!obj) return false
  if (obj.success === false || obj.error === true) return false
  return true
}

export function resolveListInterestErrorMessage(
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

  return fallback?.trim() || "Falha ao consultar Interessado no Controllr."
}

export async function lookupClientInterestByInterestPk(input: {
  config: BrbyteCreateInterestConfig
  cookie: string
  interestPk: string
}): Promise<{
  resolution: BrbyteListInterestResolution | null
  payload: Record<string, unknown> | null
  httpStatus: number | null
}> {
  const interestPk = input.interestPk.trim()
  if (!interestPk) {
    return { resolution: null, payload: null, httpStatus: null }
  }

  const lookupForms: Record<string, string>[] = [
    { "where[interest_pk]": interestPk },
    { where: JSON.stringify({ interest_pk: interestPk }) },
    { interest_pk: interestPk },
  ]

  for (const fields of lookupForms) {
    const result = await brbyteAdminPostForm(
      input.config,
      input.cookie,
      BRBYTE_API_PATHS.listClientInterest,
      fields
    )

    if (!result.ok) continue

    logCheckConversionResponseBody(result.status, result.json)

    const payload =
      result.json && typeof result.json === "object"
        ? (result.json as Record<string, unknown>)
        : { raw: result.json }

    const resolution = extractListInterestResolution(result.json)
    if (resolution.interestPk || resolution.clientPk || resolution.rawResult) {
      return {
        resolution,
        payload,
        httpStatus: result.status,
      }
    }
  }

  return { resolution: null, payload: null, httpStatus: null }
}
