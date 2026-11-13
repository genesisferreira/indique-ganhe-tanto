import { NextResponse } from "next/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { runCommissionRoute } from "@/lib/commission-activation/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const out = await runCommissionRoute("pay", request)
  return applyNoStoreHeaders(NextResponse.json(out.body, { status: out.status }))
}
