/**
 * 3.1F-J4 — contrato PURO (sem Next/Supabase) da configuração de comissão e remuneração.
 *
 * Tudo é RASCUNHO: nenhuma regra/perfil é ativado, nenhuma comissão é calculada, nenhum
 * entitlement/competência/folha é criado. Os valores sugeridos abaixo NUNCA são enviados
 * automaticamente: só preenchem o campo quando o administrador clica em "Usar sugestão" e
 * ainda exigem motivo + salvar.
 */

export type CommissionRole = "technician_originator" | "external_sales_originator" | "internal_sales_responsible"
export type ConfigurableRole = Exclude<CommissionRole, "internal_sales_responsible">
export type CommissionMethod = "fixed_amount" | "percentage" | "first_invoice_value"
export type CommissionTrigger = "first_valid_invoice_generated" | "first_valid_invoice_fully_paid"
export type BenefitMethod = "per_worked_day" | "monthly_fixed"
export type VersionStatus = "draft" | "approved" | "active" | "superseded" | "archived"

export const CONFIGURABLE_ROLES: readonly ConfigurableRole[] = ["technician_originator", "external_sales_originator"]
export const DISABLED_ROLES: readonly CommissionRole[] = ["internal_sales_responsible"]
export const COMMISSION_METHODS: readonly CommissionMethod[] = ["fixed_amount", "percentage", "first_invoice_value"]
export const BENEFIT_METHODS: readonly BenefitMethod[] = ["monthly_fixed", "per_worked_day"]

export const ROLE_LABEL: Record<CommissionRole, string> = {
  technician_originator: "Técnico de Rua",
  external_sales_originator: "Vendedor Externo",
  internal_sales_responsible: "Vendedor Interno",
}
export const METHOD_LABEL: Record<CommissionMethod, string> = {
  fixed_amount: "Valor fixo",
  percentage: "Percentual",
  first_invoice_value: "Valor da primeira fatura",
}
export const TRIGGER_LABEL: Record<CommissionTrigger, string> = {
  first_valid_invoice_generated: "Quando a primeira fatura válida for gerada",
  first_valid_invoice_fully_paid: "Quando a primeira fatura for paga",
}
/** Gatilho é DERIVADO do tipo (o cliente nunca escolhe). */
export const METHOD_TRIGGER: Record<CommissionMethod, CommissionTrigger> = {
  fixed_amount: "first_valid_invoice_generated",
  percentage: "first_valid_invoice_generated",
  first_invoice_value: "first_valid_invoice_fully_paid",
}
export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  draft: "Rascunho",
  approved: "Aprovada",
  active: "Ativa",
  superseded: "Substituída",
  archived: "Arquivada",
}
export const BENEFIT_METHOD_LABEL: Record<BenefitMethod, string> = {
  per_worked_day: "por dia trabalhado",
  monthly_fixed: "mensal fixo",
}
export const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  vacation: "Férias",
  away: "Afastado",
  dismissed: "Desligado",
}
/** Setor -> função remunerável (somente setores com papel de comissão comprovado na J3). */
export const SECTOR_ROLE: Record<string, ConfigurableRole> = {
  technician: "technician_originator",
  external_sales: "external_sales_originator",
}

export const DRAFT_BANNERS = [
  "Configuração em rascunho",
  "Nenhuma regra financeira está ativa",
  "Nenhuma comissão será calculada nesta etapa",
] as const
export const ACTIVATE_DISABLED_REASON = "Aguardando validação da integração financeira"
export const FIRST_INVOICE_NOT_ACTIVATABLE =
  "Bloqueada: pagamento integral e ordem não comprovados."
export const PERCENTAGE_BASE_UNPROVEN =
  "Bloqueada: base percentual não comprovada."
export const FIXED_AMOUNT_ACTIVATABLE_COPY =
  "Comissão fixa liberada por evidência de fatura gerada."

