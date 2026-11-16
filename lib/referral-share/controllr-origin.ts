export const CONTROLLR_CLAIM_ENDPOINT = "create_interest:in_progress"
export const REFERRAL_SHARE_FORM_NOTE = "Veio pelo formulário de indicação"

const SHARE_SOURCES = new Set([
  "referral_share_link",
  "employee_sales_opportunity",
  "partner_merchant_referral",
])

export function isReferralShareSource(source: string | null | undefined): boolean {
  return SHARE_SOURCES.has((source ?? "").trim())
}

export function referralShareControllrOrigin(input: {
  originKind?: string | null
  attributionRole?: string | null
}): "INDICADOR" | "TÉCNICO" | "VENDEDOR EXTERNO" | "COMÉRCIO PARCEIRO" | null {
  const role = input.attributionRole?.trim() ?? ""
  const kind = input.originKind?.trim() ?? ""
  if (role === "technician_originator") return "TÉCNICO"
  if (role === "external_sales_originator") return "VENDEDOR EXTERNO"
  if (role === "partner_merchant_originator" || kind === "partner_merchant") {
    return "COMÉRCIO PARCEIRO"
  }
  if (role === "indicator" || kind === "indicator") return "INDICADOR"
  return null
}

export function controllrOfferLabel(
  publicOfferName: string | null | undefined,
  technicalPlanName: string | null | undefined
): string {
  return publicOfferName?.trim() || technicalPlanName?.trim() || "Não informado"
}

export function controllrClaimIsOpen(input: {
  interestId?: string | null
  endpoint?: string | null
  lastSyncAt?: string | null
  nowMs: number
  ttlMs: number
}): boolean {
  if (input.interestId?.trim()) return false
  if ((input.endpoint ?? "").trim() !== CONTROLLR_CLAIM_ENDPOINT) return true
  const at = input.lastSyncAt ? Date.parse(input.lastSyncAt) : Number.NaN
  if (!Number.isFinite(at)) return true
  return input.nowMs - at >= input.ttlMs
}

export type ControllrRetryDecision = "create" | "link_existing" | "stop_unknown"

export function decideControllrRetry(input: {
  lookupReached: boolean
  existingInterestPk?: string | null
}): ControllrRetryDecision {
  if (input.existingInterestPk?.trim()) return "link_existing"
  if (input.lookupReached) return "create"
  return "stop_unknown"
}

export function needsControllrLookupBeforeCreate(input: {
  interestId?: string | null
  syncStatus?: string | null
  attempts?: number | null
}): boolean {
  if (input.interestId?.trim()) return false
  if ((input.syncStatus ?? "").trim() === "error") return true
  return (input.attempts ?? 0) > 0
}
