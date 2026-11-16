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
  const status = (input.syncStatus ?? "").trim()
  if (status === "error" || status === "retryable_error") return true
  return (input.attempts ?? 0) > 0
}

export function controllrFailureStatus(
  httpStatus: number | null | undefined
): "error" | "retryable_error" {
  if (httpStatus === 400 || httpStatus === 422) return "error"
  return "retryable_error"
}

/** Tentativa técnica: imediata, 2 min, 5 min, 10 min. Depois disso, para. */
export function interestRetryDelayMs(attempts: number): number | null {
  if (attempts <= 0) return 0
  if (attempts === 1) return 2 * 60 * 1000
  if (attempts === 2) return 5 * 60 * 1000
  if (attempts === 3) return 10 * 60 * 1000
  return null
}

export function isAutomaticInterestCandidate(input: {
  source?: string | null
  status?: string | null
  interestId?: string | null
}): boolean {
  if (input.interestId?.trim()) return false
  const status = (input.status ?? "").trim()
  if (status !== "pending" && status !== "retryable_error") return false
  if (isReferralShareSource(input.source)) return true
  return (
    input.source === "public_pre_registration" ||
    input.source === "neutral_network_pre_registration"
  )
}

export function interestRetryDue(input: {
  attempts: number
  lastSyncAt?: string | null
  endpoint?: string | null
  nowMs: number
  leaseTtlMs: number
}): boolean {
  const delay = interestRetryDelayMs(input.attempts)
  if (delay === null) return false
  if (
    !controllrClaimIsOpen({
      interestId: null,
      endpoint: input.endpoint,
      lastSyncAt: input.lastSyncAt,
      nowMs: input.nowMs,
      ttlMs: input.leaseTtlMs,
    })
  ) {
    return false
  }
  if (input.attempts <= 0) return true
  const at = input.lastSyncAt ? Date.parse(input.lastSyncAt) : Number.NaN
  if (!Number.isFinite(at)) return true
  return input.nowMs - at >= delay
}
