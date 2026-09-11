export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha."

export const PASSWORD_UPDATE_PATH = "/atualizar-senha"

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

export function buildPasswordRecoveryRedirectTo(origin: string): string {
  const base = origin.replace(/\/$/, "")
  return `${base}/auth/callback?next=${encodeURIComponent(PASSWORD_UPDATE_PATH)}`
}

export function passwordResetPublicMessage(): string {
  return PASSWORD_RESET_NEUTRAL_MESSAGE
}
