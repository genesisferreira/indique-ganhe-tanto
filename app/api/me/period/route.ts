import { NextResponse } from "next/server"
import { parsePeriod } from "@/lib/period/range"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 })
  const period = parsePeriod(new URL(request.url).searchParams)
  const client = supabase as unknown as {
    rpc: (fn: string, args: Record<string, string | null>) => Promise<{ data: unknown; error: { message?: string } | null }>
  }
  const { data, error } = await client.rpc("self_period_referral_stats", {
    p_from: period.from?.toISOString() ?? null,
    p_to: period.to?.toISOString() ?? null,
  })
  if (error) return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 })
  const body = (data ?? { ok: false }) as { ok?: boolean; code?: string }
  return NextResponse.json(
    { ...body, periodLabel: period.label },
    { status: body.ok === true ? 200 : body.code === "forbidden" ? 403 : 400, headers: { "Cache-Control": "no-store" } }
  )
}
