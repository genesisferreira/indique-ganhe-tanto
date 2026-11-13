/**
 * 3.1F-J5 — contrato PURO da aprovação, dias trabalhados e competência.
 * Escritas só via RPC; respostas sem valores na borda de erro. Comissão sempre zero nesta entrega.
 */

export const IDEM = /^[A-Za-z0-9_-]{16,128}$/
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const MONEY = /^-?\d{1,8}\.\d{2}$/

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v)
export const isIdempotencyKey = (v: unknown): v is string => typeof v === "string" && IDEM.test(v)
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
export function isMonthStart(v: unknown): v is string {
  return isIsoDate(v) && v.slice(8, 10) === "01"
}
export const isSignedMoney = (v: unknown): v is string => typeof v === "string" && MONEY.test(v) && v !== "0.00" && v !== "-0.00"

export function newIdempotencyKey(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return `j5_${random().replace(/-/g, "")}`
}

export function todaySaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function periodEnd(monthStartIso: string): string {
  const [y, m] = monthStartIso.split("-").map(Number)
  const end = new Date(Date.UTC(y, m, 0))
  return end.toISOString().slice(0, 10)
}

export const MANUAL_LINE_TYPES = ["other_earning", "discount", "adjustment"] as const
export type ManualLineType = (typeof MANUAL_LINE_TYPES)[number]
export const MANUAL_LINE_LABEL: Record<ManualLineType, string> = {
  other_earning: "Outro ganho",
  discount: "Desconto",
  adjustment: "Ajuste",
}

export const COMPETENCE_STATUS_LABEL: Record<string, string> = {
  draft: "Em preparação",
  calculated: "Calculada",
  reviewed: "Revisada",
  under_review: "Em revisão",
  closed: "Fechada",
  paid: "Pagamento registrado",
  reopened: "Reaberta",
}

export type WriteErrorCode =
  | "unauthenticated" | "forbidden" | "unavailable" | "invalid_payload" | "unknown_field" | "invalid_idempotency_key"
  | "idempotency_conflict" | "stale_version" | "reason_required" | "override_reason_required" | "segregation_required"
  | "profile_not_found" | "employee_not_found" | "competence_not_found" | "approved_profile_required" | "competence_exists"
  | "competence_locked" | "invalid_status" | "invalid_period" | "future_date" | "date_outside_competence" | "before_hire"
  | "after_dismissal" | "invalid_amount" | "invalid_line_type" | "active_commission_forbidden" | "totals_inconsistent"
  | "profile_overlap" | "orphan_line"

export const WRITE_ERROR_MESSAGE: Record<WriteErrorCode, string> = {
  unauthenticated: "Sessão não encontrada. Faça login novamente.",
  forbidden: "Acesso não permitido para este perfil.",
  unavailable: "Serviço indisponível no momento. Tente novamente.",
  invalid_payload: "Requisição inválida.",
  unknown_field: "Campo não permitido na requisição.",
  invalid_idempotency_key: "Requisição inválida. Recarregue a página.",
  idempotency_conflict: "Esta operação já foi registrada com outros dados. Recarregue a página.",
  stale_version: "A configuração foi alterada. Recarregue para ver a versão atual.",
  reason_required: "Informe o motivo (mínimo de 20 caracteres).",
  override_reason_required: "Override do Master exige motivo com pelo menos 20 caracteres.",
  segregation_required: "Quem criou o rascunho não pode aprová-lo. Peça a outro administrador ou use override do Master.",
  profile_not_found: "Configuração não encontrada.",
  employee_not_found: "Funcionário não encontrado.",
  competence_not_found: "Competência não encontrada.",
  approved_profile_required: "É necessário um perfil de remuneração aprovado cobrindo o mês.",
  competence_exists: "Já existe uma competência vigente para este funcionário e mês.",
  competence_locked: "Competência em revisão ou fechada: esta alteração não é permitida.",
  invalid_status: "A competência não está no estado necessário para esta operação.",
  invalid_period: "Competência inválida.",
  future_date: "Não é permitido registrar data futura.",
  date_outside_competence: "A data está fora da competência.",
  before_hire: "Data anterior ao vínculo do funcionário.",
  after_dismissal: "Data posterior ao desligamento.",
  invalid_amount: "Informe um valor diferente de zero, com 2 casas decimais.",
  invalid_line_type: "Tipo de lançamento inválido.",
  active_commission_forbidden: "Há regra ou comissão financeira ativa. Esta etapa não calcula comissão.",
  totals_inconsistent: "Totais inconsistentes. Recalcule antes de fechar.",
  profile_overlap: "Há sobreposição de perfil aprovado.",
  orphan_line: "Existem linhas órfãs. Não é possível fechar.",
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
  competence_exists: 409,
  competence_locked: 409,
  profile_not_found: 404,
  employee_not_found: 404,
  competence_not_found: 404,
}