/** Sugestões somente de interface (nunca default de banco, nunca enviadas sem clique + motivo). */
export const UI_SUGGESTION = {
  technician_originator: { method: "fixed_amount" as const, amount: "30.00" },
  external_sales_originator: { method: "fixed_amount" as const, amount: "50.00" },
  internal_sales_responsible: { method: "percentage" as const, percent: "2" },
  mealDaily: "22.00",
} as const

// ---------------------------------------------------------------------------
// Números: sempre string decimal (sem float na origem)
// ---------------------------------------------------------------------------

/** "2.500,00" | "2500,5" | "2500.50" -> "2500.50". Positivo, até 8 dígitos inteiros e 2 casas. */
export function parseMoneyInput(raw: string): string | null {
  let s = raw.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "")
  if (s === "") return null
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".")
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null
  const [i, f = ""] = s.split(".")
  const out = `${String(parseInt(i, 10))}.${f.padEnd(2, "0")}`
  return out === "0.00" ? null : out
}

/** Percentual digitado ("2", "2,5", "12.3456") -> fração com 6 casas ("0.020000"). Máx. 4 casas no %, 0 < x <= 100. */
export function percentToFraction(raw: string): string | null {
  const s = raw.trim().replace(/%$/, "").trim().replace(",", ".")
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null
  const [i, f = ""] = s.split(".")
  // Inteiros exatos (<= 1.000.000): unidades de 0,0001% = 1e-6 em fração. Sem float.
  const micro = parseInt(i, 10) * 10000 + parseInt(f.padEnd(4, "0"), 10)
  if (micro <= 0 || micro > 1000000) return null
  return `${Math.floor(micro / 1000000)}.${String(micro % 1000000).padStart(6, "0")}`
}

/** Fração ("0.123456") -> "12,3456%" (sem float). */
export function fractionToPercentLabel(fraction: string | null | undefined): string {
  if (!fraction || !/^\d+(\.\d{1,6})?$/.test(fraction)) return "—"
  const [i, f = ""] = fraction.split(".")
  if (i.length > 1 || parseInt(i, 10) > 1) return "—"
  const micro = parseInt(i, 10) * 1000000 + parseInt(f.padEnd(6, "0"), 10)
  const whole = Math.floor(micro / 10000)
  const frac = String(micro % 10000).padStart(4, "0").replace(/0+$/, "")
  return `${whole}${frac ? `,${frac}` : ""}%`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v)
const IDEM = /^[A-Za-z0-9_-]{16,128}$/
export const isIdempotencyKey = (v: unknown): v is string => typeof v === "string" && IDEM.test(v)

export function newIdempotencyKey(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return `cc_${random().replace(/-/g, "")}`
}

/** Data de hoje em America/Sao_Paulo (YYYY-MM-DD). */
export function todaySaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

// ---------------------------------------------------------------------------
// Payloads (validação estrita espelhando o contrato fechado das RPCs)
// ---------------------------------------------------------------------------
export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: WriteErrorCode; field?: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const optStr = (v: unknown, max: number) => v === undefined || v === null || (typeof v === "string" && v.trim().length <= max)
const reqStr = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max
const MONEY = /^\d{1,8}\.\d{2}$/
const isMoney = (v: unknown): v is string => typeof v === "string" && MONEY.test(v) && v !== "0.00" && !/^0+\.00$/.test(v)
const isFraction = (v: unknown): v is string =>
  typeof v === "string" && /^(0\.\d{1,6}|1\.0{1,6})$/.test(v) && Number(v) > 0
const isNil = (v: unknown) => v === undefined || v === null

function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return k
  return null
}

export const RULE_KEYS = [
  "idempotencyKey", "previousRuleId", "name", "attributionRole", "method", "fixedAmount",
  "percentageRate", "percentageBase", "effectiveFrom", "effectiveUntil", "description", "reason",
] as const
export type RulePayload = {
  idempotencyKey: string
  previousRuleId?: string
  name: string
  attributionRole?: ConfigurableRole
  method: CommissionMethod
  fixedAmount?: string
  percentageRate?: string
  effectiveFrom: string
  effectiveUntil?: string
  description?: string
  reason: string
}

