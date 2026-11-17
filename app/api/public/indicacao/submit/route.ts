import { NextRequest } from "next/server"
import { partnerClientKey, checkPartnerPublicRateLimit } from "@/lib/partner-merchants/rate-limit"
import { dispatchReferralShareControllrInterest } from "@/lib/referral-share/controllr-dispatch"
import { shareJson, sharePublicRpc } from "@/lib/referral-share/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const ALLOWED = new Set([
  "idempotencyKey", "planCode", "name", "phone", "document", "zipcode", "street", "number",
  "complement", "neighborhood", "city", "observation", "consent", "confirmRecentDuplicate",
  "birthDate", "preferredInvoiceDueDay",
])

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
  const body = await request.json().catch(() => null) as { token?: unknown; payload?: unknown } | null
  const token = typeof body?.token === "string" ? body.token : ""
  const payload = body?.payload && typeof body.payload === "object" ? body.payload as Record<string, unknown> : null
  if (!payload) return shareJson({ ok: false, message: "Não foi possível enviar a indicação." }, 400)
  const closed: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(payload)) {
    if (!ALLOWED.has(field)) return shareJson({ ok: false, message: "Não foi possível enviar a indicação." }, 400)
    closed[field] = value
  }
  const out = await sharePublicRpc("submit_referral_share", { p_token: token, p_client_key: key, p_payload: closed })
  if (out.status === 200 && typeof closed.idempotencyKey === "string") {
    await dispatchReferralShareControllrInterest(closed.idempotencyKey)
  }
  return shareJson(out.body, out.status)
}
