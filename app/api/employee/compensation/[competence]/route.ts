import { parseCompetenceParam, rejectIdentityParams } from "@/lib/employee-portal/contracts"
import { employeeBadRequest, employeeError, employeeJson } from "@/lib/employee-portal/http"
import { loadEmployeeCompetence } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura: linhas visíveis de uma competência própria (YYYY-MM). */
export async function GET(request: Request, context: { params: Promise<{ competence: string }> }) {
  const params = new URL(request.url).searchParams
  if (rejectIdentityParams(params) || [...params.keys()].length > 0) return employeeBadRequest("Parâmetro não permitido.")
  const { competence } = await context.params
  const month = parseCompetenceParam(competence)
  if (!month) return employeeBadRequest("Competência inválida.")
  const r = await loadEmployeeCompetence(month)
  if (!r.ok) return employeeError(r.kind)
  return employeeJson({ ok: true, data: r.data })
}
