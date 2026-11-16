import { shareJson, shareSessionRpc } from "@/lib/referral-share/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const out = await shareSessionRpc("admin_list_referral_share_links", {
    p_payload: { originKind: url.searchParams.get("originKind"), originatorId: url.searchParams.get("originatorId") },
  })
  return shareJson(out.body, out.status)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return shareJson({ ok: false, message: "Não foi possível concluir." }, 400)
  const action = body.action === "revoke" ? "revoke" : "issue"
  const fn = action === "revoke" ? "revoke_referral_share_link" : "issue_referral_share_link"
  const payload = { ...body }
  delete payload.action
  const out = await shareSessionRpc(fn, { p_payload: payload })
  return shareJson(out.body, out.status)
}
