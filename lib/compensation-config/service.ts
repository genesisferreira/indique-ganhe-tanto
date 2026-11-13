import "server-only"

import { createClient } from "@/lib/supabase/server"
import { authorizeAdminRemuneracao } from "@/lib/admin-remuneracao/guard"
import {
  toEmployeeDetail,
  toEmployeeList,
  toEmployeePreview,
  toRulesList,
  isUuid,
  type EmployeeDetail,
  type EmployeeListItem,
  type EmployeePreview,
  type RulesList,
  type WriteOutcome,
} from "@/lib/compensation-config/contract"
import { runAdminCompensationWrite, type WriteKind, type WriteRequest, type WriteRpcClient } from "@/lib/compensation-config/handlers"

/**
 * 3.1F-J4 — leitura/escrita da configuração em rascunho. Sempre cliente da SESSÃO
 * (JWT do usuário); a autorização é refeita no banco (finance_admin_actor_role /
 * employee_portal_self). Nunca service role. Logs sem valores nem PII.
 */
export const ADMIN_READ_RPCS = ["admin_list_commission_rules", "admin_list_compensation_employees", "admin_get_employee_compensation"] as const
export const EMPLOYEE_PREVIEW_RPC = "employee_compensation_preview" as const

export type ReadKind = "unauthenticated" | "forbidden" | "not_found" | "unavailable"
export type ReadResult<T> = { ok: true; data: T } | { ok: false; kind: ReadKind }

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

function classify(error: { code?: string; message?: string }): ReadKind {
  const m = error.message ?? ""
  if (error.code === "42501" || /compensation_config_forbidden|employee_portal_forbidden/.test(m)) return "forbidden"
  if (/employee_portal_unauthenticated/.test(m)) return "unauthenticated"
  if (error.code === "P0002" || /compensation_config_not_found/.test(m)) return "not_found"
  return "unavailable"
}

async function sessionRead(fn: (typeof ADMIN_READ_RPCS)[number] | typeof EMPLOYEE_PREVIEW_RPC, args: Record<string, unknown>): Promise<ReadResult<unknown>> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.id) return { ok: false, kind: "unauthenticated" }
    const { data, error } = await (supabase as unknown as RpcClient).rpc(fn, args)
    if (error) {
      const kind = classify(error)
      if (kind === "unavailable") console.warn("[compensation-config] read_unavailable", { fn, code: error.code ?? null })
      return { ok: false, kind }
    }
    return { ok: true, data }
  } catch {
    console.warn("[compensation-config] read_unavailable", { fn })
    return { ok: false, kind: "unavailable" }
  }
}

export async function loadCommissionRules(): Promise<ReadResult<RulesList>> {
  const r = await sessionRead("admin_list_commission_rules", {})
  return r.ok ? { ok: true, data: toRulesList(r.data) } : r
}

export async function loadCompensationEmployees(): Promise<ReadResult<EmployeeListItem[]>> {
  const r = await sessionRead("admin_list_compensation_employees", {})
  return r.ok ? { ok: true, data: toEmployeeList(r.data) } : r
}

export async function loadEmployeeCompensationDetail(employeeId: string): Promise<ReadResult<EmployeeDetail>> {
  if (!isUuid(employeeId)) return { ok: false, kind: "not_found" }
  const r = await sessionRead("admin_get_employee_compensation", { p_employee_id: employeeId })
  if (!r.ok) return r
  const d = toEmployeeDetail(r.data)
  return d ? { ok: true, data: d } : { ok: false, kind: "unavailable" }
}

/** Funcionário: somente o PRÓPRIO rascunho vigente (auth.uid no banco; nenhum id enviado). */
export async function loadEmployeeCompensationPreview(): Promise<ReadResult<EmployeePreview>> {
  const r = await sessionRead(EMPLOYEE_PREVIEW_RPC, {})
  if (!r.ok) return r
  const p = toEmployeePreview(r.data)
  return p ? { ok: true, data: p } : { ok: false, kind: "unavailable" }
}

/** Rotas POST: guard admin → cliente da sessão → handler puro. */
export async function runAdminCompensationRoute(kind: WriteKind, request: WriteRequest): Promise<WriteOutcome> {
  const auth = await authorizeAdminRemuneracao()
  let client: WriteRpcClient | null = null
  if (auth.ok) {
    try {
      client = (await createClient()) as unknown as WriteRpcClient
    } catch {
      client = null
    }
  }
  return runAdminCompensationWrite(kind, auth.ok ? { ok: true } : { ok: false, status: auth.status }, client, request)
}
