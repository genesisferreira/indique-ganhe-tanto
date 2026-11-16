import { NextRequest } from "next/server"
import { partnerClientKey, checkPartnerPublicRateLimit } from "@/lib/partner-merchants/rate-limit"
import { PUBLIC_PAYLOAD_KEYS, rejectForbiddenPublicKeys } from "@/lib/partner-merchants/domain"
import { partnerJson, publicRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const GENERIC = { ok: false, message: "Não foi possível usar este link." }

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

export async function POST(request: NextRequest) {
  const key = partnerClientKey(clientIp(request))
  if (!checkPartnerPublicRateLimit(key).allowed) {
    return partnerJson({ ok: false, message: "Muitas tentativas. Aguarde alguns minutos." }, 429)
  }
  const body = await request.json().catch(() => null) as { token?: unknown; payload?: unknown } | null
  const token = typeof body?.token === "string" ? body.token : ""
  const payload = body?.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return partnerJson(GENERIC, 404)
  }
  if (rejectForbiddenPublicKeys(payload as Record<string, unknown>)) {
    return partnerJson(GENERIC, 404)
  }
  const closed: Record<string, unknown> = {}
  for (const field of PUBLIC_PAYLOAD_KEYS) {
    if (field in (payload as Record<string, unknown>)) closed[field] = (payload as Record<string, unknown>)[field]
  }
  const out = await publicRpc("submit_partner_merchant_referral", { p_token: token, p_client_key: key, p_payload: closed })
  return partnerJson(out.body, out.status)
}
