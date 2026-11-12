import { rejectIdentityParams } from "@/lib/employee-portal/contracts"
import { employeeBadRequest, employeeError, employeeJson } from "@/lib/employee-portal/http"
import { loadEmployeeDashboard } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura. Sem POST/PATCH/PUT/DELETE. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  if (rejectIdentityParams(params)) return employeeBadRequest("Parâmetro não permitido.")
  if ([...params.keys()].length > 0) return employeeBadRequest("Parâmetro desconhecido.")
  const r = await loadEmployeeDashboard()
  if (!r.ok) return employeeError(r.kind)
  return employeeJson({ ok: true, data: r.data })
}
