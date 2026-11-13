/**
 * 3.1F-J2 — contratos FECHADOS das APIs /api/employee/* e validação de query.
 * Puro (sem I/O). As RPCs já retornam somente colunas permitidas; aqui a
 * resposta é re-montada campo a campo (defesa em profundidade): qualquer chave
 * inesperada vinda do banco é descartada.
 */

export const SALES_SORTS = ["created_desc", "created_asc", "updated_desc"] as const
export const PIPELINE_STAGES = [
  "novo", "tentativa_contato", "contato_realizado", "negociacao", "agendado", "instalacao", "ativado", "perdido",
] as const
export const OPPORTUNITY_STATUSES = [
  "pendente", "em_andamento", "em_atendimento", "em_negociacao", "aprovada", "recusada", "paga",
] as const
export const COMMISSION_FILTERS = [
  "none", "pending_evidence", "accrued", "approved", "included_in_payroll", "paid", "reversed", "rejected",
] as const
/** 3.1F-J3: papéis originadores filtráveis em "Minhas vendas". */
export const SALES_ROLE_FILTERS = ["technician_originator", "external_sales_originator", "internal_sales_responsible"] as const
export const SALES_SEARCH_MIN = 2
export const SALES_SEARCH_MAX = 40
export const SALES_PAGE_SIZE_DEFAULT = 20
export const SALES_PAGE_SIZE_MAX = 50
export const SALES_OFFSET_MAX = 10000
export const COMPETENCE_PAGE_SIZE_DEFAULT = 12
export const COMPETENCE_PAGE_SIZE_MAX = 24

export type SalesQuery = {
  limit: number
  offset: number
  sort: (typeof SALES_SORTS)[number]
  from: string | null
  to: string | null
  stage: (typeof PIPELINE_STAGES)[number] | null
  status: (typeof OPPORTUNITY_STATUSES)[number] | null
  commission: (typeof COMMISSION_FILTERS)[number] | null
  /** 3.1F-J3 */
  role: (typeof SALES_ROLE_FILTERS)[number] | null
  /** 3.1F-J3: busca somente nos dados visíveis ao funcionário (referência, nome mascarado, plano). */
  search: string | null
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

type ParamSource = { get(name: string): string | null; keys(): IterableIterator<string> }

const SALES_KEYS = new Set(["limit", "offset", "page", "sort", "from", "to", "stage", "status", "commission", "role", "q"])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
/** Campos de identidade NUNCA aceitos do cliente. */
const FORBIDDEN_PARAMS = new Set(["employee_id", "employeeId", "profile_id", "profileId", "user_id", "userId", "uid"])

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && value >= "2020-01-01" && value <= "2100-01-01"
}

function pick<T extends string>(raw: string | null, allowed: readonly T[]): T | null | undefined {
  if (raw == null || raw === "") return null
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined
}

function intParam(raw: string | null, def: number, min: number, max: number): number | undefined {
  if (raw == null || raw === "") return def
  if (!/^\d{1,6}$/.test(raw)) return undefined
  const n = Number(raw)
  return n >= min && n <= max ? n : undefined
}

export function rejectIdentityParams(params: ParamSource): string | null {
  for (const k of params.keys()) if (FORBIDDEN_PARAMS.has(k)) return "Parâmetro não permitido."
  return null
}

