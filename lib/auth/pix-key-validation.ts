import {
  isValidCNPJ,
  isValidCPF,
  isValidPhoneBR,
  onlyDigits,
} from "@/lib/client/formatters"
import type { TipoChavePix } from "@/types/profile"
import { INDICATOR_PIX_KEY_TYPES, isIndicatorPixKeyType } from "./indicator-signup"

/** Mesma regex usada em pre-cadastro (`lib/public-pre-registration/validate.ts`). */
export const INDICATOR_PIX_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Chave aleatória Pix (padrão Bacen): UUID v4 com hífens.
 * O cadastro/chave-pix atuais não validam este tipo no frontend.
 */
export const INDICATOR_PIX_ALEATORIA_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeIndicatorPixKeyValue(
  keyType: TipoChavePix,
  rawValue: string
): string | null {
  const trimmed = rawValue.trim()
  if (!trimmed) return null

  switch (keyType) {
    case "cpf":
    case "cnpj":
      return onlyDigits(trimmed)
    case "email":
      return trimmed.toLowerCase()
    case "telefone": {
      let digits = onlyDigits(trimmed)
      if (digits.startsWith("55") && digits.length >= 12) {
        digits = digits.slice(2)
      }
      if (digits.length > 11) {
        digits = digits.slice(-11)
      }
      return digits
    }
    case "aleatoria":
      return trimmed.toLowerCase()
    default:
      return null
  }
}

export function isValidIndicatorPixKeyValue(
  keyType: TipoChavePix,
  rawValue: string
): boolean {
  const normalized = normalizeIndicatorPixKeyValue(keyType, rawValue)
  if (!normalized) return false

  switch (keyType) {
    case "cpf":
      return isValidCPF(normalized)
    case "cnpj":
      return isValidCNPJ(normalized)
    case "email":
      return INDICATOR_PIX_EMAIL_RE.test(normalized)
    case "telefone":
      return isValidPhoneBR(normalized)
    case "aleatoria":
      return INDICATOR_PIX_ALEATORIA_UUID_RE.test(normalized)
    default:
      return false
  }
}

export function validateIndicatorPixKeyForSignup(
  keyTypeRaw: string,
  keyValueRaw: string
): { ok: true; keyType: TipoChavePix; normalizedValue: string } | { ok: false; reason: "invalid_pix_key_type" | "invalid_pix_key_value" } {
  if (!isIndicatorPixKeyType(keyTypeRaw.trim())) {
    return { ok: false, reason: "invalid_pix_key_type" }
  }

  const keyType = keyTypeRaw.trim() as TipoChavePix
  if (!isValidIndicatorPixKeyValue(keyType, keyValueRaw)) {
    return { ok: false, reason: "invalid_pix_key_value" }
  }

  const normalizedValue = normalizeIndicatorPixKeyValue(keyType, keyValueRaw)
  if (!normalizedValue) {
    return { ok: false, reason: "invalid_pix_key_value" }
  }

  return { ok: true, keyType, normalizedValue }
}

export function listIndicatorPixKeyTypes(): readonly TipoChavePix[] {
  return INDICATOR_PIX_KEY_TYPES
}
