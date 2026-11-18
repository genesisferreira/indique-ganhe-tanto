import { NextResponse } from "next/server"
import { parsePeriod } from "@/lib/period/range"
import { seriesGranularity, bucketKeys, fillBuckets, finiteNumber } from "@/lib/period/series"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RawPoint = { bucket?: string; indicacoes?: number; conversoes?: number; pago?: number; pendente?: number }

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 })
  const period = parsePeriod(new URL(request.url).searchParams)
  const grain = seriesGranularity(period.selection, period.from, period.to)
  const client = supabase as unknown as {
    rpc: (fn: string, args: Record<string, string | null>) => Promise<{ data: unknown; error: { message?: string } | null }>
  }
  const { data, error } = await client.rpc("admin_period_dashboard", {
    p_from: period.from?.toISOString() ?? null,
    p_to: period.to?.toISOString() ?? null,
    p_grain: grain,
  })
  if (error) return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 })
  const body = (data ?? { ok: false }) as {
    ok?: boolean
    code?: string
    referralSeries?: RawPoint[]
    paymentSeries?: RawPoint[]
  }
  if (body.ok !== true) {
    return NextResponse.json(body, { status: body.code === "forbidden" ? 403 : 400, headers: { "Cache-Control": "no-store" } })
  }
  const referralRaw = Array.isArray(body.referralSeries) ? body.referralSeries : []
  const paymentRaw = Array.isArray(body.paymentSeries) ? body.paymentSeries : []
  const keys = bucketKeys(grain, period.selection, period.from, period.to, [...referralRaw, ...paymentRaw].map((row) => String(row.bucket ?? "")))
  const referralSeries = fillBuckets(
    referralRaw.map((row) => ({ bucket: String(row.bucket ?? ""), indicacoes: finiteNumber(row.indicacoes), conversoes: finiteNumber(row.conversoes) })),
    keys,
    { indicacoes: 0, conversoes: 0 }
  )
  const paymentSeries = fillBuckets(
    paymentRaw.map((row) => ({ bucket: String(row.bucket ?? ""), pago: finiteNumber(row.pago), pendente: finiteNumber(row.pendente) })),
    keys,
    { pago: 0, pendente: 0 }
  )
  return NextResponse.json(
    { ...body, periodLabel: period.label, granularity: grain, referralSeries, paymentSeries },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}
