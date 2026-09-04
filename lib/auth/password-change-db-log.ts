/**
 * Diagnóstico server-side sanitizado — limpeza must_change_password.
 * Nunca logar senha, e-mail completo, CPF, Pix, telefone, JWT ou tokens.
 */
export function logFirstPasswordChangeDbError(input: {
  stage: string
  operation: string
  error: { code?: string; message?: string } | null | undefined
  userIdPrefix?: string
}): void {
  const raw = (input.error?.message ?? "").slice(0, 180)
  const sanitized = raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{11}\b/g, "[redacted-doc]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
  console.error("[first-password-change]", {
    stage: input.stage,
    operation: input.operation,
    code: input.error?.code ?? null,
    message: sanitized || null,
    userIdPrefix: input.userIdPrefix ?? null,
  })
}
