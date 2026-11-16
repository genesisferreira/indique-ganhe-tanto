import { partnerJson, sessionRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await request.json().catch(() => null)
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return partnerJson({ ok: false, message: "Não foi possível reconciliar." }, 400)
  }
  const body = { ...(payload as Record<string, unknown>), partnerId: id }
  const out = await sessionRpc("admin_reconcile_partner_commissions", { p_payload: body })
  return partnerJson(out.body, out.status)
}
