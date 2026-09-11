import { NextResponse } from "next/server"
import { authorizeRetentionCustomerRequest } from "@/lib/collections/actor"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import { searchRetentionCustomer } from "@/lib/retention/search"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await authorizeRetentionCustomerRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const body = stripBrowserActor(await request.json().catch(() => null))
  const result = await searchRetentionCustomer({
    rawDocument: String(body.document ?? body.cpf ?? body.cnpj ?? ""),
  })
  if (!result.ok) return jsonError(result.status, result.message)
  return NextResponse.json({ ok: true, ...result.result })
}
