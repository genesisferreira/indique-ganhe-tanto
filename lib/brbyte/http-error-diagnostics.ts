/**
 * Diagnóstico sanitizado de erros HTTP Controllr/BRByte.
 * Não envia, não corrige e não loga valores sensíveis (docs, cookies, tokens, PII).
 */

export const CREATE_INTEREST_EXPECTED_FIELDS = [
  "lead_pk",
  "interest_status",
  "interest_type",
  "interest_name",
  "interest_lastname",
  "interest_doc1",
  "interest_doc2",
  "interest_phone_number",
  "interest_email_addr",
  "interest_addr_zipcode",
  "interest_addr_state",
  "interest_addr_city",
  "interest_addr_neighborhood",
  "interest_addr_address",
  "interest_addr_number",
  "interest_addr_obs",
  "client_date_birth",
  "plan_pk",
  "interest_obs",
] as const

export type CreateInterestFieldName =
  (typeof CREATE_INTEREST_EXPECTED_FIELDS)[number]

export type ControllrHttpErrorClass =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "server_error"
  | "network_or_unknown"
  | "ok"

export type FieldPresence = {
  key: string
  present: boolean
  empty: boolean
  length: number | null
}

export type CreateInterestFormRiskCode =
  | "birth_date_iso_not_br"
  | "birth_date_missing_when_key_absent"
  | "required_config_blank"
  | "required_identity_blank"
  | "address_fields_omitted"
  | "email_omitted"
  | "interest_obs_near_limit"

export type CreateInterestFormRisk = {
  code: CreateInterestFormRiskCode
  severity: "high" | "medium" | "low"
  detail: string
}

export type SanitizedControllrHttpDiagnostics = {
  path: string
  status: number | null
  errorClass: ControllrHttpErrorClass
  attempt: number
  fieldKeysSent: string[]
  fieldCount: number
  omittedEmptyFieldCount: number
  responseContentTypeHint: "json" | "html" | "text" | "empty" | "unknown"
  responseMessageHint: string | null
  responseKeys: string[]
  bodyByteLength: number
  /** Trecho sem dígitos/e-mails — só para classificação, não para exibir PII. */
  bodyShapeHint: string | null
}

const ISO_BIRTH = /^\d{4}-\d{2}-\d{2}$/
const BR_BIRTH = /^\d{2}\/\d{2}\/\d{4}$/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function classifyControllrHttpStatus(
  status: number | null
): ControllrHttpErrorClass {
  if (status == null) return "network_or_unknown"
  if (status >= 200 && status < 300) return "ok"
  if (status === 400) return "bad_request"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status >= 500) return "server_error"
  return "network_or_unknown"
}

/** Inventário de campos: presença/vazio/tamanho — nunca o valor. */
export function inventoryFormFields(
  fields: Record<string, string>,
  expectedKeys: readonly string[] = CREATE_INTEREST_EXPECTED_FIELDS
): FieldPresence[] {
  const sent = new Map(
    Object.entries(fields).map(([key, value]) => [key, value] as const)
  )

  return expectedKeys.map((key) => {
    if (!sent.has(key)) {
      return { key, present: false, empty: true, length: null }
    }
    const value = sent.get(key) ?? ""
    return {
      key,
      present: true,
      empty: value === "",
      length: value.length,
    }
  })
}

/**
 * Espelha a regra de `brbyteAdminPostForm`: strings vazias não entram no body.
 */
export function listOmittedEmptyFields(
  fields: Record<string, string>
): string[] {
  return Object.entries(fields)
    .filter(([, value]) => value === "")
    .map(([key]) => key)
}

export function detectBirthDateFormat(
  value: string | null | undefined
): "iso" | "br" | "other" | "empty" {
  const raw = (value ?? "").trim()
  if (!raw) return "empty"
  if (ISO_BIRTH.test(raw)) return "iso"
  if (BR_BIRTH.test(raw)) return "br"
  return "other"
}

/**
 * Riscos conhecidos no formulário de create interest — baseados no código atual.
 * Não afirma causa confirmada sem corpo de resposta do ERP.
 */