export function parseRulePayload(body: unknown): ParseResult<RulePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const extra = unknownKeys(body, RULE_KEYS)
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isNil(body.previousRuleId) && !isUuid(body.previousRuleId)) return { ok: false, code: "invalid_previous_rule" }
  if (!reqStr(body.name, 3, 120)) return { ok: false, code: "invalid_name", field: "name" }
  if (!reqStr(body.reason, 3, 500)) return { ok: false, code: "reason_required", field: "reason" }
  if (!optStr(body.description, 500)) return { ok: false, code: "invalid_description", field: "description" }
  if (body.attributionRole === "internal_sales_responsible") return { ok: false, code: "role_disabled", field: "attributionRole" }
  if (!isNil(body.attributionRole) && !CONFIGURABLE_ROLES.includes(body.attributionRole as ConfigurableRole)) {
    return { ok: false, code: "invalid_role", field: "attributionRole" }
  }
  if (isNil(body.previousRuleId) && isNil(body.attributionRole)) return { ok: false, code: "invalid_role", field: "attributionRole" }
  if (!COMMISSION_METHODS.includes(body.method as CommissionMethod)) return { ok: false, code: "invalid_method", field: "method" }
  if (!isNil(body.percentageBase)) return { ok: false, code: "percentage_base_not_proven", field: "percentageBase" }
  const method = body.method as CommissionMethod
  if (method === "fixed_amount") {
    if (!isMoney(body.fixedAmount)) return { ok: false, code: "invalid_fixed_amount", field: "fixedAmount" }
    if (!isNil(body.percentageRate)) return { ok: false, code: "invalid_method_values", field: "percentageRate" }
  } else if (method === "percentage") {
    if (!isFraction(body.percentageRate)) return { ok: false, code: "invalid_percentage_rate", field: "percentageRate" }
    if (!isNil(body.fixedAmount)) return { ok: false, code: "invalid_method_values", field: "fixedAmount" }
  } else if (!isNil(body.fixedAmount) || !isNil(body.percentageRate)) {
    return { ok: false, code: "invalid_method_values", field: "fixedAmount" }
  }
  if (!isIsoDate(body.effectiveFrom)) return { ok: false, code: "invalid_period", field: "effectiveFrom" }
  if (!isNil(body.effectiveUntil) && (!isIsoDate(body.effectiveUntil) || body.effectiveUntil < body.effectiveFrom)) {
    return { ok: false, code: "invalid_period", field: "effectiveUntil" }
  }
  const v: RulePayload = {
    idempotencyKey: body.idempotencyKey,
    name: (body.name as string).trim(),
    method,
    effectiveFrom: body.effectiveFrom,
    reason: (body.reason as string).trim(),
  }
  if (!isNil(body.previousRuleId)) v.previousRuleId = body.previousRuleId as string
  if (!isNil(body.attributionRole)) v.attributionRole = body.attributionRole as ConfigurableRole
  if (method === "fixed_amount") v.fixedAmount = body.fixedAmount as string
  if (method === "percentage") v.percentageRate = body.percentageRate as string
  if (!isNil(body.effectiveUntil)) v.effectiveUntil = body.effectiveUntil as string
  if (typeof body.description === "string" && body.description.trim()) v.description = body.description.trim()
  return { ok: true, value: v }
}

export const PROFILE_KEYS = [
  "idempotencyKey", "employeeId", "previousProfileId", "validFrom", "validUntil",
  "salaryAmount", "mealDailyAmount", "transportAmount", "transportMethod", "fuelAmount", "fuelMethod",
  "showSalary", "showMeal", "showTransport", "showFuel", "notes", "reason",
] as const
export type ProfilePayload = {
  idempotencyKey: string
  employeeId: string
  previousProfileId?: string
  validFrom: string
  validUntil?: string
  salaryAmount?: string
  mealDailyAmount?: string
  transportAmount?: string
  transportMethod?: BenefitMethod
  fuelAmount?: string
  fuelMethod?: BenefitMethod
  showSalary: boolean
  showMeal: boolean
  showTransport: boolean
  showFuel: boolean
  notes?: string
  reason: string
}

