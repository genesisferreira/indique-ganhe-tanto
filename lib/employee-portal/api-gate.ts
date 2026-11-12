import {
  classifyRpcError,
  parseCompensationListQuery,
  parseCompetenceParam,
  parseOpportunityId,
  parseSalesQuery,
  PORTAL_ERROR_MESSAGE,
  PORTAL_ERROR_STATUS,
  rejectIdentityParams,
  toCompensationSummaryResponse,
  toCompetenceDetailResponse,
  toDashboardResponse,
  toSaleDetailResponse,
  toSalesListResponse,
  type PortalErrorKind,
} from "@/lib/employee-portal/contracts"

/**
 * 3.1F-J2B — ordem obrigatória das APIs GET do funcionário:
 *   1. sessão → 2. usuário → 3. papel/vínculo elegível → 4. path/query → 5. RPC.
 *
 * Módulo puro (sem Next/cookies) para ser testável. O cliente é SEMPRE o da sessão
 * do usuário (JWT encaminhado); nunca service role. O gate lê somente a PRÓPRIA linha
 * de `profiles` e de `employees` (RLS: id/profile_id = auth.uid()). A política é a
 * mesma das RPCs (employee_portal_self), que continuam validando no banco
 * (defesa em profundidade).
 */

export const EMPLOYEE_PORTAL_READABLE_STATUSES = ["active", "paused", "vacation", "away"] as const

type DbError = { message?: string; code?: string } | null
type QueryResult = PromiseLike<{ data: unknown; error: DbError }>

export type EmployeeSessionClient = {
  auth: { getUser: () => PromiseLike<{ data: { user: { id?: string | null } | null } }> }
  from: (table: string) => {
    select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => QueryResult } }
  }
  rpc: (fn: string, args?: Record<string, unknown>) => QueryResult
}

export type ApiOutcome = { status: number; body: Record<string, unknown> }

export function errorOutcome(kind: PortalErrorKind): ApiOutcome {
  return { status: PORTAL_ERROR_STATUS[kind], body: { ok: false, message: PORTAL_ERROR_MESSAGE[kind] } }
}

export function badRequestOutcome(message: string): ApiOutcome {
  return { status: 400, body: { ok: false, message } }
}

/** Mesma política de employee_portal_self(). */
export function evaluateEmployeeEligibility(
  profile: { role?: unknown; is_active?: unknown } | null,
  employee: { status?: unknown } | null
): "ok" | "forbidden" {
  if (!profile || profile.role !== "funcionario" || profile.is_active === false) return "forbidden"
  if (!employee || !(EMPLOYEE_PORTAL_READABLE_STATUSES as readonly string[]).includes(String(employee.status ?? ""))) {
    return "forbidden"
  }
  return "ok"
}

/** Passos 1–3. Não lê path/query. */
export async function gateEmployeeSession(
  client: EmployeeSessionClient | null
): Promise<{ ok: true } | { ok: false; kind: PortalErrorKind }> {
  if (!client) return { ok: false, kind: "unauthenticated" }
  const {
    data: { user },
  } = await client.auth.getUser()
  const uid = user?.id ? String(user.id) : null
  if (!uid) return { ok: false, kind: "unauthenticated" }

  const profileRes = await client.from("profiles").select("role, is_active").eq("id", uid).maybeSingle()
  if (profileRes.error) return { ok: false, kind: "unavailable" }
  const profile = profileRes.data as { role?: unknown; is_active?: unknown } | null
  if (evaluateEmployeeEligibility(profile, { status: "active" }) === "forbidden") return { ok: false, kind: "forbidden" }

  const employeeRes = await client.from("employees").select("status").eq("profile_id", uid).maybeSingle()
  if (employeeRes.error) return { ok: false, kind: "unavailable" }
  if (evaluateEmployeeEligibility(profile, employeeRes.data as { status?: unknown } | null) === "forbidden") {
    return { ok: false, kind: "forbidden" }
  }
  return { ok: true }
}

export type ApiInput = { searchParams: URLSearchParams; path?: string | null }
type Parsed<P> = { ok: true; value: P } | { ok: false; outcome: ApiOutcome }

export type EmployeeApiSpec<P> = {
  rpc:
    | "employee_sales_dashboard_summary"
    | "list_employee_sales"
    | "get_employee_sale_detail"
    | "employee_compensation_summary"
    | "list_employee_competence_lines"
  parse: (input: ApiInput) => Parsed<P>
  args: (value: P) => Record<string, unknown>
  map: (raw: unknown) => unknown
}

