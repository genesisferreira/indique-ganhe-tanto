import "server-only"

import { createClient } from "@/lib/supabase/server"

/**
 * 3.1F-H1 — caminho servidor exclusivo para oportunidade de funcionário.
 * Usa a sessão do usuário (authenticated); NUNCA service_role.
 * Não reutiliza createReferral/createAssistedReferral (que geram direito de indicador).
 * A RPC força origin_kind='employee', indicator_profile_id=NULL, reward_eligible=false,
 * cria a atribuição na mesma transação e é idempotente pela chave.
 */
export const EMPLOYEE_ATTRIBUTION_ROLES = [
  "technician_originator",
  "external_sales_originator",
  "internal_sales_responsible",
] as const
export type EmployeeAttributionRole = (typeof EMPLOYEE_ATTRIBUTION_ROLES)[number]

export type CreateEmployeeSalesOpportunityInput = {
  idempotencyKey: string
  attributionRole: EmployeeAttributionRole
  sectorId: string
  planId: string
  referredName: string
  referredPhone: string
  referredEmail?: string | null
  referredObservation?: string | null
}

export type CreateEmployeeSalesOpportunityResult =
  | { ok: true; idempotent: boolean; opportunityId: string }
  | { ok: false; code: string }

export function buildCreateEmployeeSalesOpportunityArgs(input: CreateEmployeeSalesOpportunityInput) {
  return {
    p_idempotency_key: input.idempotencyKey,
    p_attribution_role: input.attributionRole,
    p_sector_id: input.sectorId,
    p_plan_id: input.planId,
    p_referred_name: input.referredName,
    p_referred_phone: input.referredPhone,
    p_referred_email: input.referredEmail ?? null,
    p_referred_observation: input.referredObservation ?? null,
  }
}

export async function createEmployeeSalesOpportunity(
  input: CreateEmployeeSalesOpportunityInput
): Promise<CreateEmployeeSalesOpportunityResult> {
  if (!EMPLOYEE_ATTRIBUTION_ROLES.includes(input.attributionRole)) {
    return { ok: false, code: "invalid_attribution_role" }
  }
  const supabase = await createClient()
  const db = supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>
  }
  const { data, error } = await db.rpc(
    "create_employee_sales_opportunity",
    buildCreateEmployeeSalesOpportunityArgs(input)
  )
  if (error) return { ok: false, code: error.code ?? "rpc_error" }
  const r = (data ?? {}) as { ok?: boolean; idempotent?: boolean; opportunity_id?: string; code?: string }
  if (!r.ok || !r.opportunity_id) return { ok: false, code: r.code ?? "unknown" }
  return { ok: true, idempotent: Boolean(r.idempotent), opportunityId: r.opportunity_id }
}
