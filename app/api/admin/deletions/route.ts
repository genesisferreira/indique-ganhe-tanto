import { NextResponse } from "next/server"
import { isDeletionAuthorizedRole } from "@/lib/admin-deletion/contract"
import { runDeletion } from "@/lib/admin-deletion/handlers"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS = new Set([
  "preview_referral",
  "delete_referral",
  "deactivate_referral",
  "preview_bulk",
  "delete_bulk",
  "preview_indicator",
  "commit_indicator",
])

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get("action") ?? ""
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, code: "unknown_action" }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) {
    return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 })
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
  const role = (profile as { role?: string } | null)?.role
  if (!isDeletionAuthorizedRole(role)) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 })
  }
  const raw = await request.text()
  const result = await runDeletion(action, { ok: true }, supabase as unknown as Parameters<typeof runDeletion>[2], {
    url: request.url,
    headers: request.headers,
    text: async () => raw,
  })
  let submitted: { indicatorId?: unknown } = {}
  try {
    submitted = JSON.parse(raw) as { indicatorId?: unknown }
  } catch {
    submitted = {}
  }
  const indicatorId = typeof submitted.indicatorId === "string" ? submitted.indicatorId : ""
  const authAction = result.body.authAction
  if (result.status === 200 && (authAction === "ban" || authAction === "delete") && indicatorId) {
    try {
      const admin = createServiceRoleClient()
      const follow = authAction === "delete"
        ? await admin.auth.admin.deleteUser(indicatorId)
        : await admin.auth.admin.updateUserById(indicatorId, { ban_duration: "876000h" })
      if (follow.error) {
        console.warn("[admin-deletion]", "auth_followup_failed")
        result.body.authFollowup = "failed"
      } else {
        result.body.authFollowup = "done"
      }
    } catch {
      console.warn("[admin-deletion]", "auth_followup_unavailable")
      result.body.authFollowup = "unavailable"
    }
  }
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } })
}
