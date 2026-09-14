import {
  PASSWORD_UPDATE_PATH,
  RECOVERY_OTP_TYPE,
  sanitizePasswordRecoveryNextPath,
} from "@/lib/auth/password-reset"

const TOKEN_HASH_MIN_LEN = 16
const TOKEN_HASH_MAX_LEN = 2048
const TOKEN_HASH_CHARSET = /^[A-Za-z0-9._~-]+$/

export type ParsedRecoveryToken = {
  ok: true
  tokenHash: string
  type: typeof RECOVERY_OTP_TYPE
  next: typeof PASSWORD_UPDATE_PATH
}

export type ParsedRecoveryTokenFailure = {
  ok: false
}

export type ParsedRecoveryTokenResult =
  | ParsedRecoveryToken
  | ParsedRecoveryTokenFailure

export function isPlausibleRecoveryTokenHash(value: string): boolean {
  if (value.length < TOKEN_HASH_MIN_LEN || value.length > TOKEN_HASH_MAX_LEN) {
    return false
  }
  if (value.includes("/") || value.includes("\\") || value.includes("://")) {
    return false
  }
  return TOKEN_HASH_CHARSET.test(value)
}

export function parseRecoveryFragment(
  fragment: string | null | undefined
): ParsedRecoveryTokenResult {
  const raw = String(fragment ?? "")
  const trimmed = raw.startsWith("#") ? raw.slice(1) : raw
  if (!trimmed) return { ok: false }
  return parseRecoveryTokenParams(new URLSearchParams(trimmed))
}

export function parseRecoveryConfirmBody(
  body: unknown
): ParsedRecoveryTokenResult {
  if (body === null || typeof body !== "object") return { ok: false }
  const record = body as Record<string, unknown>
  const tokenHash =
    typeof record.token_hash === "string" ? record.token_hash : ""
  const type = typeof record.type === "string" ? record.type : ""
  const next = typeof record.next === "string" ? record.next : undefined
  return parseRecoveryTokenFields({ tokenHash, type, nextRaw: next })
}

function parseRecoveryTokenParams(
  params: URLSearchParams
): ParsedRecoveryTokenResult {
  return parseRecoveryTokenFields({
    tokenHash: params.get("token_hash") ?? "",
    type: params.get("type") ?? "",
    nextRaw: params.get("next"),
  })
}

function parseRecoveryTokenFields(input: {
  tokenHash: string
  type: string
  nextRaw: string | null | undefined
}): ParsedRecoveryTokenResult {
  const tokenHash = input.tokenHash.trim()
  const type = input.type.trim().toLowerCase()
  if (!isPlausibleRecoveryTokenHash(tokenHash)) return { ok: false }
  if (type !== RECOVERY_OTP_TYPE) return { ok: false }
  const next = sanitizePasswordRecoveryNextPath(input.nextRaw)
  if (next !== PASSWORD_UPDATE_PATH) return { ok: false }
  return {
    ok: true,
    tokenHash,
    type: RECOVERY_OTP_TYPE,
    next: PASSWORD_UPDATE_PATH,
  }
}
