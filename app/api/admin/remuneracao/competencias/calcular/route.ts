import { NextResponse } from "next/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { runPayrollRoute } from "@/lib/payroll-competence/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const out = await runPayrollRoute("calculate", request)
  return applyNoStoreHeaders(NextResponse.json(out.body, { status: out.status }))
}
