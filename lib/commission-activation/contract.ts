import { isIdempotencyKey, isUuid, type CommissionMethod, type WriteErrorCode as CfgErr } from "@/lib/compensation-config/contract"
import { isMethodActivatable, methodBlockReason } from "@/lib/commission-activation/evidence"

export const PAYMENT_METHODS = ["bank_transfer", "cash", "payroll_batch", "other"] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: "Transferência bancária",
  cash: "Dinheiro",
  payroll_batch: "Folha / lote",
  other: "Outro",
}

export type J6WriteErrorCode =
  | CfgErr
  | "method_not_activatable"
  | "first_invoice_order_unproven"
  | "full_payment_unproven"
  | "segregation_required"
  | "override_reason_required"
  | "already_active"
  | "invalid_status"
  | "entitlement_not_found"
  | "entitlement_not_accrued"
  | "competence_not_found"
  | "competence_locked"
  | "already_paid"
  | "payment_already_registered"
  | "confirmation_required"
  | "reconcile_in_progress"
  | "invalid_payment_method"
  | "not_reversed"
  | "active_commission_forbidden"
  | "future_date"
  | "totals_inconsistent"

export const J6_WRITE_ERROR_MESSAGE: Record<J6WriteErrorCode, string> = {
  unauthenticated: "Sessão não encontrada. Faça login novamente.",
  forbidden: "Acesso não permitido para este perfil.",
  unavailable: "Serviço indisponível no momento. Tente novamente.",
  invalid_payload: "Requisição inválida.",
  unknown_field: "Campo não permitido na requisição.",
  invalid_idempotency_key: "Requisição inválida. Recarregue a página.",
  idempotency_conflict: "Esta operação já foi registrada com outros dados. Recarregue a página.",
  stale_version: "A configuração foi alterada. Recarregue para ver a versão atual.",
  overlapping_rule: "Já existe um rascunho do mesmo papel e tipo com vigência sobreposta.",
  invalid_name: "Informe um nome entre 3 e 120 caracteres.",
  reason_required: "Informe o motivo (mínimo de 20 caracteres).",
  invalid_description: "Descrição com no máximo 500 caracteres.",
  invalid_previous_rule: "Versão anterior inválida.",
  invalid_role: "Selecione um papel elegível.",
  role_disabled: "Vendedor Interno está desabilitado nesta etapa.",
  role_immutable: "O papel não muda entre versões. Crie uma nova regra.",
  invalid_method: "Tipo ou forma de cálculo inválido.",
  percentage_base_not_proven: "Nenhuma base percentual foi comprovada no sistema.",
  invalid_fixed_amount: "Informe um valor fixo positivo (até 2 casas decimais).",
  invalid_percentage_rate: "Percentual inválido.",
  invalid_method_values: "Os valores informados não correspondem ao tipo selecionado.",
  invalid_period: "Vigência inválida.",
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
  method_not_activatable: "Esta modalidade permanece bloqueada: a prova financeira necessária não foi comprovada.",
  first_invoice_order_unproven: "A ordem estável da primeira fatura não foi comprovada.",
  full_payment_unproven: "O pagamento integral da primeira fatura não foi comprovado para comissão.",
  segregation_required: "Quem criou o rascunho não pode aprová-lo. Peça a outro administrador ou use override do Master.",
  override_reason_required: "Override do Master exige motivo com pelo menos 20 caracteres.",
  already_active: "Esta versão já está ativa.",
  invalid_status: "A regra ou competência não está no estado necessário.",
  entitlement_not_found: "Direito de comissão não encontrado.",
  entitlement_not_accrued: "Só é possível aprovar um direito já apurado.",
  competence_not_found: "Competência não encontrada.",
  competence_locked: "Competência fechada ou paga: esta alteração não é permitida.",
  already_paid: "Pagamento já registrado para esta competência.",
  payment_already_registered: "Pagamento já registrado. Correção somente por estorno auditado.",
  confirmation_required: "Confirme explicitamente o registro do pagamento.",
  reconcile_in_progress: "Já existe uma reconciliação em andamento.",
  invalid_payment_method: "Método de pagamento inválido.",
  not_reversed: "Somente competência com pagamento registrado pode ser estornada.",
  active_commission_forbidden: "Operação incompatível com o estado financeiro atual.",
  future_date: "Não é permitido registrar data futura.",
  totals_inconsistent: "Totais inconsistentes. Recalcule antes de fechar.",
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
function extra(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return k
  return null
}
const nil = (v: unknown) => v === undefined || v === null
export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: J6WriteErrorCode; field?: string }