export function parseProfilePayload(body: unknown): ParseResult<ProfilePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const extra = unknownKeys(body, PROFILE_KEYS)
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.employeeId)) return { ok: false, code: "employee_not_found", field: "employeeId" }
  if (!isNil(body.previousProfileId) && !isUuid(body.previousProfileId)) return { ok: false, code: "stale_version" }
  if (!reqStr(body.reason, 3, 500)) return { ok: false, code: "reason_required", field: "reason" }
  if (!optStr(body.notes, 500)) return { ok: false, code: "invalid_notes", field: "notes" }
  for (const f of ["salaryAmount", "mealDailyAmount", "transportAmount", "fuelAmount"] as const) {
    if (!isNil(body[f]) && !isMoney(body[f])) return { ok: false, code: "invalid_amount", field: f }
  }
  for (const f of ["transportMethod", "fuelMethod"] as const) {
    if (!isNil(body[f]) && !BENEFIT_METHODS.includes(body[f] as BenefitMethod)) return { ok: false, code: "invalid_method", field: f }
  }
  if (isNil(body.transportAmount) !== isNil(body.transportMethod)) return { ok: false, code: "invalid_method", field: "transportMethod" }
  if (isNil(body.fuelAmount) !== isNil(body.fuelMethod)) return { ok: false, code: "invalid_method", field: "fuelMethod" }
  for (const f of ["showSalary", "showMeal", "showTransport", "showFuel"] as const) {
    if (!isNil(body[f]) && typeof body[f] !== "boolean") return { ok: false, code: "invalid_visibility", field: f }
  }
  const pairs = [["showSalary", "salaryAmount"], ["showMeal", "mealDailyAmount"], ["showTransport", "transportAmount"], ["showFuel", "fuelAmount"]] as const
  for (const [s, a] of pairs) if (body[s] === true && isNil(body[a])) return { ok: false, code: "visibility_without_component", field: s }
  if (!isIsoDate(body.validFrom)) return { ok: false, code: "invalid_period", field: "validFrom" }
  if (!isNil(body.validUntil) && (!isIsoDate(body.validUntil) || body.validUntil < body.validFrom)) {
    return { ok: false, code: "invalid_period", field: "validUntil" }
  }
  const v: ProfilePayload = {
    idempotencyKey: body.idempotencyKey,
    employeeId: body.employeeId,
    validFrom: body.validFrom,
    showSalary: body.showSalary === true,
    showMeal: body.showMeal === true,
    showTransport: body.showTransport === true,
    showFuel: body.showFuel === true,
    reason: (body.reason as string).trim(),
  }
  if (!isNil(body.previousProfileId)) v.previousProfileId = body.previousProfileId as string
  if (!isNil(body.validUntil)) v.validUntil = body.validUntil as string
  if (!isNil(body.salaryAmount)) v.salaryAmount = body.salaryAmount as string
  if (!isNil(body.mealDailyAmount)) v.mealDailyAmount = body.mealDailyAmount as string
  if (!isNil(body.transportAmount)) {
    v.transportAmount = body.transportAmount as string
    v.transportMethod = body.transportMethod as BenefitMethod
  }
  if (!isNil(body.fuelAmount)) {
    v.fuelAmount = body.fuelAmount as string
    v.fuelMethod = body.fuelMethod as BenefitMethod
  }
  if (typeof body.notes === "string" && body.notes.trim()) v.notes = body.notes.trim()
  return { ok: true, value: v }
}

