import { CONTROLLR_INVOICE_DUE_DAYS, isValidControllrInvoiceDueDay, validateControllrBirthDate } from "@/lib/brbyte/normalize-controllr-text"
import { isValidCnpjDigits, isValidCpfDigits, onlyDigits } from "../employee-opportunities/contract"

export const REFERRAL_SHARE_DUE_DAYS = CONTROLLR_INVOICE_DUE_DAYS
export const REFERRAL_SHARE_DUE_DAY_LABEL = "Melhor dia para vencimento da fatura"

export const REFERRAL_SHARE_PLANS = [
  { code: "plan_400_fixed_line", label: "Plano 400 Mega com linha fixa" },
  { code: "corporate_broadband", label: "Banda Larga Corporativa" },
  { code: "business_internet", label: "Internet Empresarial" },
  { code: "mega_500", label: "500 Mega" },
  { code: "mega_1000", label: "1000 Mega" },
] as const

export type ReferralSharePlanCode = (typeof REFERRAL_SHARE_PLANS)[number]["code"]

const PLAN_CODES = new Set<string>(REFERRAL_SHARE_PLANS.map((plan) => plan.code))

export function isReferralSharePlanCode(value: string): value is ReferralSharePlanCode {
  return PLAN_CODES.has(value)
}

export function referralDocumentDigits(value: string): string | null {
  const digits = onlyDigits(value)
  if (digits.length === 11 && isValidCpfDigits(digits)) return digits
  if (digits.length === 14 && isValidCnpjDigits(digits)) return digits
  return null
}

export function maskReferralDocument(value: string): string {
  const digits = onlyDigits(value).slice(0, 14)
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2")
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2")
}

export function maskDocumentForDisplay(value: string): string {
  const digits = onlyDigits(value)
  if (digits.length === 11) return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`
  return "Documento informado"
}

export function maskBirthDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

export function birthDateInputToIso(value: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

export function referralShareBirthIssue(value: string): "ok" | "empty" | "invalid" | "future" {
  const trimmed = value.trim()
  if (!trimmed) return "empty"
  const iso = birthDateInputToIso(trimmed)
  if (!iso) return "invalid"
  const result = validateControllrBirthDate(iso)
  if (result.ok) return "ok"
  return result.reason === "future" ? "future" : "invalid"
}

export function isReferralShareDueDay(value: number) {
  return isValidControllrInvoiceDueDay(value)
}
