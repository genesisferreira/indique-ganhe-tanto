import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthProfileBasicsFromSupabase, type AdminReadClient } from "@/lib/services/supabase-data.service"
import { parsePeriod } from "@/lib/period/range"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ATTENDANCE = ["pendente", "em_andamento", "em_atendimento", "em_negociacao"]
const APPROVED = ["aprovada", "paga"]
const KINDS = ["direct_preregistration", "direct_website", "direct_campaign", "direct_admin", "direct_other", "indicator", "partner_merchant", "employee_technician", "employee_external_sales", "unclassified_legacy"] as const

type CountQuery = {
  gte: (column: string, value: string) => CountQuery
  lt: (column: string, value: string) => CountQuery
  eq: (column: string, value: string) => CountQuery
  in: (column: string, values: string[]) => CountQuery
}

export async function GET(request: Request) {
  const supabase = (await createClient()) as unknown as AdminReadClient
  const basics = await getAuthProfileBasicsFromSupabase({ client: supabase, signal: request.signal })
  if (!basics) return NextResponse.json({ ok: false }, { status: 401 })
  if (!["admin_master", "admin_financeiro", "admin_consulta"].includes(basics.role)) {
    return NextResponse.json({ ok: false }, { status: 403 })
  }
  const period = parsePeriod(new URL(request.url).searchParams)
  const db = supabase as unknown as {
    from: (table: string) => { select: (columns: string, options: { count: "exact"; head: true }) => CountQuery }
  }
  async function count(apply: (query: CountQuery) => CountQuery): Promise<number> {
    let query = db.from("referrals").select("id", { count: "exact", head: true })
    if (period.from) query = query.gte("created_at", period.from.toISOString())
    if (period.to) query = query.lt("created_at", period.to.toISOString())
    const result = await (apply(query) as unknown as Promise<{ count: number | null; error: { message?: string } | null }>)
    return result.error ? 0 : result.count ?? 0
  }
  const groups = ["direct", "referral", "unclassified"]
  const byGroup: Record<string, number> = {}
  for (const group of groups) byGroup[group] = await count((query) => query.eq("origin_group", group))
  const byKind: Record<string, number> = {}
  for (const kind of KINDS) byKind[kind] = await count((query) => query.eq("acquisition_kind", kind))
  const directAttendance = await count((query) => query.eq("origin_group", "direct").in("status", ATTENDANCE))
  const directApproved = await count((query) => query.eq("origin_group", "direct").in("status", APPROVED))
  const directRejected = await count((query) => query.eq("origin_group", "direct").eq("status", "recusada"))
  const referralAttendance = await count((query) => query.eq("origin_group", "referral").in("status", ATTENDANCE))
  const referralApproved = await count((query) => query.eq("origin_group", "referral").in("status", APPROVED))
  const referralRejected = await count((query) => query.eq("origin_group", "referral").eq("status", "recusada"))
  const total = byGroup.direct + byGroup.referral + byGroup.unclassified
  const rate = (part: number, base: number) => base === 0 ? 0 : Math.round((part / base) * 1000) / 10
  return NextResponse.json({
    ok: true,
    label: period.label,
    total,
    direct: byGroup.direct,
    referral: byGroup.referral,
    unclassified: byGroup.unclassified,
    byKind,
    directAttendance,
    directApproved,
    directRejected,
    referralAttendance,
    referralApproved,
    referralRejected,
    directRate: rate(directApproved, byGroup.direct),
    referralRate: rate(referralApproved, byGroup.referral),
    totalRate: rate(directApproved + referralApproved, total),
    costLabel: "Sem dados de custo",
    rewardLabel: "Recompensa e comissão permanecem em registros separados.",
  }, { headers: { "Cache-Control": "no-store" } })
}
