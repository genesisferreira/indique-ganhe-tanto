export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  "Se existir uma conta com esse e-mail, enviaremos as instruções de recuperação."

export const PASSWORD_UPDATE_PATH = "/atualizar-senha"

export const RECOVERY_ERROR_QUERY = "recovery_error"
export const RECOVERY_ERROR_INVALID_OR_EXPIRED = "invalid_or_expired"

export const RECOVERY_INVALID_LINK_TITLE = "Link inválido ou expirado"
export const RECOVERY_INVALID_LINK_BODY =
  "Este link de recuperação não é mais válido. Solicite um novo link para definir sua senha."

export function sanitizePasswordRecoveryNextPath(
  raw: string | null | undefined
): string {
  const value = String(raw ?? "").trim()
  if (value === PASSWORD_UPDATE_PATH) return PASSWORD_UPDATE_PATH
  return PASSWORD_UPDATE_PATH
}

export function isSafeSameOriginPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\") &&
    !path.includes("://")
  )
}

export const RECOVERY_CONFIRMATION_PATH = "/auth/recuperar-confirmacao"
export const RECOVERY_VERIFY_PATH = "/auth/confirm"
export const RECOVERY_OTP_TYPE = "recovery"

export function buildPasswordRecoveryRedirectTo(origin: string): string {
  const base = origin.replace(/\/$/, "")
  return `${base}${RECOVERY_CONFIRMATION_PATH}`
}

export function buildPasswordRecoveryFailurePath(): string {
  return `${PASSWORD_UPDATE_PATH}?${RECOVERY_ERROR_QUERY}=${RECOVERY_ERROR_INVALID_OR_EXPIRED}`
}

export function passwordResetPublicMessage(): string {
  return PASSWORD_RESET_NEUTRAL_MESSAGE
}

export function normalizeRecoveryEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parseAuthCallbackParams(hashOrQuery: string): {
  error: string | null
  errorCode: string | null
} {
  const raw = hashOrQuery.startsWith("#") ? hashOrQuery.slice(1) : hashOrQuery
  const trimmed = raw.startsWith("?") ? raw.slice(1) : raw
  const params = new URLSearchParams(trimmed)
  const error = params.get("error")
  const errorCode = params.get("error_code")
  return {
    error: error && error.length > 0 ? error : null,
    errorCode: errorCode && errorCode.length > 0 ? errorCode : null,
  }
}

export type RecoveryUrlBlockReason =
  | "otp_expired"
  | "access_denied"
  | "invalid_or_expired"

export function detectRecoveryUrlError(input: {
  search: string
  hash: string
}): RecoveryUrlBlockReason | null {
  const query = new URLSearchParams(
    input.search.startsWith("?") ? input.search.slice(1) : input.search
  )
  if (query.get(RECOVERY_ERROR_QUERY) === RECOVERY_ERROR_INVALID_OR_EXPIRED) {
    return "invalid_or_expired"
  }

  const hash = parseAuthCallbackParams(input.hash)
  const searchAuth = parseAuthCallbackParams(input.search)
  const errorCode = (hash.errorCode ?? searchAuth.errorCode ?? "").toLowerCase()
  const error = (hash.error ?? searchAuth.error ?? "").toLowerCase()

  if (errorCode === "otp_expired") return "otp_expired"
  if (error === "access_denied" || errorCode === "access_denied") {
    return "access_denied"
  }
  if (error || errorCode) return "invalid_or_expired"
  return null
}

export type PasswordUpdateGate =
  | { showForm: false; reason: RecoveryUrlBlockReason | "no_session" }
  | { showForm: true }

/**
 * Formulário só com sessão Auth. Não há claim pública de "tipo recovery"
 * após o PKCE no servidor; exigimos getUser() e bloqueamos erros de URL.
 */
export function gatePasswordUpdateForm(input: {
  urlError: RecoveryUrlBlockReason | null
  hasAuthenticatedUser: boolean
}): PasswordUpdateGate {
  if (input.urlError) {
    return { showForm: false, reason: input.urlError }
  }
  if (!input.hasAuthenticatedUser) {
    return { showForm: false, reason: "no_session" }
  }
  return { showForm: true }
}

export function passwordsMatchForUpdate(password: string, confirm: string): {
  ok: true
} | { ok: false; message: string } {
  if (password.length < 8) {
    return { ok: false, message: "A senha deve ter pelo menos 8 caracteres." }
  }
  if (password !== confirm) {
    return { ok: false, message: "As senhas não coincidem." }
  }
  return { ok: true }
}
