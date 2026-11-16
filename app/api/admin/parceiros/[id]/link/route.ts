import { partnerJson, sessionRpc } from "@/lib/partner-merchants/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null)
  const mode = payload && typeof payload === "object" && (payload as { mode?: string }).mode === "revoke"
    ? "admin_revoke_partner_link"
    : "admin_issue_partner_link"
  const out = await sessionRpc(mode, { p_payload: payload })
  return partnerJson(out.body, out.status)
}
