export function isIdempotentEscalation(code: string | null | undefined): boolean {
  return code === "escalated" || code === "already_escalated"
}
