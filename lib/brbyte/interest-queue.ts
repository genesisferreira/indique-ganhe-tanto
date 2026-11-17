import { interestRetryDelayMs } from "@/lib/referral-share/controllr-origin"

export const INTEREST_OPERATION_TYPE = "create_interest" as const
export const INTEREST_ATTEMPT_LIMIT = 4

const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/

const AUTOMATIC_ORIGINS = new Set([
  "referral_share_link",
  "employee_sales_opportunity",
  "partner_merchant_referral",
  "public_pre_registration",
  "neutral_network_pre_registration",
])

export type InterestOperationView = {
  operationType?: string | null
  status?: string | null
  idempotencyKey?: string | null
  origin?: string | null
  flow?: string | null
  attempts?: number | null
}

export function isValidInterestIdempotencyKey(value: string | null | undefined): boolean {
  return KEY_RE.test((value ?? "").trim())
}

export function isAuthorizedAutomaticOrigin(origin: string | null | undefined): boolean {
  return AUTOMATIC_ORIGINS.has((origin ?? "").trim())
}

export function automaticInterestKeyForPreRegistration(referralId: string): string {
  return `pre_${referralId.replace(/-/g, "").trim()}`
}

/** A fila automática não olha status da indicação nem ausência de interessado. */
export function isExplicitInterestOperation(input: InterestOperationView): boolean {
  if ((input.operationType ?? "").trim() !== INTEREST_OPERATION_TYPE) return false
  const status = (input.status ?? "").trim()
  if (status !== "pending" && status !== "retryable") return false
  if (!isValidInterestIdempotencyKey(input.idempotencyKey)) return false
  const attempts = input.attempts ?? 0
  if (interestRetryDelayMs(attempts) === null || attempts >= INTEREST_ATTEMPT_LIMIT) return false
  const flow = (input.flow ?? "").trim()
  if (flow === "admin_explicit") return true
  if (flow !== "automatic_current") return false
  return isAuthorizedAutomaticOrigin(input.origin)
}

export function settleInterestOperation(input: {
  ok: boolean
  skipped?: boolean
  hasInterestId: boolean
  attempts: number
  referralStatus?: string | null
}): "succeeded" | "pending" | "retryable" | "permanent_error_not_retryable" {
  if (input.ok && input.hasInterestId) return "succeeded"
  if ((input.referralStatus ?? "").trim() === "error") return "permanent_error_not_retryable"
  if (input.skipped) return "pending"
  const nextAttempts = input.attempts + 1
  if (interestRetryDelayMs(nextAttempts) === null || nextAttempts >= INTEREST_ATTEMPT_LIMIT) {
    return "permanent_error_not_retryable"
  }
  return "retryable"
}

export const CRON_PHASES = [
  "interest",
  "conversion",
  "contract",
  "invoice",
  "reward",
  "fixed_commission",
  "audit",
] as const

export function phasesAfterFailure(failedPhase: (typeof CRON_PHASES)[number]): string[] {
  const index = CRON_PHASES.indexOf(failedPhase)
  return CRON_PHASES.slice(index + 1)
}
