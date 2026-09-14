import {
  isValidCPF,
  isValidPhoneBR,
} from "@/lib/client/formatters"
import {
  INDICATOR_PIX_EMAIL_RE,
  getIndicatorSignupPixKeyErrorMessage,
} from "@/lib/auth/pix-key-validation"
import { INDICATOR_PIX_KEY_TYPES } from "@/lib/auth/indicator-signup"
import type { TipoChavePix } from "@/types/profile"

import { buildTemporaryAccessClipboardText, CRM_LOGIN_URL } from "@/lib/auth/temporary-access-delivery"

export const ASSISTED_INDICATOR_PIX_TYPE_OPTIONS: Array<{
  value: TipoChavePix
  label: string
}> = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "aleatoria", label: "Chave aleatória" },
]

export type AssistedCreateIndicatorFormValues = {
  fullName: string
  cpf: string
  phone: string
  email: string
  pixKeyType: string
  pixKeyValue: string
}

export type AssistedCreateIndicatorFieldErrors = Partial<
  Record<keyof AssistedCreateIndicatorFormValues, string>
>

export function validateAssistedCreateIndicatorForm(
  values: AssistedCreateIndicatorFormValues
): { ok: true } | { ok: false; errors: AssistedCreateIndicatorFieldErrors } {
  const errors: AssistedCreateIndicatorFieldErrors = {}

  if (values.fullName.trim().length < 3) {
    errors.fullName = "Informe o nome completo."
  }
  if (!isValidCPF(values.cpf)) {
    errors.cpf = "Informe um CPF válido."
  }
  if (!isValidPhoneBR(values.phone)) {
    errors.phone = "Informe um telefone válido com DDD."
  }
  const email = values.email.trim().toLowerCase()
  if (!email || !INDICATOR_PIX_EMAIL_RE.test(email)) {
    errors.email = "Informe um e-mail válido."
  }
  if (
    !(INDICATOR_PIX_KEY_TYPES as readonly string[]).includes(
      values.pixKeyType.trim()
    )
  ) {
    errors.pixKeyType = "Selecione o tipo de chave Pix."
  } else {
    const pixErr = getIndicatorSignupPixKeyErrorMessage(
      values.pixKeyType,
      values.pixKeyValue
    )
    if (pixErr) errors.pixKeyValue = pixErr
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }
  return { ok: true }
}

export function mapAssistedIndicatorCreateApiError(
  status: number,
  message: string | undefined
): {
  kind: "email" | "cpf" | "pix" | "generic"
  message: string
} {
  const msg = (message ?? "").toLowerCase()
  if (status === 409) {
    if (msg.includes("e-mail") || msg.includes("email")) {
      return {
        kind: "email",
        message:
          "Já existe um indicador cadastrado com este e-mail. Procure pelo indicador existente.",
      }
    }
    if (msg.includes("cpf")) {
      return {
        kind: "cpf",
        message:
          "Já existe um cadastro para este CPF. Procure pelo indicador existente.",
      }
    }
    if (msg.includes("pix")) {
      return {
        kind: "pix",
        message: "Esta chave Pix já está vinculada a outro cadastro.",
      }
    }
  }
  return {
    kind: "generic",
    message: message?.trim() || "Não foi possível criar o indicador.",
  }
}

export const ASSISTED_INDICATOR_LOGIN_URL = CRM_LOGIN_URL

export function buildAssistedIndicatorAccessClipboardText(input: {
  email: string
  temporaryPassword: string
  loginUrl?: string
}): string {
  return buildTemporaryAccessClipboardText(input)
}

export function clipboardTextContainsSecretsOnly(input: {
  text: string
  email: string
  temporaryPassword: string
  cpf?: string
  pix?: string
}): boolean {
  const text = input.text
  if (!text.includes(input.email)) return false
  if (!text.includes(input.temporaryPassword)) return false
  if (!text.includes(ASSISTED_INDICATOR_LOGIN_URL)) return false
  const cpfDigits = (input.cpf ?? "").replace(/\D/g, "")
  if (cpfDigits.length >= 11 && text.includes(cpfDigits)) return false
  if (input.pix && input.pix.length >= 4 && text.includes(input.pix)) return false
  return true
}

export function canContinueAfterAssistedIndicatorCreate(input: {
  accessDeliveredConfirmed: boolean
  replayed: boolean
  hasTemporaryPassword: boolean
}): boolean {
  if (input.replayed && !input.hasTemporaryPassword) return true
  return input.accessDeliveredConfirmed
}

export function shouldWarnBeforeLeavingAssistedIndicatorSuccess(input: {
  created: boolean
  accessDeliveredConfirmed: boolean
  temporaryPassword: string | null
}): boolean {
  return (
    input.created &&
    Boolean(input.temporaryPassword) &&
    !input.accessDeliveredConfirmed
  )
}

export type AssistedIndicatorCreateSuccessView = {
  id: string
  fullName: string
  email: string
  phoneMasked: string | null
  documentMasked: string | null
  temporaryPassword: string | null
  replayed: boolean
  passwordAlreadyIssued: boolean
}

import { maskEmailForDisplay } from "./mask"

export function toSearchResultFromCreatedIndicator(input: {
  id: string
  fullName: string
  email: string
  phoneMasked: string | null
  documentMasked: string | null
}): {
  id: string
  full_name: string
  phone_masked: string | null
  email_masked: string | null
  document_masked: string | null
  is_active: boolean
} {
  return {
    id: input.id,
    full_name: input.fullName,
    phone_masked: input.phoneMasked,
    email_masked: maskEmailForDisplay(input.email),
    document_masked: input.documentMasked,
    is_active: true,
  }
}