export type WriteOutcome = { status: number; body: Record<string, unknown> }
export function writeError(code: WriteErrorCode, field?: string): WriteOutcome {
  return { status: STATUS_BY_CODE[code] ?? 422, body: { ok: false, code, message: WRITE_ERROR_MESSAGE[code], ...(field ? { field } : {}) } }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return k
  return null
}
const nil = (v: unknown) => v === undefined || v === null
export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: WriteErrorCode; field?: string }

export type ApprovePayload = { idempotencyKey: string; profileId: string; overrideReason?: string }
export function parseApprovePayload(body: unknown): ParseResult<ApprovePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const extra = unknownKeys(body, ["idempotencyKey", "profileId", "overrideReason"])
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.profileId)) return { ok: false, code: "profile_not_found" }
  const v: ApprovePayload = { idempotencyKey: body.idempotencyKey, profileId: body.profileId }
  if (!nil(body.overrideReason)) {
    if (typeof body.overrideReason !== "string" || body.overrideReason.trim().length > 500) return { ok: false, code: "invalid_payload", field: "overrideReason" }
    if (body.overrideReason.trim()) v.overrideReason = body.overrideReason.trim()
  }
  return { ok: true, value: v }
}

export type WorkedDayInput = { date: string; present: boolean; absenceReason?: string }
export type WorkedDaysPayload = { idempotencyKey: string; employeeId: string; competenceMonth: string; days: WorkedDayInput[] }
export function parseWorkedDaysPayload(body: unknown): ParseResult<WorkedDaysPayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const extra = unknownKeys(body, ["idempotencyKey", "employeeId", "competenceMonth", "days"])
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.employeeId)) return { ok: false, code: "employee_not_found" }
  if (!isMonthStart(body.competenceMonth)) return { ok: false, code: "invalid_period" }
  if (!Array.isArray(body.days) || body.days.length > 31) return { ok: false, code: "invalid_payload", field: "days" }
  const days: WorkedDayInput[] = []
  for (const d of body.days) {
    if (!isObj(d)) return { ok: false, code: "invalid_payload", field: "days" }
    const e = unknownKeys(d, ["date", "present", "absenceReason"])
    if (e) return { ok: false, code: "unknown_field", field: e }
    if (!isIsoDate(d.date) || typeof d.present !== "boolean") return { ok: false, code: "invalid_payload", field: "days" }
    const item: WorkedDayInput = { date: d.date, present: d.present }
    if (!nil(d.absenceReason)) {
      if (typeof d.absenceReason !== "string" || d.absenceReason.trim().length > 200) return { ok: false, code: "invalid_payload", field: "absenceReason" }
      if (d.absenceReason.trim()) item.absenceReason = d.absenceReason.trim()
    }
    days.push(item)
  }
  return { ok: true, value: { idempotencyKey: body.idempotencyKey, employeeId: body.employeeId, competenceMonth: body.competenceMonth, days } }
}

