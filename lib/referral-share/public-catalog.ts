import { isValidCnpjDigits, isValidCpfDigits, onlyDigits } from "../employee-opportunities/contract"

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