export type RuleApprovePayload = { idempotencyKey: string; ruleId: string; overrideReason?: string }
export function parseRuleApprovePayload(body: unknown): ParseResult<RuleApprovePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const e = extra(body, ["idempotencyKey", "ruleId", "overrideReason"])
  if (e) return { ok: false, code: "unknown_field", field: e }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.ruleId)) return { ok: false, code: "rule_not_found" }
  const v: RuleApprovePayload = { idempotencyKey: body.idempotencyKey, ruleId: body.ruleId }
  if (!nil(body.overrideReason)) {
    if (typeof body.overrideReason !== "string" || body.overrideReason.trim().length > 500) return { ok: false, code: "invalid_payload", field: "overrideReason" }
    if (body.overrideReason.trim()) v.overrideReason = body.overrideReason.trim()
  }
  return { ok: true, value: v }
}

export type RuleActivatePayload = { idempotencyKey: string; ruleId: string; reason: string }
export function parseRuleActivatePayload(body: unknown): ParseResult<RuleActivatePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const e = extra(body, ["idempotencyKey", "ruleId", "reason"])
  if (e) return { ok: false, code: "unknown_field", field: e }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.ruleId)) return { ok: false, code: "rule_not_found" }
  if (typeof body.reason !== "string" || body.reason.trim().length < 20 || body.reason.trim().length > 500) {
    return { ok: false, code: "reason_required", field: "reason" }
  }
  return { ok: true, value: { idempotencyKey: body.idempotencyKey, ruleId: body.ruleId, reason: body.reason.trim() } }
}

export type EntitlementActionPayload = { idempotencyKey: string; entitlementId: string; reason: string; visibleToEmployee?: boolean }
export function parseEntitlementAction(body: unknown, withVisible: boolean): ParseResult<EntitlementActionPayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const allowed = withVisible
    ? ["idempotencyKey", "entitlementId", "reason", "visibleToEmployee"]
    : ["idempotencyKey", "entitlementId", "reason"]
  const e = extra(body, allowed)
  if (e) return { ok: false, code: "unknown_field", field: e }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.entitlementId)) return { ok: false, code: "entitlement_not_found" }
  if (typeof body.reason !== "string" || body.reason.trim().length < 20 || body.reason.trim().length > 500) {
    return { ok: false, code: "reason_required", field: "reason" }
  }
  const v: EntitlementActionPayload = { idempotencyKey: body.idempotencyKey, entitlementId: body.entitlementId, reason: body.reason.trim() }
  if (withVisible) {
    if (typeof body.visibleToEmployee !== "boolean") return { ok: false, code: "invalid_payload", field: "visibleToEmployee" }
    v.visibleToEmployee = body.visibleToEmployee
  }
  return { ok: true, value: v }
}

export type ReconcilePayload = { idempotencyKey: string; limit?: number; runId?: string }
export function parseReconcilePayload(body: unknown): ParseResult<ReconcilePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const e = extra(body, ["idempotencyKey", "limit", "runId"])
  if (e) return { ok: false, code: "unknown_field", field: e }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  const v: ReconcilePayload = { idempotencyKey: body.idempotencyKey }
  if (!nil(body.limit)) {
    if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 200) {
      return { ok: false, code: "invalid_payload", field: "limit" }
    }
    v.limit = body.limit
  }
  if (!nil(body.runId)) {
    if (!isUuid(body.runId)) return { ok: false, code: "invalid_payload", field: "runId" }
    v.runId = body.runId
  }
  return { ok: true, value: v }
}