export type CompetenceIdPayload = { idempotencyKey: string; competenceId: string; reason?: string }
export function parseCompetenceAction(body: unknown, withReason: boolean): ParseResult<CompetenceIdPayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const allowed = withReason ? ["idempotencyKey", "competenceId", "reason"] : ["idempotencyKey", "competenceId"]
  const extra = unknownKeys(body, allowed)
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.competenceId)) return { ok: false, code: "competence_not_found" }
  const v: CompetenceIdPayload = { idempotencyKey: body.idempotencyKey, competenceId: body.competenceId }
  if (withReason) {
    if (typeof body.reason !== "string" || body.reason.trim().length < 20 || body.reason.trim().length > 500) {
      return { ok: false, code: "reason_required", field: "reason" }
    }
    v.reason = body.reason.trim()
  }
  return { ok: true, value: v }
}

export type OpenPayload = { idempotencyKey: string; employeeId: string; competenceMonth: string }
export function parseOpenPayload(body: unknown): ParseResult<OpenPayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const extra = unknownKeys(body, ["idempotencyKey", "employeeId", "competenceMonth"])
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.employeeId)) return { ok: false, code: "employee_not_found" }
  if (!isMonthStart(body.competenceMonth)) return { ok: false, code: "invalid_period" }
  return { ok: true, value: { idempotencyKey: body.idempotencyKey, employeeId: body.employeeId, competenceMonth: body.competenceMonth } }
}

export type ManualPayload = { idempotencyKey: string; competenceId: string; lineType: ManualLineType; amount: string; reason: string; visibleToEmployee: boolean }
export function parseManualPayload(body: unknown): ParseResult<ManualPayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const extra = unknownKeys(body, ["idempotencyKey", "competenceId", "lineType", "amount", "reason", "visibleToEmployee"])
  if (extra) return { ok: false, code: "unknown_field", field: extra }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.competenceId)) return { ok: false, code: "competence_not_found" }
  if (!MANUAL_LINE_TYPES.includes(body.lineType as ManualLineType)) return { ok: false, code: "invalid_line_type" }
  if (!isSignedMoney(body.amount)) return { ok: false, code: "invalid_amount", field: "amount" }
  if (typeof body.reason !== "string" || body.reason.trim().length < 20 || body.reason.trim().length > 500) {
    return { ok: false, code: "reason_required", field: "reason" }
  }
  if (typeof body.visibleToEmployee !== "boolean") return { ok: false, code: "invalid_payload", field: "visibleToEmployee" }
  return {
    ok: true,
    value: {
      idempotencyKey: body.idempotencyKey,
      competenceId: body.competenceId,
      lineType: body.lineType as ManualLineType,
      amount: body.amount,
      reason: body.reason.trim(),
      visibleToEmployee: body.visibleToEmployee,
    },
  }
}

const RESULT_KEYS = ["profileId", "employeeId", "competenceId", "lineId", "version", "status", "saved", "competenceMonth"] as const
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

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

export type WorkedDaysView = {
  employee: { employeeId: string; name: string; status: string; hiredOn: string | null; dismissedOn: string | null }
  competenceMonth: string
  periodStart: string
  periodEnd: string
  today: string
  competenceStatus: string | null
  locked: boolean
  days: { date: string; status: string; present: boolean; mealEligible: boolean; absenceReason: string | null }[]
  workedCount: number
}

export function toWorkedDaysView(raw: unknown): WorkedDaysView | null {
  if (!isObj(raw) || !isObj(raw.employee) || !isUuid(raw.employee.employeeId)) return null
  return {
    employee: {
      employeeId: raw.employee.employeeId as string,
      name: str(raw.employee.name) ?? "Funcionário",
      status: str(raw.employee.status) ?? "active",
      hiredOn: str(raw.employee.hiredOn),
      dismissedOn: str(raw.employee.dismissedOn),
    },
    competenceMonth: str(raw.competenceMonth) ?? "",
    periodStart: str(raw.periodStart) ?? "",
    periodEnd: str(raw.periodEnd) ?? "",
    today: str(raw.today) ?? "",
    competenceStatus: str(raw.competenceStatus),
    locked: raw.locked === true,
    days: Array.isArray(raw.days)
      ? raw.days.filter(isObj).map((d) => ({
          date: str(d.date) ?? "",
          status: str(d.status) ?? "absent",
          present: d.present === true,
          mealEligible: d.mealEligible === true,
          absenceReason: str(d.absenceReason),
        }))
      : [],
    workedCount: num(raw.workedCount),
  }
}

