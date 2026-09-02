/**
 * Helpers de idempotência do cadastro assistido.
 * A key representa UMA submissão lógica (UUID v4) — não ownership/reward.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isAssistedIdempotencyKey(
  value: unknown
): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim())
}

export function normalizeAssistedIdempotencyKey(
  value: unknown
): string | null {
  if (!isAssistedIdempotencyKey(value)) return null
  return value.trim().toLowerCase()
}

/** Detecta violação de unique do Postgres (incl. partial unique index). */
export function isUniqueViolationError(error: {
  code?: string | null
  message?: string | null
} | null | undefined): boolean {
  if (!error) return false
  if (error.code === "23505") return true
  const msg = (error.message ?? "").toLowerCase()
  return (
    msg.includes("duplicate key") ||
    msg.includes("unique") ||
    msg.includes("assisted_idempotency_key")
  )
}
