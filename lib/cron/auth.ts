import { timingSafeEqual } from "crypto"

/**
 * Valida Authorization: Bearer {CRON_SECRET} (Vercel Cron + chamadas manuais).
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false

  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return false

  const token = authHeader.slice("Bearer ".length).trim()
  if (!token) return false

  try {
    const a = Buffer.from(token, "utf8")
    const b = Buffer.from(secret, "utf8")
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function isCronSecretConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET?.trim())
}