export type CompetenceListItem = {
  competenceId: string
  employeeId: string
  employeeName: string
  competenceMonth: string
  status: string
  version: number
  grossTotal: string
  discountTotal: string
  netTotal: string
  commissionTotal: string
}
export type CompetenceList = { items: CompetenceListItem[]; activeCommissionRuleCount: number; entitlementCount: number; paidCount: number }

export function toCompetenceList(raw: unknown): CompetenceList {
  const r = isObj(raw) ? raw : {}
  const items = Array.isArray(r.competences)
    ? r.competences.filter(isObj).filter((c) => isUuid(c.competenceId)).map((c) => ({
        competenceId: c.competenceId as string,
        employeeId: str(c.employeeId) ?? "",
        employeeName: str(c.employeeName) ?? "Funcionário",
        competenceMonth: str(c.competenceMonth) ?? "",
        status: str(c.status) ?? "draft",
        version: num(c.version),
        grossTotal: str(c.grossTotal) ?? "0.00",
        discountTotal: str(c.discountTotal) ?? "0.00",
        netTotal: str(c.netTotal) ?? "0.00",
        commissionTotal: str(c.commissionTotal) ?? "0.00",
      }))
    : []
  return { items, activeCommissionRuleCount: num(r.activeCommissionRuleCount), entitlementCount: num(r.entitlementCount), paidCount: num(r.paidCount) }
}

export type CompetenceDetail = {
  competenceId: string
  employeeId: string
  employeeName: string
  competenceMonth: string
  periodStart: string
  periodEnd: string
  status: string
  version: number
  profileId: string | null
  totals: Record<string, string>
  lines: { lineId: string; type: string; description: string; quantity: string; unitAmount: string | null; amount: string; origin: string | null; visibleToEmployee: boolean; reason: string | null; createdAt: string }[]
}

export function toCompetenceDetail(raw: unknown): CompetenceDetail | null {
  if (!isObj(raw) || !isObj(raw.competence) || !isUuid(raw.competence.competenceId)) return null
  const c = raw.competence
  const totals = isObj(c.totals) ? Object.fromEntries(Object.entries(c.totals).map(([k, v]) => [k, str(v) ?? "0.00"])) : {}
  return {
    competenceId: c.competenceId as string,
    employeeId: str(c.employeeId) ?? "",
    employeeName: str(c.employeeName) ?? "Funcionário",
    competenceMonth: str(c.competenceMonth) ?? "",
    periodStart: str(c.periodStart) ?? "",
    periodEnd: str(c.periodEnd) ?? "",
    status: str(c.status) ?? "draft",
    version: num(c.version),
    profileId: isUuid(c.profileId) ? (c.profileId as string) : null,
    totals,
    lines: Array.isArray(raw.lines)
      ? raw.lines.filter(isObj).map((l) => ({
          lineId: str(l.lineId) ?? "",
          type: str(l.type) ?? "",
          description: str(l.description) ?? "",
          quantity: str(l.quantity) ?? "1",
          unitAmount: str(l.unitAmount),
          amount: str(l.amount) ?? "0.00",
          origin: str(l.origin),
          visibleToEmployee: l.visibleToEmployee === true,
          reason: str(l.reason),
          createdAt: str(l.createdAt) ?? "",
        }))
      : [],
  }
}

export type ReadKind = "unauthenticated" | "forbidden" | "not_found" | "unavailable"
export type ReadResult<T> = { ok: true; data: T } | { ok: false; kind: ReadKind }
