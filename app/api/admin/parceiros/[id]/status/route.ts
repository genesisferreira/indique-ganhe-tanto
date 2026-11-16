import { partnerJson, sessionRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null)
  const out = await sessionRpc("admin_set_partner_merchant_status", { p_payload: payload })
  return partnerJson(out.body, out.status)
}