export type PayPayload = {
  idempotencyKey: string
  competenceId: string
  paidOn: string
  method: PaymentMethod
  reference?: string
  note?: string
  reason: string
  confirmed: true
}
export function parsePayPayload(body: unknown): ParseResult<PayPayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const e = extra(body, ["idempotencyKey", "competenceId", "paidOn", "method", "reference", "note", "reason", "confirmed"])
  if (e) return { ok: false, code: "unknown_field", field: e }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.competenceId)) return { ok: false, code: "competence_not_found" }
  if (typeof body.paidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.paidOn)) return { ok: false, code: "invalid_payload", field: "paidOn" }
  if (!PAYMENT_METHODS.includes(body.method as PaymentMethod)) return { ok: false, code: "invalid_payment_method", field: "method" }
  if (typeof body.reason !== "string" || body.reason.trim().length < 20 || body.reason.trim().length > 500) {
    return { ok: false, code: "reason_required", field: "reason" }
  }
  if (body.confirmed !== true) return { ok: false, code: "confirmation_required", field: "confirmed" }
  if (!nil(body.reference) && (typeof body.reference !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(body.reference))) {
    return { ok: false, code: "invalid_payload", field: "reference" }
  }
  if (!nil(body.note) && (typeof body.note !== "string" || body.note.trim().length > 500)) {
    return { ok: false, code: "invalid_notes", field: "note" }
  }
  const v: PayPayload = {
    idempotencyKey: body.idempotencyKey,
    competenceId: body.competenceId,
    paidOn: body.paidOn,
    method: body.method as PaymentMethod,
    reason: body.reason.trim(),
    confirmed: true,
  }
  if (typeof body.reference === "string" && body.reference) v.reference = body.reference
  if (typeof body.note === "string" && body.note.trim()) v.note = body.note.trim()
  return { ok: true, value: v }
}

export type ReversePayload = { idempotencyKey: string; competenceId: string; reason: string }
export function parseReversePayload(body: unknown): ParseResult<ReversePayload> {
  if (!isObj(body)) return { ok: false, code: "invalid_payload" }
  const e = extra(body, ["idempotencyKey", "competenceId", "reason"])
  if (e) return { ok: false, code: "unknown_field", field: e }
  if (!isIdempotencyKey(body.idempotencyKey)) return { ok: false, code: "invalid_idempotency_key" }
  if (!isUuid(body.competenceId)) return { ok: false, code: "competence_not_found" }
  if (typeof body.reason !== "string" || body.reason.trim().length < 20 || body.reason.trim().length > 500) {
    return { ok: false, code: "reason_required", field: "reason" }
  }
  return { ok: true, value: { idempotencyKey: body.idempotencyKey, competenceId: body.competenceId, reason: body.reason.trim() } }
}

export function activateDisabledReason(method: CommissionMethod): string {
  if (!isMethodActivatable(method)) return methodBlockReason(method)
  return "Pronto para ativação com vigência atual ou futura."
}

export type WriteOutcome = { status: number; body: Record<string, unknown> }
const HTTP: Partial<Record<J6WriteErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
  invalid_payload: 400,
  unknown_field: 400,
  invalid_idempotency_key: 400,
  idempotency_conflict: 409,
  stale_version: 409,
  already_active: 409,
  already_paid: 409,
  payment_already_registered: 409,
  reconcile_in_progress: 409,
  rule_not_found: 404,
  entitlement_not_found: 404,
  competence_not_found: 404,
}
export function writeError(code: J6WriteErrorCode, field?: string): WriteOutcome {
  return { status: HTTP[code] ?? 422, body: { ok: false, code, message: J6_WRITE_ERROR_MESSAGE[code], ...(field ? { field } : {}) } }
}

const RESULT = [
  "ruleId", "entitlementId", "competenceId", "runId", "status", "version",
  "scanned", "accrued", "skippedUnproven", "skippedNoRule", "skippedExisting", "erpRequests", "done",
] as const
export function mapWriteResult(data: unknown): WriteOutcome {
  if (!isObj(data) || typeof data.ok !== "boolean") return writeError("unavailable")
  if (data.ok === false) {
    const code = typeof data.code === "string" && data.code in J6_WRITE_ERROR_MESSAGE ? (data.code as J6WriteErrorCode) : "unavailable"
    return writeError(code)
  }
  const body: Record<string, unknown> = { ok: true, idempotent: data.idempotent === true }
  for (const k of RESULT) if (k in data) body[k] = data[k]
  return { status: data.idempotent === true ? 200 : 201, body }
}
