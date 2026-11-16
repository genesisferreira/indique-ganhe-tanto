import { NextRequest } from "next/server"
import { partnerClientKey, checkPartnerPublicRateLimit } from "@/lib/partner-merchants/rate-limit"
import { shareJson, sharePublicRpc } from "@/lib/referral-share/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

export async function POST(request: NextRequest) {
  const key = partnerClientKey(clientIp(request))
  if (!checkPartnerPublicRateLimit(key).allowed) {
    return shareJson({ ok: false, message: "Muitas tentativas. Aguarde alguns minutos." }, 429)
  }
  const body = await request.json().catch(() => null) as { token?: unknown } | null
  const token = typeof body?.token === "string" ? body.token : ""
  const out = await sharePublicRpc("referral_share_public_context", { p_token: token, p_client_key: key })
  return shareJson(out.body, out.status)
}
