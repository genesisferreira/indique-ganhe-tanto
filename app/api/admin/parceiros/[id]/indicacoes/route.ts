import { partnerJson, sessionRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const out = await sessionRpc("admin_list_partner_referrals", { p_id: id })
  return partnerJson(out.body, out.status)
}