function noQueryParams(params: URLSearchParams): Parsed<null> {
  if (rejectIdentityParams(params)) return { ok: false, outcome: badRequestOutcome("Parâmetro não permitido.") }
  if ([...params.keys()].length > 0) return { ok: false, outcome: badRequestOutcome("Parâmetro desconhecido.") }
  return { ok: true, value: null }
}

export const EMPLOYEE_API: {
  dashboard: EmployeeApiSpec<null>
  sales: EmployeeApiSpec<import("@/lib/employee-portal/contracts").SalesQuery>
  saleDetail: EmployeeApiSpec<string>
  compensation: EmployeeApiSpec<{ limit: number; offset: number }>
  competence: EmployeeApiSpec<string>
} = {
  dashboard: {
    rpc: "employee_sales_dashboard_summary",
    parse: ({ searchParams }) => noQueryParams(searchParams),
    args: () => ({}),
    map: toDashboardResponse,
  },
  sales: {
    rpc: "list_employee_sales",
    parse: ({ searchParams }) => {
      const r = parseSalesQuery(searchParams, { strict: true })
      return r.ok ? r : { ok: false, outcome: badRequestOutcome(r.error) }
    },
    args: (q) => ({
      p_limit: q.limit,
      p_offset: q.offset,
      p_sort: q.sort,
      p_from: q.from,
      p_to: q.to,
      p_stage: q.stage,
      p_status: q.status,
      p_commission: q.commission,
    }),
    map: toSalesListResponse,
  },
  saleDetail: {
    rpc: "get_employee_sale_detail",
    parse: ({ searchParams, path }) => {
      if (rejectIdentityParams(searchParams) || [...searchParams.keys()].length > 0) {
        return { ok: false, outcome: badRequestOutcome("Parâmetro não permitido.") }
      }
      const id = parseOpportunityId(String(path ?? ""))
      return id ? { ok: true, value: id } : { ok: false, outcome: badRequestOutcome("Identificador inválido.") }
    },
    args: (id) => ({ p_opportunity_id: id }),
    map: toSaleDetailResponse,
  },
  compensation: {
    rpc: "employee_compensation_summary",
    parse: ({ searchParams }) => {
      for (const k of searchParams.keys()) {
        if (k !== "limit" && k !== "offset") return { ok: false, outcome: badRequestOutcome("Parâmetro não permitido.") }
      }
      const r = parseCompensationListQuery(searchParams)
      return r.ok ? r : { ok: false, outcome: badRequestOutcome(r.error) }
    },
    args: (q) => ({ p_limit: q.limit, p_offset: q.offset }),
    map: toCompensationSummaryResponse,
  },
  competence: {
    rpc: "list_employee_competence_lines",
    parse: ({ searchParams, path }) => {
      if (rejectIdentityParams(searchParams) || [...searchParams.keys()].length > 0) {
        return { ok: false, outcome: badRequestOutcome("Parâmetro não permitido.") }
      }
      const month = parseCompetenceParam(String(path ?? ""))
      return month ? { ok: true, value: month } : { ok: false, outcome: badRequestOutcome("Competência inválida.") }
    },
    args: (month) => ({ p_competence_month: month }),
    map: toCompetenceDetailResponse,
  },
}

/** Passos 1→5, nesta ordem. Parser e RPC só rodam para funcionário elegível. */
export async function runEmployeeGet<P>(
  client: EmployeeSessionClient | null,
  spec: EmployeeApiSpec<P>,
  input: ApiInput
): Promise<ApiOutcome> {
  const gate = await gateEmployeeSession(client)
  if (!gate.ok) return errorOutcome(gate.kind)
  const parsed = spec.parse(input)
  if (!parsed.ok) return parsed.outcome
  const { data, error } = await (client as EmployeeSessionClient).rpc(spec.rpc, spec.args(parsed.value))
  if (error) {
    const kind = classifyRpcError(error)
    if (kind === "unavailable") {
      // Log sem PII: somente RPC e código.
      console.warn("[employee-portal] rpc_unavailable", { fn: spec.rpc, code: error.code ?? null })
    }
    return errorOutcome(kind)
  }
  return { status: 200, body: { ok: true, data: spec.map(data) } }
}
