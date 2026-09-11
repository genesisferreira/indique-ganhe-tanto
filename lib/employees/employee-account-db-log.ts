/**
 * Diagnóstico sanitizado da criação de conta de funcionário.
 * Nunca logar senha, CPF, telefone, e-mail completo, JWT ou tokens.
 */
export function logEmployeeAccountDbError(input: {
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
  console.error("[employee-account]", {
    stage: input.stage,
    operation: input.operation,
    code: input.error?.code ?? null,
    message: sanitized || null,
    idempotencyKeyPrefix: input.idempotencyKeyPrefix ?? null,
  })
}