export type ArchivePayload = { idempotencyKey: string; targetId: string; reason: string }
export function parseArchivePayload(body: unknown, idKey: "ruleId" | "profileId"): ParseResult<ArchivePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const extra = unknownKeys(body, ["idempotencyKey", idKey, "reason"])
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body[idKey])) return { ok: false, code: idKey === "ruleId" ? "rule_not_found" : "profile_not_found" }
  if (!reqStr(body.reason, 3, 500)) return { ok: false, code: "reason_required", field: "reason" }
  return { ok: true, value: { idempotencyKey: body.idempotencyKey, targetId: body[idKey] as string, reason: (body.reason as string).trim() } }
}

// ---------------------------------------------------------------------------
// Resultado das RPCs de escrita -> HTTP
// ---------------------------------------------------------------------------
export type WriteErrorCode =
  | "unauthenticated" | "forbidden" | "unavailable" | "invalid_payload" | "unknown_field" | "invalid_idempotency_key"
  | "idempotency_conflict" | "stale_version" | "overlapping_rule" | "invalid_name" | "reason_required" | "invalid_description"
  | "invalid_previous_rule" | "invalid_role" | "role_disabled" | "role_immutable" | "invalid_method" | "percentage_base_not_proven"
  | "invalid_fixed_amount" | "invalid_percentage_rate" | "invalid_method_values" | "invalid_period" | "retroactive_forbidden"
  | "rule_not_found" | "rule_in_use" | "invalid_rule" | "employee_not_found" | "employee_dismissed" | "invalid_notes"
  | "invalid_amount" | "invalid_visibility" | "visibility_without_component" | "invalid_compensation" | "profile_not_found"

export const WRITE_ERROR_MESSAGE: Record<WriteErrorCode, string> = {
  unauthenticated: "Sessão não encontrada. Faça login novamente.",
  forbidden: "Acesso não permitido para este perfil.",
  unavailable: "Serviço indisponível no momento. Tente novamente.",
  invalid_payload: "Requisição inválida.",
  unknown_field: "Campo não permitido na requisição.",
  invalid_idempotency_key: "Requisição inválida. Recarregue a página.",
  idempotency_conflict: "Esta operação já foi registrada com outros dados. Recarregue a página.",
  stale_version: "A configuração foi alterada por outra pessoa. Recarregue para ver a versão atual.",
  overlapping_rule: "Já existe um rascunho do mesmo papel e tipo com vigência sobreposta.",
  invalid_name: "Informe um nome entre 3 e 120 caracteres.",
  reason_required: "Informe o motivo da alteração (mínimo de 3 caracteres).",
  invalid_description: "Descrição com no máximo 500 caracteres.",
  invalid_previous_rule: "Versão anterior inválida.",
  invalid_role: "Selecione um papel elegível.",
  role_disabled: "Vendedor Interno está desabilitado nesta etapa.",
  role_immutable: "O papel não muda entre versões. Crie uma nova regra.",
  invalid_method: "Tipo ou forma de cálculo inválido.",
  percentage_base_not_proven: "Nenhuma base percentual foi comprovada no sistema.",
  invalid_fixed_amount: "Informe um valor fixo positivo (até 2 casas decimais).",
  invalid_percentage_rate: "Percentual inválido: maior que 0, até 100% e no máximo 4 casas decimais.",
  invalid_method_values: "Os valores informados não correspondem ao tipo selecionado.",
  invalid_period: "Vigência inválida: o final não pode ser anterior ao início.",
  retroactive_forbidden: "Vigência retroativa não é permitida. Use hoje ou uma data futura.",
  rule_not_found: "Regra não encontrada.",
  rule_in_use: "Esta regra já foi utilizada e não pode ser arquivada.",
  invalid_rule: "Regra inválida.",
  employee_not_found: "Funcionário não encontrado.",
  employee_dismissed: "Funcionário desligado não recebe nova configuração.",
  invalid_notes: "Observação com no máximo 500 caracteres.",
  invalid_amount: "Valores devem ser positivos, com até 2 casas decimais.",
  invalid_visibility: "Visibilidade inválida.",
  visibility_without_component: "Só é possível exibir ao funcionário um componente configurado.",
  invalid_compensation: "Configuração inválida.",
  profile_not_found: "Configuração não encontrada.",
}

