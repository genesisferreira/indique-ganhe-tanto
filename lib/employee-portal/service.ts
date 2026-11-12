import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { EmployeeSessionClient } from "@/lib/employee-portal/api-gate"
import {
  classifyRpcError,
  toCompensationSummaryResponse,
  toCompetenceDetailResponse,
  toDashboardResponse,
  toSaleDetailResponse,
  toSalesListResponse,
  type CompensationSummaryResponse,
  type CompetenceDetailResponse,
  type DashboardResponse,
  type PortalErrorKind,
  type SaleDetailResponse,
  type SalesListResponse,
  type SalesQuery,
} from "@/lib/employee-portal/contracts"

/**
 * 3.1F-J2 — leitura da área do funcionário.
 *
 * Sempre com o cliente da SESSÃO (anon key + cookies => JWT do usuário). Nunca
 * service role: a identidade é auth.uid() dentro das RPCs, que resolvem o
 * funcionário no servidor. Nenhum employee_id é enviado.
 * Somente leitura: nenhuma função aqui chama RPC/tabela de escrita.
 */
export type PortalResult<T> = { ok: true; data: T } | { ok: false; kind: PortalErrorKind }

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
}

export const EMPLOYEE_READ_RPCS = [
  "employee_sales_dashboard_summary",
  "list_employee_sales",
  "get_employee_sale_detail",
  "employee_compensation_summary",
  "list_employee_competence_lines",
] as const

type ReadRpc = (typeof EMPLOYEE_READ_RPCS)[number]

async function sessionRpc(fn: ReadRpc, args: Record<string, unknown>): Promise<PortalResult<unknown>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return { ok: false, kind: "unauthenticated" }
  const db = supabase as unknown as RpcClient
  const { data, error } = await db.rpc(fn, args)
  if (error) {
    const kind = classifyRpcError(error)
    if (kind === "unavailable") {
      // Log sem PII: somente RPC e código.
      console.warn("[employee-portal] rpc_unavailable", { fn, code: error.code ?? null })
    }
    return { ok: false, kind }
  }
  return { ok: true, data }
}

/**
 * 3.1F-J2B: cliente da SESSÃO para as APIs GET (gate + RPC). Nunca service role.
 * Retorna null quando não há configuração/sessão utilizável (=> 401 no gate).
 */
export async function createEmployeeSessionClient(): Promise<EmployeeSessionClient | null> {
  try {
    return (await createClient()) as unknown as EmployeeSessionClient
  } catch {
    return null
  }
}

function map<T>(r: PortalResult<unknown>, fn: (raw: unknown) => T): PortalResult<T> {
  return r.ok ? { ok: true, data: fn(r.data) } : r
}

export async function loadEmployeeDashboard(): Promise<PortalResult<DashboardResponse>> {
  return map(await sessionRpc("employee_sales_dashboard_summary", {}), toDashboardResponse)
}

export async function loadEmployeeSales(q: SalesQuery): Promise<PortalResult<SalesListResponse>> {
  return map(
    await sessionRpc("list_employee_sales", {
      p_limit: q.limit,
      p_offset: q.offset,
      p_sort: q.sort,
      p_from: q.from,
      p_to: q.to,
      p_stage: q.stage,
      p_status: q.status,
      p_commission: q.commission,
    }),
    toSalesListResponse
  )
}

export async function loadEmployeeSaleDetail(opportunityId: string): Promise<PortalResult<SaleDetailResponse>> {
  return map(await sessionRpc("get_employee_sale_detail", { p_opportunity_id: opportunityId }), toSaleDetailResponse)
}

export async function loadEmployeeCompensation(q: { limit: number; offset: number }): Promise<PortalResult<CompensationSummaryResponse>> {
  return map(await sessionRpc("employee_compensation_summary", { p_limit: q.limit, p_offset: q.offset }), toCompensationSummaryResponse)
}

export async function loadEmployeeCompetence(competenceMonth: string): Promise<PortalResult<CompetenceDetailResponse>> {
  return map(await sessionRpc("list_employee_competence_lines", { p_competence_month: competenceMonth }), toCompetenceDetailResponse)
}