export function parseSalesQuery(params: ParamSource, opts: { strict?: boolean } = {}): ParseResult<SalesQuery> {
  const identity = rejectIdentityParams(params)
  if (identity) return { ok: false, error: identity }
  if (opts.strict) for (const k of params.keys()) if (!SALES_KEYS.has(k)) return { ok: false, error: "Parâmetro desconhecido." }
  const limit = intParam(params.get("limit"), SALES_PAGE_SIZE_DEFAULT, 1, SALES_PAGE_SIZE_MAX)
  if (limit === undefined) return { ok: false, error: "Limite inválido." }
  let offset = intParam(params.get("offset"), 0, 0, SALES_OFFSET_MAX)
  const page = intParam(params.get("page"), 1, 1, 1000)
  if (page === undefined) return { ok: false, error: "Página inválida." }
  if (offset === undefined) return { ok: false, error: "Deslocamento inválido." }
  if (params.get("page") && !params.get("offset")) offset = (page - 1) * limit
  if (offset > SALES_OFFSET_MAX) return { ok: false, error: "Página inválida." }
  const sort = pick(params.get("sort"), SALES_SORTS)
  if (sort === undefined) return { ok: false, error: "Ordenação inválida." }
  const stage = pick(params.get("stage"), PIPELINE_STAGES)
  if (stage === undefined) return { ok: false, error: "Etapa inválida." }
  const status = pick(params.get("status"), OPPORTUNITY_STATUSES)
  if (status === undefined) return { ok: false, error: "Status inválido." }
  const commission = pick(params.get("commission"), COMMISSION_FILTERS)
  if (commission === undefined) return { ok: false, error: "Situação da comissão inválida." }
  const role = pick(params.get("role"), SALES_ROLE_FILTERS)
  if (role === undefined) return { ok: false, error: "Papel inválido." }
  const rawSearch = (params.get("q") ?? "").replace(/\s+/g, " ").trim()
  if (rawSearch && (rawSearch.length < SALES_SEARCH_MIN || rawSearch.length > SALES_SEARCH_MAX)) {
    return { ok: false, error: "Busca deve ter entre 2 e 40 caracteres." }
  }
  const search = rawSearch || null
  const from = params.get("from") || null
  const to = params.get("to") || null
  if (from && !isValidDate(from)) return { ok: false, error: "Data inicial inválida." }
  if (to && !isValidDate(to)) return { ok: false, error: "Data final inválida." }
  if (from && to && to < from) return { ok: false, error: "Período inválido." }
  return { ok: true, value: { limit, offset, sort: sort ?? "created_desc", from, to, stage, status, commission, role, search } }
}

export function parseOpportunityId(raw: string | null | undefined): string | null {
  return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null
}

/** Competência na URL: YYYY-MM -> primeiro dia do mês (YYYY-MM-01). */
export function parseCompetenceParam(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = MONTH_RE.exec(raw)
  if (!m) return null
  const value = `${m[1]}-${m[2]}-01`
  return isValidDate(value) ? value : null
}

export function competenceToParam(month: string): string {
  return month.slice(0, 7)
}

export function parseCompensationListQuery(params: ParamSource): ParseResult<{ limit: number; offset: number }> {
  const identity = rejectIdentityParams(params)
  if (identity) return { ok: false, error: identity }
  const limit = intParam(params.get("limit"), COMPETENCE_PAGE_SIZE_DEFAULT, 1, COMPETENCE_PAGE_SIZE_MAX)
  const offset = intParam(params.get("offset"), 0, 0, 1000)
  if (limit === undefined || offset === undefined) return { ok: false, error: "Paginação inválida." }
  return { ok: true, value: { limit, offset } }
}

// ---------------------------------------------------------------------------
// Respostas fechadas
// ---------------------------------------------------------------------------
export type Money = string

export type DashboardResponse = {
  competenceMonth: string
  employeeStatus: string
  readOnly: boolean
  opportunitiesInMonth: number
  salesInProgress: number
  provenConversions: number
  commissionsAwaitingEvidence: number
  commissionAccruedInCompetence: Money
  currentCompetence: { month: string; status: string } | null
  recent: Array<{ id: string; createdAt: string; stage: string; status: string; role: string }>
}

export type SaleListItem = {
  id: string
  reference: string
  createdAt: string
  interested: string | null
  plan: string | null
  stage: string
  status: string
  role: string
  commissionStatus: string
  updatedAt: string
}

export type SalesListResponse = { items: SaleListItem[]; total: number; limit: number; offset: number; sort: string }

export type SaleDetailResponse = {
  id: string
  reference: string
  createdAt: string
  updatedAt: string
  interested: string | null
  plan: string | null
  stage: string
  stageSince: string | null
  status: string
  role: string
  timeline: Array<{ at: string; from: string | null; to: string }>
  commissions: Array<{ status: string; competenceMonth: string | null; amount?: Money }>
}