const STATUS_BY_CODE: Partial<Record<WriteErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
  invalid_payload: 400,
  unknown_field: 400,
  invalid_idempotency_key: 400,
  idempotency_conflict: 409,
  stale_version: 409,
  overlapping_rule: 409,
  rule_not_found: 404,
  profile_not_found: 404,
  employee_not_found: 404,
}

export type WriteOutcome = { status: number; body: Record<string, unknown> }

export function writeError(code: WriteErrorCode, field?: string): WriteOutcome {
  return {
    status: STATUS_BY_CODE[code] ?? 422,
    body: { ok: false, code, message: WRITE_ERROR_MESSAGE[code], ...(field ? { field } : {}) },
  }
}

const RESULT_KEYS = ["ruleId", "familyId", "profileId", "employeeId", "version", "status", "incomplete", "activatable"] as const

/** Resposta fechada: somente ids/versão/status (nunca valores). */
export function mapWriteResult(data: unknown): WriteOutcome {
  if (!isObj(data) || typeof data.ok !== "boolean") return writeError("unavailable")
  if (data.ok === false) {
    const code = typeof data.code === "string" && data.code in WRITE_ERROR_MESSAGE ? (data.code as WriteErrorCode) : "unavailable"
    return writeError(code)
  }
  const body: Record<string, unknown> = { ok: true, idempotent: data.idempotent === true }
  for (const k of RESULT_KEYS) if (k in data) body[k] = data[k]
  return { status: data.idempotent === true ? 200 : 201, body }
}

// ---------------------------------------------------------------------------
// Leituras (normalização defensiva)
// ---------------------------------------------------------------------------
export type RuleView = {
  id: string
  familyId: string
  version: number
  previousVersionId: string | null
  name: string
  attributionRole: CommissionRole
  method: CommissionMethod
  triggerKind: CommissionTrigger
  fixedAmount: string | null
  percentageRate: string | null
  effectiveFrom: string
  effectiveUntil: string | null
  description: string | null
  status: VersionStatus
  incomplete: boolean
  reason: string | null
  createdBy: string
  createdAt: string
  archivedBy: string | null
  archivedAt: string | null
  archiveReason: string | null
}
export type RuleFamily = { familyId: string; attributionRole: CommissionRole; versions: RuleView[]; current: RuleView }
export type RulesList = { families: RuleFamily[]; activeRuleCount: number }

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function toRule(raw: unknown): RuleView | null {
  if (!isObj(raw) || !isUuid(raw.id) || !isUuid(raw.familyId)) return null
  const role = raw.attributionRole as CommissionRole
  const method = raw.method as CommissionMethod
  if (!(role in ROLE_LABEL) || !COMMISSION_METHODS.includes(method)) return null
  const status: VersionStatus =
    raw.status === "draft" || raw.status === "approved" || raw.status === "active" || raw.status === "superseded" || raw.status === "archived"
      ? raw.status
      : "archived"
  return {
    id: raw.id,
    familyId: raw.familyId,
    version: num(raw.version),
    previousVersionId: str(raw.previousVersionId),
    name: str(raw.name) ?? "Regra sem nome",
    attributionRole: role,
    method,
    triggerKind: METHOD_TRIGGER[method],
    fixedAmount: str(raw.fixedAmount),
    percentageRate: str(raw.percentageRate),
    effectiveFrom: str(raw.effectiveFrom) ?? "",
    effectiveUntil: str(raw.effectiveUntil),
    description: str(raw.description),
    status,
    incomplete: raw.incomplete === true,
    reason: str(raw.reason),
    createdBy: str(raw.createdBy) ?? "Administrador",
    createdAt: str(raw.createdAt) ?? "",
    archivedBy: str(raw.archivedBy),
    archivedAt: str(raw.archivedAt),
    archiveReason: str(raw.archiveReason),
  }
}

