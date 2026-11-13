import { employeeJson } from "@/lib/employee-portal/http"
import { createEmployeeSessionClient } from "@/lib/employee-portal/service"
import { runSubmitOpportunity } from "@/lib/employee-opportunities/handlers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 3.1F-J3: cadastro de oportunidade pelo funcionário (Técnico / Vendas Externas).
 * Somente POST; sessão → gate → validação → RPC atômica. Resposta no-store.
 */
export async function POST(request: Request) {
  const out = await runSubmitOpportunity(await createEmployeeSessionClient(), request)
  return employeeJson(out.body, out.status)
}
