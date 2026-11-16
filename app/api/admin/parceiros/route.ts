import { partnerJson, sessionRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const out = await sessionRpc("admin_list_partner_merchants", {})
  return partnerJson(out.body, out.status)
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null)
  const out = await sessionRpc("admin_save_partner_merchant", { p_payload: payload })
  return partnerJson(out.body, out.status)
}
