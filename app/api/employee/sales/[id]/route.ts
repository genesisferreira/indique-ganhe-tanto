import { EMPLOYEE_API, runEmployeeGet } from "@/lib/employee-portal/api-gate"
import { employeeOutcome } from "@/lib/employee-portal/http"
import { createEmployeeSessionClient } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura. Venda alheia ou inexistente => 404 idêntico. ID inválido (autorizado) => 400. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const searchParams = new URL(request.url).searchParams
  const { id } = await context.params
  return employeeOutcome(await runEmployeeGet(await createEmployeeSessionClient(), EMPLOYEE_API.saleDetail, { searchParams, path: id }))
}
