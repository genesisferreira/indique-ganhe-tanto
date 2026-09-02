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
 * Chave aleatória Pix (padrão Bacen): UUID com hífens
 * (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
 */
export const INDICATOR_PIX_ALEATORIA_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** UUID válido para mocks e testes de chave aleatória. */
export const INDICATOR_PIX_ALEATORIA_TEST_UUID =
  "a1b2c3d4-e5f6-4789-a012-3456789abcde"

export const SIGNUP_INVALID_RANDOM_PIX_KEY_MESSAGE =
  "Informe uma chave Pix aleatória válida."

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

/** Mensagem amigável para o formulário de cadastro; null quando a chave é válida. */
export function getIndicatorSignupPixKeyErrorMessage(
  keyTypeRaw: string,
  keyValueRaw: string
): string | null {
  const validation = validateIndicatorPixKeyForSignup(keyTypeRaw, keyValueRaw)
  if (validation.ok) {
    return null
  }

  if (validation.reason === "invalid_pix_key_type") {
    return "Tipo de chave Pix inválido."
  }

  switch (keyTypeRaw.trim()) {
    case "cpf":
      return "Informe um CPF válido."
    case "cnpj":
      return "Informe um CNPJ válido."
    case "email":
      return "Informe um e-mail válido."
    case "telefone":
      return "Informe um telefone válido."
    case "aleatoria":
      return SIGNUP_INVALID_RANDOM_PIX_KEY_MESSAGE
    default:
      return "Informe uma chave Pix válida."
  }
}
