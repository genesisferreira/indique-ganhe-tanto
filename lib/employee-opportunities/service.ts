import "server-only"

import { createEmployeeSessionClient } from "@/lib/employee-portal/service"
import { runLoadFormContext, type FormContextResult } from "@/lib/employee-opportunities/handlers"

/** 3.1F-J3: contexto do formulário (papéis elegíveis e planos ativos) com o cliente da SESSÃO. */
export async function loadEmployeeOpportunityFormContext(): Promise<FormContextResult> {
  return runLoadFormContext(await createEmployeeSessionClient())
}
