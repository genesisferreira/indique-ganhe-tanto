import { EMPLOYEE_API, runEmployeeGet } from "@/lib/employee-portal/api-gate"
import { employeeOutcome } from "@/lib/employee-portal/http"
import { createEmployeeSessionClient } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura. Venda alheia ou inexistente => 404 idêntico. ID inválido (autorizado) => 400. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  // 3.1F-J2C: request/context repassados BRUTOS; URL e params só são lidos pelo helper após o gate.
  return employeeOutcome(await runEmployeeGet(await createEmployeeSessionClient(), EMPLOYEE_API.saleDetail, { request, context }))
}