export function toRulesList(raw: unknown): RulesList {
  const rows = isObj(raw) && Array.isArray(raw.rules) ? raw.rules.map(toRule).filter((r): r is RuleView => r !== null) : []
  const byFamily = new Map<string, RuleView[]>()
  for (const r of rows) byFamily.set(r.familyId, [...(byFamily.get(r.familyId) ?? []), r])
  const families: RuleFamily[] = [...byFamily.entries()].map(([familyId, versions]) => {
    const sorted = [...versions].sort((a, b) => b.version - a.version)
    return { familyId, attributionRole: sorted[0].attributionRole, versions: sorted, current: sorted[0] }
  })
  families.sort((a, b) => a.attributionRole.localeCompare(b.attributionRole) || b.current.createdAt.localeCompare(a.current.createdAt))
  return { families, activeRuleCount: isObj(raw) ? num(raw.activeRuleCount) : 0 }
}

export type ComponentFlags = { salary: boolean; meal: boolean; transport: boolean; fuel: boolean }
export type EmployeeListItem = {
  employeeId: string
  name: string
  status: string
  sectors: { code: string; name: string }[]
  roles: ConfigurableRole[]
  currentProfile: { profileId: string; version: number; validFrom: string; validUntil: string | null; components: ComponentFlags; visible: ComponentFlags } | null
  versionCount: number
}
const flags = (v: unknown): ComponentFlags => {
  const o = isObj(v) ? v : {}
  return { salary: o.salary === true, meal: o.meal === true, transport: o.transport === true, fuel: o.fuel === true }
}
const sectors = (v: unknown) =>
  Array.isArray(v) ? v.filter(isObj).map((s) => ({ code: str(s.code) ?? "", name: str(s.name) ?? "" })).filter((s) => s.code) : []
const rolesOf = (s: { code: string }[]) => [...new Set(s.map((x) => SECTOR_ROLE[x.code]).filter(Boolean))] as ConfigurableRole[]

export function toEmployeeList(raw: unknown): EmployeeListItem[] {
  if (!isObj(raw) || !Array.isArray(raw.employees)) return []
  return raw.employees.filter(isObj).filter((e) => isUuid(e.employeeId)).map((e) => {
    const sec = sectors(e.sectors)
    const cp = isObj(e.currentProfile) && isUuid(e.currentProfile.profileId) ? e.currentProfile : null
    return {
      employeeId: e.employeeId as string,
      name: str(e.name) ?? "Funcionário",
      status: str(e.status) ?? "active",
      sectors: sec,
      roles: rolesOf(sec),
      currentProfile: cp
        ? { profileId: cp.profileId as string, version: num(cp.version), validFrom: str(cp.validFrom) ?? "", validUntil: str(cp.validUntil), components: flags(cp.components), visible: flags(cp.visible) }
        : null,
      versionCount: num(e.versionCount),
    }
  })
}

export type ProfileVersion = {
  profileId: string
  version: number
  status: VersionStatus
  validFrom: string
  validUntil: string | null
  salaryAmount: string | null
  mealDailyAmount: string | null
  transportAmount: string | null
  transportMethod: BenefitMethod | null
  fuelAmount: string | null
  fuelMethod: BenefitMethod | null
  showSalary: boolean
  showMeal: boolean
  showTransport: boolean
  showFuel: boolean
  notes: string | null
  reason: string | null
  createdBy: string
  createdAt: string
  archivedBy: string | null
  archivedAt: string | null
  archiveReason: string | null
}
export type EmployeeDetail = {
  employee: { employeeId: string; name: string; status: string; sectors: { code: string; name: string }[]; roles: ConfigurableRole[] }
  versions: ProfileVersion[]
  current: ProfileVersion | null
}
const bm = (v: unknown): BenefitMethod | null => (BENEFIT_METHODS.includes(v as BenefitMethod) ? (v as BenefitMethod) : null)

