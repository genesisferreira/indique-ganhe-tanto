import { EMPLOYEE_API, runEmployeeGet } from "@/lib/employee-portal/api-gate"
import { employeeOutcome } from "@/lib/employee-portal/http"
import { createEmployeeSessionClient } from "@/lib/employee-portal/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET somente leitura. Ordem: sessão → papel/vínculo → query → RPC. Sem POST/PATCH/PUT/DELETE. */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams
  return employeeOutcome(await runEmployeeGet(await createEmployeeSessionClient(), EMPLOYEE_API.dashboard, { searchParams }))
}
