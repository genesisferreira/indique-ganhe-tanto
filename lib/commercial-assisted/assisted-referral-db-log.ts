/**
 * Diagnóstico server-side sanitizado — cadastro assistido de referral.
 * Nunca logar CPF/CNPJ, telefone, e-mail, endereço, Pix, JWT ou tokens.
 */
export function logAssistedReferralDbError(input: {
  stage: string
  operation: string
  error: { code?: string; message?: string } | null | undefined
  idempotencyKeyPrefix?: string
}): void {
  const raw = (input.error?.message ?? "").slice(0, 180)
  const sanitized = raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{11}\b/g, "[redacted-doc]")
    .replace(/\b\d{14}\b/g, "[redacted-doc]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
  console.error("[assisted-referral]", {
    stage: input.stage,
    operation: input.operation,
    code: input.error?.code ?? null,
    message: sanitized || null,
    idempotencyKeyPrefix: input.idempotencyKeyPrefix ?? null,
  })
}
