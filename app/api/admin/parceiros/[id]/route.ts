import { partnerJson, sessionRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const out = await sessionRpc("admin_get_partner_merchant", { p_id: id })
  return partnerJson(out.body, out.status)
}

export async function PATCH(request: Request) {
  const payload = await request.json().catch(() => null)
  const out = await sessionRpc("admin_save_partner_merchant", { p_payload: payload })
  return partnerJson(out.body, out.status)
}
