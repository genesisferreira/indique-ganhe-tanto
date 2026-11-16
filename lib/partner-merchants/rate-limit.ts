import "server-only"
import { createHash } from "node:crypto"

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function partnerClientKey(ip: string): string {
  return createHash("sha256").update(ip.trim() || "unknown", "utf8").digest("hex")
}

export function checkPartnerPublicRateLimit(clientKey: string, max = 20, windowMs = 10 * 60 * 1000): { allowed: boolean } {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  const existing = buckets.get(clientKey)
  if (!existing || existing.resetAt <= now) {
    buckets.set(clientKey, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }
  if (existing.count >= max) return { allowed: false }
  existing.count += 1
  return { allowed: true }
}
