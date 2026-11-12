import { parseOpportunityId, rejectIdentityParams } from "@/lib/employee-portal/contracts"
import { employeeBadRequest, employeeError, employeeJson } from "@/lib/employee-portal/http"
import { loadEmployeeSaleDetail } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura. Venda alheia ou inexistente => 404 idêntico. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = new URL(request.url).searchParams
  if (rejectIdentityParams(params) || [...params.keys()].length > 0) return employeeBadRequest("Parâmetro não permitido.")
  const { id } = await context.params
  const opportunityId = parseOpportunityId(id)
  if (!opportunityId) return employeeError("not_found")
  const r = await loadEmployeeSaleDetail(opportunityId)
  if (!r.ok) return employeeError(r.kind)
  return employeeJson({ ok: true, data: r.data })
}