export function toEmployeeDetail(raw: unknown): EmployeeDetail | null {
  if (!isObj(raw) || !isObj(raw.employee) || !isUuid(raw.employee.employeeId)) return null
  const sec = sectors(raw.employee.sectors)
  const versions: ProfileVersion[] = (Array.isArray(raw.versions) ? raw.versions : []).filter(isObj).filter((v) => isUuid(v.profileId)).map((v) => ({
    profileId: v.profileId as string,
    version: num(v.version),
    status: ((): VersionStatus => (v.status === "draft" || v.status === "approved" || v.status === "superseded" || v.status === "archived" ? v.status : "archived"))(),
    validFrom: str(v.validFrom) ?? "",
    validUntil: str(v.validUntil),
    salaryAmount: str(v.salaryAmount),
    mealDailyAmount: str(v.mealDailyAmount),
    transportAmount: str(v.transportAmount),
    transportMethod: bm(v.transportMethod),
    fuelAmount: str(v.fuelAmount),
    fuelMethod: bm(v.fuelMethod),
    showSalary: v.showSalary === true,
    showMeal: v.showMeal === true,
    showTransport: v.showTransport === true,
    showFuel: v.showFuel === true,
    notes: str(v.notes),
    reason: str(v.reason),
    createdBy: str(v.createdBy) ?? "Administrador",
    createdAt: str(v.createdAt) ?? "",
    archivedBy: str(v.archivedBy),
    archivedAt: str(v.archivedAt),
    archiveReason: str(v.archiveReason),
  })).sort((a, b) => b.version - a.version)
  return {
    employee: { employeeId: raw.employee.employeeId as string, name: str(raw.employee.name) ?? "Funcionário", status: str(raw.employee.status) ?? "active", sectors: sec, roles: rolesOf(sec) },
    versions,
    current: versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "approved") ?? null,
  }
}

/** Diferenças entre duas versões (comparação de histórico). */
export function diffVersions<T extends Record<string, unknown>>(a: T, b: T, keys: readonly (keyof T)[]): (keyof T)[] {
  return keys.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
}

// ---------------------------------------------------------------------------
// Prévia do funcionário
// ---------------------------------------------------------------------------
export type EmployeePreview = {
  employeeStatus: string
  readOnly: boolean
  competenceMonth: string
  configured: boolean
  components: {
    salary?: { amount: string }
    meal?: { dailyAmount: string }
    transport?: { amount: string; method: BenefitMethod }
    fuel?: { amount: string; method: BenefitMethod }
  }
  commission: { status: "not_calculated" } | null
  estimatedTotal: string | null
  perDayComponentsExcluded: boolean
}

export function toEmployeePreview(raw: unknown): EmployeePreview | null {
  if (!isObj(raw) || typeof raw.competenceMonth !== "string") return null
  const c = isObj(raw.components) ? raw.components : {}
  const components: EmployeePreview["components"] = {}
  // Componente ausente => omitido (nunca zero).
  if (isObj(c.salary) && isMoney(c.salary.amount)) components.salary = { amount: c.salary.amount }
  if (isObj(c.meal) && isMoney(c.meal.dailyAmount)) components.meal = { dailyAmount: c.meal.dailyAmount }
  if (isObj(c.transport) && isMoney(c.transport.amount) && bm(c.transport.method)) components.transport = { amount: c.transport.amount, method: bm(c.transport.method)! }
  if (isObj(c.fuel) && isMoney(c.fuel.amount) && bm(c.fuel.method)) components.fuel = { amount: c.fuel.amount, method: bm(c.fuel.method)! }
  return {
    employeeStatus: str(raw.employeeStatus) ?? "active",
    readOnly: raw.readOnly === true,
    competenceMonth: raw.competenceMonth,
    configured: raw.configured === true,
    components,
    commission: isObj(raw.commission) && raw.commission.status === "not_calculated" ? { status: "not_calculated" } : null,
    estimatedTotal: isMoney(raw.estimatedTotal) ? raw.estimatedTotal : null,
    perDayComponentsExcluded: raw.perDayComponentsExcluded === true,
  }
}
