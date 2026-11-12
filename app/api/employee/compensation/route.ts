import { parseCompensationListQuery } from "@/lib/employee-portal/contracts"
import { employeeBadRequest, employeeError, employeeJson } from "@/lib/employee-portal/http"
import { loadEmployeeCompensation } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura: perfil visível + competências próprias. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  for (const k of params.keys()) if (k !== "limit" && k !== "offset") return employeeBadRequest("Parâmetro não permitido.")
  const parsed = parseCompensationListQuery(params)
  if (!parsed.ok) return employeeBadRequest(parsed.error)
  const r = await loadEmployeeCompensation(parsed.value)
  if (!r.ok) return employeeError(r.kind)
  return employeeJson({ ok: true, data: r.data })
}
