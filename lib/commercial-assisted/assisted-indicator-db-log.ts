/**
 * Diagnóstico server-side sanitizado para falhas de DB no fluxo Conta Assistida.
 * Nunca logar senha, CPF, Pix, telefone, e-mail completo, JWT ou tokens.
 */
export function logAssistedIndicatorDbError(input: {
  stage: string
  operation: string
  error: { code?: string; message?: string } | null | undefined
  idempotencyKeyPrefix?: string
}): void {
  const raw = (input.error?.message ?? "").slice(0, 180)
  const sanitized = raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{11}\b/g, "[redacted-doc]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
  console.error("[assisted-indicator]", {
    stage: input.stage,
    operation: input.operation,
    code: input.error?.code ?? null,
    message: sanitized || null,
    idempotencyKeyPrefix: input.idempotencyKeyPrefix ?? null,
  })
}
