import "server-only"

function parseTruthy(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function isPublicPreRegistrationEnabled(): boolean {
  return parseTruthy(process.env.PUBLIC_PRE_REGISTRATION_ENABLED)
}

export function isPublicPreRegistrationTurnstileEnabled(): boolean {
  return parseTruthy(process.env.PUBLIC_PRE_REGISTRATION_TURNSTILE_ENABLED)
}

export function getPublicPreRegistrationRateLimitMax(): number {
  return parsePositiveInt(process.env.PUBLIC_PRE_REGISTRATION_RATE_LIMIT_MAX, 5)
}

export function getPublicPreRegistrationRateLimitWindowMinutes(): number {
  return parsePositiveInt(
    process.env.PUBLIC_PRE_REGISTRATION_RATE_LIMIT_WINDOW_MINUTES,
    15
  )
}

export function getPublicPreRegistrationDedupMinutes(): number {
  return parsePositiveInt(
    process.env.PUBLIC_PRE_REGISTRATION_DEDUP_MINUTES,
    15
  )
}

export const PUBLIC_PRE_REGISTRATION_ALLOWED_PLAN_NAMES = [
  "500 mega",
  "1 giga",
] as const

export const PUBLIC_PRE_REGISTRATION_UTM_MAX_LENGTH = 120

export const PUBLIC_PRE_REGISTRATION_DEFAULT_SOURCE_PAGE = "/pre-cadastro"

export function getPublicPreRegistrationPlan500Id(): string | null {
  const value = process.env.PUBLIC_PRE_REGISTRATION_PLAN_500_ID?.trim()
  return value || null
}

export function getPublicPreRegistrationPlan1000Id(): string | null {
  const value = process.env.PUBLIC_PRE_REGISTRATION_PLAN_1000_ID?.trim()
  return value || null
}
