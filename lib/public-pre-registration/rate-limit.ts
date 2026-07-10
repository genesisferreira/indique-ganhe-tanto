import "server-only"

import {
  getPublicPreRegistrationRateLimitMax,
  getPublicPreRegistrationRateLimitWindowMinutes,
} from "@/lib/public-pre-registration/config"

type Bucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function checkPublicPreRegistrationRateLimit(ip: string): {
  allowed: boolean
  retryAfterSeconds?: number
} {
  const now = Date.now()
  pruneExpired(now)

  const max = getPublicPreRegistrationRateLimitMax()
  const windowMs =
    getPublicPreRegistrationRateLimitWindowMinutes() * 60 * 1000

  const key = ip.trim() || "unknown"
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    }
  }

  existing.count += 1
  buckets.set(key, existing)
  return { allowed: true }
}
