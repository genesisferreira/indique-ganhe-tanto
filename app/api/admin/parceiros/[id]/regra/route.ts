import { partnerJson, sessionRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null)
  const preview = payload && typeof payload === "object" && (payload as { preview?: boolean }).preview === true
  const fn = preview ? "admin_preview_partner_fixed_activation" : "admin_save_partner_compensation_rule"
  const body = preview
    ? { partnerId: (payload as { partnerId?: string }).partnerId, opportunityId: (payload as { opportunityId?: string }).opportunityId }
    : payload
  const out = await sessionRpc(fn, { p_payload: body })
  return partnerJson(out.body, out.status)
}
