import { NextResponse } from "next/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { runAdminCompensationRoute } from "@/lib/compensation-config/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 3.1F-J4: Cria rascunho ou nova versão de regra de comissão (sempre inativa).
 * Somente POST; Admin Master / Admin Financeiro (guard + RPC). admin_consulta => 403. Resposta no-store.
 */
export async function POST(request: Request) {
  const out = await runAdminCompensationRoute("rule_save", request)
  return applyNoStoreHeaders(NextResponse.json(out.body, { status: out.status }))
}