export function inspectCreateInterestFormRisks(
  fields: Record<string, string>
): CreateInterestFormRisk[] {
  const risks: CreateInterestFormRisk[] = []
  const birth = fields.client_date_birth
  const birthFormat = detectBirthDateFormat(birth)

  if (birthFormat === "iso") {
    risks.push({
      code: "birth_date_iso_not_br",
      severity: "high",
      detail:
        "client_date_birth ainda está em YYYY-MM-DD no payload Controllr; esperado DD/MM/YYYY (regressão da Sprint 1.1B).",
    })
  }

  for (const key of ["lead_pk", "interest_status", "plan_pk"] as const) {
    const value = fields[key]
    if (value == null || value.trim() === "") {
      risks.push({
        code: "required_config_blank",
        severity: "high",
        detail: `${key} ausente ou vazio no form (config Controllr).`,
      })
    }
  }

  for (const key of [
    "interest_name",
    "interest_doc1",
    "interest_phone_number",
  ] as const) {
    const value = fields[key]
    if (value == null || value.trim() === "") {
      risks.push({
        code: "required_identity_blank",
        severity: "high",
        detail: `${key} ausente ou vazio.`,
      })
    }
  }

  const addressKeys = [
    "interest_addr_zipcode",
    "interest_addr_state",
    "interest_addr_city",
    "interest_addr_neighborhood",
    "interest_addr_address",
    "interest_addr_number",
  ]
  const omittedAddress = addressKeys.filter(
    (key) => fields[key] == null || fields[key] === ""
  )
  if (omittedAddress.length >= 3) {
    risks.push({
      code: "address_fields_omitted",
      severity: "medium",
      detail: `Campos de endereço vazios/omitidos: ${omittedAddress.join(", ")}. admin-http remove strings vazias do POST.`,
    })
  }

  if (fields.interest_email_addr == null || fields.interest_email_addr === "") {
    risks.push({
      code: "email_omitted",
      severity: "low",
      detail:
        "interest_email_addr vazio será omitido do body (regra value !== \"\").",
    })
  }

  const obs = fields.interest_obs
  if (obs && obs.length >= 240) {
    risks.push({
      code: "interest_obs_near_limit",
      severity: "low",
      detail: `interest_obs com ${obs.length} chars (limite típico 255).`,
    })
  }

  return risks
}

function stripPiiFromText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[doc]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[doc]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date]")
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "[date]")
    .replace(/\b\d{8,}\b/g, "[digits]")
    .replace(/BRBOSCookie=[^;\s]+/gi, "BRBOSCookie=[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
}

function extractMessageHint(payload: unknown, bodyText: string): string | null {
  const root = asRecord(payload)
  const candidates: string[] = []

  if (typeof root?.message === "string") candidates.push(root.message)
  if (typeof root?.msg === "string") candidates.push(root.msg)
  if (typeof root?.error === "string") candidates.push(root.error)
  if (typeof root?.detail === "string") candidates.push(root.detail)

  const errors = root?.errors
  if (Array.isArray(errors)) {
    for (const item of errors.slice(0, 5)) {
      if (typeof item === "string") candidates.push(item)
      const rec = asRecord(item)
      if (typeof rec?.message === "string") candidates.push(rec.message)
      if (typeof rec?.msg === "string") candidates.push(rec.msg)
    }
  } else if (errors && typeof errors === "object") {
    for (const [key, value] of Object.entries(errors).slice(0, 8)) {
      if (typeof value === "string") candidates.push(`${key}: ${value}`)
      else if (Array.isArray(value) && typeof value[0] === "string") {
        candidates.push(`${key}: ${value[0]}`)
      }
    }
  }

  const first = candidates.find((c) => c.trim().length > 0)
  if (first) {
    return stripPiiFromText(first.trim()).slice(0, 240)
  }

  const stripped = stripPiiFromText(bodyText).replace(/\s+/g, " ").trim()
  if (!stripped) return null
  return stripped.slice(0, 160)
}

function contentTypeHint(bodyText: string): SanitizedControllrHttpDiagnostics["responseContentTypeHint"] {
  const trimmed = bodyText.trim()
  if (!trimmed) return "empty"
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json"
  if (/^<!DOCTYPE|^<html/i.test(trimmed)) return "html"
  return "text"
}

export function buildSanitizedControllrHttpDiagnostics(input: {
  path: string
  status: number | null
  attempt?: number
  fields?: Record<string, string>
  bodyText?: string
  json?: unknown
}): SanitizedControllrHttpDiagnostics {
  const fields = input.fields ?? {}
  const bodyText = input.bodyText ?? ""
  const omitted = listOmittedEmptyFields(fields)
  const sentKeys = Object.entries(fields)
    .filter(([, value]) => value !== "")
    .map(([key]) => key)
    .sort()

  const root = asRecord(input.json)
  const responseKeys = root ? Object.keys(root).sort().slice(0, 30) : []

  return {
    path: input.path,
    status: input.status,
    errorClass: classifyControllrHttpStatus(input.status),
    attempt: input.attempt ?? 1,
    fieldKeysSent: sentKeys,
    fieldCount: sentKeys.length,
    omittedEmptyFieldCount: omitted.length,
    responseContentTypeHint: contentTypeHint(bodyText),
    responseMessageHint: extractMessageHint(input.json, bodyText),
    responseKeys,
    bodyByteLength: new TextEncoder().encode(bodyText).length,
    bodyShapeHint: bodyText
      ? stripPiiFromText(bodyText).replace(/\s+/g, " ").trim().slice(0, 120) ||
        null
      : null,
  }
}

/**
 * Mensagem amigável para auditoria quando o ERP devolve só HTTP 400 genérico.
 */
export function resolveControllrClientErrorMessage(
  diagnostics: SanitizedControllrHttpDiagnostics,
  fallback = "Falha na chamada Controllr."
): string {
  if (diagnostics.responseMessageHint) {
    return diagnostics.responseMessageHint
  }
  if (diagnostics.status === 400) {
    return `HTTP 400 Controllr em ${diagnostics.path} (corpo sem message legível; class=${diagnostics.errorClass}).`
  }
  if (diagnostics.status != null) {
    return `HTTP ${diagnostics.status} Controllr em ${diagnostics.path}.`
  }
  return fallback
}
