import {
  COMMERCIAL_INDICATOR_SEARCH_MIN_QUERY_LENGTH,
} from "./constants"

export type IndicatorSearchQueryType =
  | "name"
  | "phone"
  | "email"
  | "cpf"
  | "mixed"

export type NormalizedIndicatorSearchQuery = {
  raw: string
  trimmed: string
  digits: string
  emailCandidate: string | null
  queryType: IndicatorSearchQueryType
  ok: true
} | {
  ok: false
  reason: "empty" | "too_short"
}

/** Escapa % e _ para uso seguro em ILIKE parametrizado. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

export function normalizeIndicatorSearchQuery(
  raw: string | null | undefined
): NormalizedIndicatorSearchQuery {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) {
    return { ok: false, reason: "empty" }
  }

  const digits = trimmed.replace(/\D/g, "")
  const lower = trimmed.toLowerCase()
  const looksEmail = lower.includes("@")
  const emailCandidate = looksEmail ? lower : null

  // Digits-only: allow shorter numeric queries once we have enough digits (CPF/phone).
  if (/^\d[\d\s().+-]*$/.test(trimmed) && digits.length > 0) {
    if (digits.length < COMMERCIAL_INDICATOR_SEARCH_MIN_QUERY_LENGTH) {
      return { ok: false, reason: "too_short" }
    }
    const queryType: IndicatorSearchQueryType =
      digits.length === 11 ? "cpf" : digits.length >= 10 ? "phone" : "mixed"
    return {
      ok: true,
      raw: raw ?? "",
      trimmed,
      digits,
      emailCandidate: null,
      queryType,
    }
  }

  if (trimmed.length < COMMERCIAL_INDICATOR_SEARCH_MIN_QUERY_LENGTH) {
    return { ok: false, reason: "too_short" }
  }

  let queryType: IndicatorSearchQueryType = "name"
  if (looksEmail) queryType = "email"
  else if (digits.length >= 10) queryType = "mixed"

  return {
    ok: true,
    raw: raw ?? "",
    trimmed,
    digits,
    emailCandidate,
    queryType,
  }
}
