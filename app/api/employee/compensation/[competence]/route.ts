import { EMPLOYEE_API, runEmployeeGet } from "@/lib/employee-portal/api-gate"
import { employeeOutcome } from "@/lib/employee-portal/http"
import { createEmployeeSessionClient } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura: linhas visíveis de uma competência própria (YYYY-MM). Ordem: sessão → papel/vínculo → path → RPC. */
export async function GET(request: Request, context: { params: Promise<{ competence: string }> }) {
  // 3.1F-J2C: request/context repassados BRUTOS; URL e params só são lidos pelo helper após o gate.
  return employeeOutcome(await runEmployeeGet(await createEmployeeSessionClient(), EMPLOYEE_API.competence, { request, context }))
}
