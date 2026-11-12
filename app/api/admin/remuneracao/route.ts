import { NextResponse } from "next/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { authorizeAdminRemuneracao } from "@/lib/admin-remuneracao/guard"
import { ADMIN_REMUNERACAO_SECTIONS } from "@/lib/admin-remuneracao/policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET somente leitura da ESTRUTURA de Remuneração de Funcionários.
 * Admin Master / Admin Financeiro. admin_consulta => 403. Sem dado financeiro,
 * sem consulta a tabelas financeiras, sem escrita.
 */
export async function GET() {
  const auth = await authorizeAdminRemuneracao()
  if (!auth.ok) {
    const message = auth.status === 401 ? "Sessão não encontrada. Faça login novamente." : "Acesso não permitido para este perfil."
    return applyNoStoreHeaders(NextResponse.json({ ok: false, message }, { status: auth.status }))
  }
  return applyNoStoreHeaders(
    NextResponse.json({
      ok: true,
      data: {
        phase: "read_only_structure",
        configurationAvailable: false,
        sections: ADMIN_REMUNERACAO_SECTIONS.map((s) => ({ key: s.key, title: s.title })),
      },
    })
  )
}
