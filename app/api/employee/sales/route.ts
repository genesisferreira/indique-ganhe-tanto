import { parseSalesQuery } from "@/lib/employee-portal/contracts"
import { employeeBadRequest, employeeError, employeeJson } from "@/lib/employee-portal/http"
import { loadEmployeeSales } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura: vendas atribuídas ao usuário autenticado. */
export async function GET(request: Request) {
  const parsed = parseSalesQuery(new URL(request.url).searchParams, { strict: true })
  if (!parsed.ok) return employeeBadRequest(parsed.error)
  const r = await loadEmployeeSales(parsed.value)
  if (!r.ok) return employeeError(r.kind)
  return employeeJson({ ok: true, data: r.data })
}