export type CompensationProfileView = {
  validFrom: string
  salary?: { amount: Money }
  meal?: { dailyAmount: Money }
  transport?: { amount: Money; method: string }
  fuel?: { amount: Money; method: string }
}

export type CompensationSummaryResponse = {
  employeeStatus: string
  readOnly: boolean
  profile: CompensationProfileView | null
  competences: Array<{ competenceMonth: string; status: string; visibleTotal: Money; totalKind: "expected" | "closed" }>
  total: number
  limit: number
  offset: number
}

export const COMPONENT_KEYS = ["commission", "salary", "meal", "transport", "fuel", "otherEarnings", "discounts"] as const
export type ComponentKey = (typeof COMPONENT_KEYS)[number]

export type CompetenceDetailResponse = {
  competenceMonth: string
  status: string
  version: number
  /** Componentes ocultos/desabilitados são OMITIDOS (nunca zero). */
  components: Partial<Record<ComponentKey, Money>>
  total: { kind: "expected" | "closed"; amount: Money }
  lines: Array<{ kind: ComponentKey; type: string; description: string; quantity: string; amount: Money; createdAt: string }>
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const strOrNull = (v: unknown): string | null => (v == null ? null : str(v))
const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}
/** Dinheiro como string decimal com 2 casas (sem float na borda). */
export const money = (v: unknown): Money => {
  const s = typeof v === "number" ? v.toFixed(2) : str(v)
  return /^-?\d{1,12}(\.\d{1,2})?$/.test(s) ? (s.includes(".") ? s.padEnd(s.indexOf(".") + 3, "0") : `${s}.00`) : "0.00"
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(str(v)) ? (str(v) as T) : fallback

export function toDashboardResponse(raw: unknown): DashboardResponse {
  const r = isObj(raw) ? raw : {}
  const cc = isObj(r.currentCompetence) ? r.currentCompetence : null
  return {
    competenceMonth: str(r.competenceMonth),
    employeeStatus: str(r.employeeStatus),
    readOnly: r.readOnly === true,
    opportunitiesInMonth: int(r.opportunitiesInMonth),
    salesInProgress: int(r.salesInProgress),
    provenConversions: int(r.provenConversions),
    commissionsAwaitingEvidence: int(r.commissionsAwaitingEvidence),
    commissionAccruedInCompetence: money(r.commissionAccruedInCompetence),
    currentCompetence: cc ? { month: str(cc.month), status: str(cc.status) } : null,
    recent: arr(r.recent).filter(isObj).slice(0, 5).map((x) => ({
      id: str(x.id), createdAt: str(x.createdAt), stage: str(x.stage), status: str(x.status), role: str(x.role),
    })),
  }
}

export function toSalesListResponse(raw: unknown): SalesListResponse {
  const r = isObj(raw) ? raw : {}
  return {
    items: arr(r.items).filter(isObj).slice(0, SALES_PAGE_SIZE_MAX).map((x) => ({
      id: str(x.id),
      reference: str(x.reference),
      createdAt: str(x.createdAt),
      interested: strOrNull(x.interested),
      plan: strOrNull(x.plan),
      stage: str(x.stage),
      status: str(x.status),
      role: str(x.role),
      commissionStatus: oneOf(x.commissionStatus, COMMISSION_FILTERS, "none"),
      updatedAt: str(x.updatedAt),
    })),
    total: int(r.total),
    limit: int(r.limit),
    offset: int(r.offset),
    sort: str(r.sort),
  }
}

export function toSaleDetailResponse(raw: unknown): SaleDetailResponse {
  const r = isObj(raw) ? raw : {}
  return {
    id: str(r.id),
    reference: str(r.reference),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    interested: strOrNull(r.interested),
    plan: strOrNull(r.plan),
    stage: str(r.stage),
    stageSince: strOrNull(r.stageSince),
    status: str(r.status),
    role: str(r.role),
    timeline: arr(r.timeline).filter(isObj).slice(0, 50).map((x) => ({ at: str(x.at), from: strOrNull(x.from), to: str(x.to) })),
    commissions: arr(r.commissions).filter(isObj).slice(0, 20).map((x) => {
      const item: { status: string; competenceMonth: string | null; amount?: Money } = {
        status: oneOf(x.status, COMMISSION_FILTERS, "none"),
        competenceMonth: strOrNull(x.competenceMonth),
      }
      if (x.amount != null) item.amount = money(x.amount)
      return item
    }),
  }
}

export function toCompensationSummaryResponse(raw: unknown): CompensationSummaryResponse {
  const r = isObj(raw) ? raw : {}
  const p = isObj(r.profile) ? r.profile : null
  let profile: CompensationProfileView | null = null
  if (p) {
    profile = { validFrom: str(p.validFrom) }
    if (isObj(p.salary)) profile.salary = { amount: money(p.salary.amount) }
    if (isObj(p.meal)) profile.meal = { dailyAmount: money(p.meal.dailyAmount) }
    if (isObj(p.transport)) profile.transport = { amount: money(p.transport.amount), method: str(p.transport.method) }
    if (isObj(p.fuel)) profile.fuel = { amount: money(p.fuel.amount), method: str(p.fuel.method) }
  }
  return {
    employeeStatus: str(r.employeeStatus),
    readOnly: r.readOnly === true,
    profile,
    competences: arr(r.competences).filter(isObj).slice(0, COMPETENCE_PAGE_SIZE_MAX).map((x) => ({
      competenceMonth: str(x.competenceMonth),
      status: str(x.status),
      visibleTotal: money(x.visibleTotal),
      totalKind: x.totalKind === "closed" ? "closed" : "expected",
    })),
    total: int(r.total),
    limit: int(r.limit),
    offset: int(r.offset),
  }
}

export function toCompetenceDetailResponse(raw: unknown): CompetenceDetailResponse {
  const r = isObj(raw) ? raw : {}
  const comp = isObj(r.components) ? r.components : {}
  const components: Partial<Record<ComponentKey, Money>> = {}
  for (const k of COMPONENT_KEYS) if (k in comp && comp[k] != null) components[k] = money(comp[k])
  const total = isObj(r.total) ? r.total : {}
  return {
    competenceMonth: str(r.competenceMonth),
    status: str(r.status),
    version: int(r.version),
    components,
    total: { kind: total.kind === "closed" ? "closed" : "expected", amount: money(total.amount) },
    lines: arr(r.lines).filter(isObj).slice(0, 500).map((x) => ({
      kind: oneOf(x.kind, COMPONENT_KEYS, "otherEarnings"),
      type: str(x.type),
      description: str(x.description).slice(0, 200),
      quantity: str(x.quantity),
      amount: money(x.amount),
      createdAt: str(x.createdAt),
    })),
  }
}

// ---------------------------------------------------------------------------
// Erros: mapeamento estável, sem detalhes internos.
// ---------------------------------------------------------------------------
export type PortalErrorKind = "unauthenticated" | "forbidden" | "not_found" | "invalid" | "unavailable"

export function classifyRpcError(error: { message?: string | null; code?: string | null } | null | undefined): PortalErrorKind {
  const m = String(error?.message ?? "")
  if (m.includes("employee_portal_unauthenticated")) return "unauthenticated"
  if (m.includes("employee_portal_forbidden")) return "forbidden"
  if (m.includes("employee_portal_not_found")) return "not_found"
  if (m.includes("employee_portal_invalid_parameter")) return "invalid"
  if (error?.code === "42501") return "forbidden"
  return "unavailable"
}

export const PORTAL_ERROR_STATUS: Record<PortalErrorKind, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  unavailable: 503,
}

export const PORTAL_ERROR_MESSAGE: Record<PortalErrorKind, string> = {
  unauthenticated: "Sessão não encontrada. Faça login novamente.",
  forbidden: "Acesso não permitido para este perfil.",
  not_found: "Registro não encontrado.",
  invalid: "Parâmetros inválidos.",
  unavailable: "Não foi possível carregar os dados agora. Tente novamente.",
}
