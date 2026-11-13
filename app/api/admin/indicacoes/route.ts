import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { adminIndicacoesHttp } from "@/lib/admin-legacy/admin-list-api"
import type { AdminReadClient } from "@/lib/services/supabase-data.service"

/**
 * 3.1F-K1S — leitura de /admin/indicacoes no servidor com a sessão do próprio usuário (cookies).
 * Autorização: getUser (validado no Auth) + papel em ADMIN_PORTAL_READ_ROLES + RLS (inalterada). Sem service_role.
 * Somente GET/leitura. Evita o lock de auth do navegador disputado pelo app shell (K2).
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const supabase = (await createClient()) as unknown as AdminReadClient
  const result = await adminIndicacoesHttp(supabase, request.signal)
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } })
}
