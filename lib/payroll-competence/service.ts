import "server-only"

import { createClient } from "@/lib/supabase/server"
import { authorizeAdminRemuneracao } from "@/lib/admin-remuneracao/guard"
import {
  isUuid,
  isMonthStart,
  toCompetenceDetail,
  toCompetenceList,
  toWorkedDaysView,
  type CompetenceDetail,
  type CompetenceList,
  type ReadKind,
  type ReadResult,
  type WorkedDaysView,
  type WriteOutcome,
} from "@/lib/payroll-competence/contract"
import { runPayrollWrite, type WriteKind, type WriteRequest, type WriteRpcClient } from "@/lib/payroll-competence/handlers"

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

function classify(error: { code?: string; message?: string }): ReadKind {
  const m = error.message ?? ""
  if (error.code === "42501" || /compensation_config_forbidden/.test(m)) return "forbidden"
  if (error.code === "P0002" || /compensation_config_not_found|employee_portal_unauthenticated/.test(m)) return "not_found"
  return "unavailable"
}

async function sessionRead(fn: string, args: Record<string, unknown>): Promise<ReadResult<unknown>> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.id) return { ok: false, kind: "unauthenticated" }
    const { data, error } = await (supabase as unknown as RpcClient).rpc(fn, args)
    if (error) {
      const kind = classify(error)
      if (kind === "unavailable") console.warn("[payroll-competence] read_unavailable", { fn, code: error.code ?? null })
      return { ok: false, kind }
    }
    return { ok: true, data }
  } catch {
    console.warn("[payroll-competence] read_unavailable", { fn })
    return { ok: false, kind: "unavailable" }
  }
}

export async function loadWorkedDays(employeeId: string, competenceMonth: string): Promise<ReadResult<WorkedDaysView>> {
  if (!isUuid(employeeId) || !isMonthStart(competenceMonth)) return { ok: false, kind: "not_found" }
  const r = await sessionRead("admin_list_employee_worked_days", { p_payload: { employeeId, competenceMonth } })
  if (!r.ok) return r
  const v = toWorkedDaysView(r.data)
  return v ? { ok: true, data: v } : { ok: false, kind: "unavailable" }
}

export async function loadCompetenceList(employeeId?: string | null, competenceMonth?: string | null): Promise<ReadResult<CompetenceList>> {
  const payload: Record<string, unknown> = {}
  if (employeeId && isUuid(employeeId)) payload.employeeId = employeeId
  if (competenceMonth && isMonthStart(competenceMonth)) payload.competenceMonth = competenceMonth
  const r = await sessionRead("admin_list_payroll_competences", { p_payload: payload })
  return r.ok ? { ok: true, data: toCompetenceList(r.data) } : r
}

export async function loadCompetenceDetail(competenceId: string): Promise<ReadResult<CompetenceDetail>> {
  if (!isUuid(competenceId)) return { ok: false, kind: "not_found" }
  const r = await sessionRead("admin_get_payroll_competence", { p_payload: { competenceId } })
  if (!r.ok) return r
  const d = toCompetenceDetail(r.data)
  return d ? { ok: true, data: d } : { ok: false, kind: "unavailable" }
}

export async function runPayrollRoute(kind: WriteKind, request: WriteRequest): Promise<WriteOutcome> {
  const auth = await authorizeAdminRemuneracao()
  let client: WriteRpcClient | null = null
  if (auth.ok) {
    try {
      client = (await createClient()) as unknown as WriteRpcClient
    } catch {
      client = null
    }
  }
  return runPayrollWrite(kind, auth.ok ? { ok: true } : { ok: false, status: auth.status }, client, request)
}
