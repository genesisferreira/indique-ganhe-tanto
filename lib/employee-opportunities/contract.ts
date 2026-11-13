/**
 * 3.1F-J3 — contrato FECHADO do cadastro de oportunidade pelo funcionário.
 * Puro (sem I/O): validação/normalização do payload (cliente e servidor usam a mesma regra)
 * e mapeamento do resultado da RPC submit_employee_sales_opportunity para HTTP.
 *
 * Nunca aceita employee_id/profile_id/setor/comissão/recompensa do cliente: a identidade é
 * auth.uid() na RPC e o papel é derivado SOMENTE dos vínculos reais de setor.
 */

export const OPPORTUNITY_ATTRIBUTION_ROLES = ["technician_originator", "external_sales_originator"] as const
export type OpportunityAttributionRole = (typeof OPPORTUNITY_ATTRIBUTION_ROLES)[number]

export const OPPORTUNITY_ROLE_LABEL: Record<OpportunityAttributionRole, string> = {
  technician_originator: "Técnico",
  external_sales_originator: "Vendedor externo",
}

export const OPPORTUNITY_PAYLOAD_KEYS = [
  "idempotencyKey", "attributionRole", "planId", "name", "phone", "document", "zipcode", "street",
  "number", "complement", "neighborhood", "city", "observation", "consent", "confirmRecentDuplicate",
] as const
export type OpportunityPayloadKey = (typeof OPPORTUNITY_PAYLOAD_KEYS)[number]

export type OpportunityPayload = {
  idempotencyKey: string
  attributionRole: OpportunityAttributionRole | null
  planId: string
  name: string
  phone: string
  document: string | null
  zipcode: string
  street: string
  number: string
  complement: string | null
  neighborhood: string
  city: string
  observation: string | null
  consent: true
  confirmRecentDuplicate: boolean
}

export type OpportunityField = Exclude<OpportunityPayloadKey, "confirmRecentDuplicate">

export const FIELD_MESSAGE: Record<OpportunityField, string> = {
  idempotencyKey: "Envio inválido. Recarregue a página e tente novamente.",
  attributionRole: "Selecione como você está registrando esta oportunidade.",
  planId: "Selecione o plano de interesse.",
  name: "Informe o nome completo (mínimo 3 caracteres).",
  phone: "Informe um telefone/WhatsApp válido com DDD.",
  document: "CPF ou CNPJ inválido.",
  zipcode: "Informe um CEP válido (8 dígitos).",
  street: "Informe o endereço.",
  number: "Informe o número.",
  complement: "Complemento muito longo.",
  neighborhood: "Informe o bairro.",
  city: "Informe a cidade.",
  observation: "Observação muito longa (máximo 500 caracteres).",
  consent: "Confirme o consentimento do cliente para ser contatado.",
}

const IDEM_RE = /^[A-Za-z0-9_-]{16,128}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const onlyDigits = (v: string) => v.replace(/\D/g, "")
const squash = (v: string) => v.replace(/\s+/g, " ").trim()

/** Mesmo algoritmo de lib/referral-field-normalize.ts e de employee_opportunity_normalize_phone(). */
export function normalizeOpportunityPhone(raw: string): string | null {
  let d = onlyDigits(raw)
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2)
  if (d.length > 11) d = d.slice(-11)
  return d.length === 10 || d.length === 11 ? d : null
}

export function isValidCpfDigits(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const calc = (len: number) => {
    let s = 0
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

export function isValidCnpjDigits(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let s = 0
    for (let i = 0; i < len; i++) s += Number(d[i]) * w[i]
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

export type ParsedPayload =
  | { ok: true; value: OpportunityPayload }
  | { ok: false; code: "unknown_field" | "invalid_payload"; field?: OpportunityField; message: string }

function text(v: unknown, field: OpportunityField, min: number, max: number, required: boolean): string | null | { error: OpportunityField } {
  if (v === undefined || v === null || (typeof v === "string" && squash(v) === "")) return required ? { error: field } : null
  if (typeof v !== "string") return { error: field }
  const s = squash(v)
  return s.length < min || s.length > max ? { error: field } : s
}

const isErr = (v: unknown): v is { error: OpportunityField } => typeof v === "object" && v !== null && "error" in v

/** Validação estrita (servidor) — o banco revalida tudo (defesa em profundidade). */
export function parseOpportunityPayload(body: unknown): ParsedPayload {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "invalid_payload", message: "Dados inválidos." }
  }
  const src = body as Record<string, unknown>
  for (const k of Object.keys(src)) {
    if (!(OPPORTUNITY_PAYLOAD_KEYS as readonly string[]).includes(k)) {
      return { ok: false, code: "unknown_field", message: "Campo não permitido." }
    }
  }
  const fail = (field: OpportunityField): ParsedPayload => ({ ok: false, code: "invalid_payload", field, message: FIELD_MESSAGE[field] })
  if (typeof src.idempotencyKey !== "string" || !IDEM_RE.test(src.idempotencyKey)) return fail("idempotencyKey")
  const name = text(src.name, "name", 3, 120, true)
  if (isErr(name) || name === null) return fail("name")
  if (typeof src.phone !== "string") return fail("phone")
  const phone = normalizeOpportunityPhone(src.phone)
  if (!phone) return fail("phone")
  let document: string | null = null
  if (src.document !== undefined && src.document !== null && src.document !== "") {
    if (typeof src.document !== "string") return fail("document")
    const d = onlyDigits(src.document)
    if (!(isValidCpfDigits(d) || isValidCnpjDigits(d))) return fail("document")
    document = d
  }
  let role: OpportunityAttributionRole | null = null
  if (src.attributionRole !== undefined && src.attributionRole !== null && src.attributionRole !== "") {
    if (typeof src.attributionRole !== "string" || !(OPPORTUNITY_ATTRIBUTION_ROLES as readonly string[]).includes(src.attributionRole)) return fail("attributionRole")
    role = src.attributionRole as OpportunityAttributionRole
  }
  if (typeof src.planId !== "string" || !UUID_RE.test(src.planId)) return fail("planId")
  if (typeof src.zipcode !== "string" || onlyDigits(src.zipcode).length !== 8 || /[^\d.\-\s]/.test(src.zipcode)) return fail("zipcode")
  const zipcode = onlyDigits(src.zipcode)
  const street = text(src.street, "street", 2, 160, true)
  if (isErr(street) || street === null) return fail("street")
  const number = text(src.number, "number", 1, 20, true)
  if (isErr(number) || number === null) return fail("number")
  const complement = text(src.complement, "complement", 1, 80, false)
  if (isErr(complement)) return fail("complement")
  const neighborhood = text(src.neighborhood, "neighborhood", 2, 100, true)
  if (isErr(neighborhood) || neighborhood === null) return fail("neighborhood")
  const city = text(src.city, "city", 2, 100, true)
  if (isErr(city) || city === null) return fail("city")
  let observation: string | null = null
  if (src.observation !== undefined && src.observation !== null) {
    if (typeof src.observation !== "string") return fail("observation")
    const o = src.observation.trim()
    if (o.length > 500) return fail("observation")
    observation = o === "" ? null : o
  }
  if (src.consent !== true) return fail("consent")
  if (src.confirmRecentDuplicate !== undefined && typeof src.confirmRecentDuplicate !== "boolean") {
    return { ok: false, code: "invalid_payload", message: "Dados inválidos." }
  }
  return {
    ok: true,
    value: {
      idempotencyKey: src.idempotencyKey, attributionRole: role, planId: src.planId.toLowerCase(), name, phone, document,
      zipcode, street, number, complement, neighborhood, city, observation, consent: true,
      confirmRecentDuplicate: src.confirmRecentDuplicate === true,
    },
  }
}

/** Corpo enviado à RPC: somente chaves allowlisted (opcionais vazias omitidas). */
export function toRpcPayload(p: OpportunityPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {
    idempotencyKey: p.idempotencyKey, planId: p.planId, name: p.name, phone: p.phone, zipcode: p.zipcode,
    street: p.street, number: p.number, neighborhood: p.neighborhood, city: p.city, consent: true,
  }
  if (p.attributionRole) out.attributionRole = p.attributionRole
  if (p.document) out.document = p.document
  if (p.complement) out.complement = p.complement
  if (p.observation) out.observation = p.observation
  if (p.confirmRecentDuplicate) out.confirmRecentDuplicate = true
  return out
}

// ---------------------------------------------------------------------------
// Resultado da RPC -> HTTP (respostas fechadas; nenhum dado de outro cadastro)
// ---------------------------------------------------------------------------
export const SUBMIT_ERROR_CODES = [
  "unauthenticated", "forbidden", "employee_not_active", "no_eligible_role", "role_not_eligible", "role_choice_required",
  "invalid_payload", "unknown_field", "invalid_idempotency_key", "consent_required", "idempotency_conflict",
  "duplicate_open", "duplicate_recent_closed", "unavailable",
] as const
export type SubmitErrorCode = (typeof SUBMIT_ERROR_CODES)[number]

export const SUBMIT_ERROR_STATUS: Record<SubmitErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  employee_not_active: 403,
  no_eligible_role: 403,
  role_not_eligible: 403,
  role_choice_required: 422,
  invalid_payload: 400,
  unknown_field: 400,
  invalid_idempotency_key: 400,
  consent_required: 400,
  idempotency_conflict: 409,
  duplicate_open: 409,
  duplicate_recent_closed: 409,
  unavailable: 503,
}

export const SUBMIT_ERROR_MESSAGE: Record<SubmitErrorCode, string> = {
  unauthenticated: "Sua sessão expirou. Entre novamente.",
  forbidden: "Seu perfil não pode registrar oportunidades.",
  employee_not_active: "Seu cadastro de funcionário não está ativo. Fale com o administrador.",
  no_eligible_role: "Você não possui vínculo de Técnico ou Vendas Externas ativo. Fale com o administrador.",
  role_not_eligible: "A função selecionada não corresponde aos seus vínculos ativos.",
  role_choice_required: "Selecione como você está registrando esta oportunidade.",
  invalid_payload: "Revise os dados informados.",
  unknown_field: "Dados inválidos.",
  invalid_idempotency_key: "Envio inválido. Recarregue a página e tente novamente.",
  consent_required: "Confirme o consentimento do cliente para ser contatado.",
  idempotency_conflict: "Este envio já havia sido registrado com outros dados. Confira em Minhas vendas antes de enviar novamente.",
  duplicate_open: "Já existe um atendimento em aberto para este telefone ou documento. Não é possível duplicar.",
  duplicate_recent_closed: "Este cliente teve um atendimento encerrado nos últimos 90 dias. Confirme para registrar mesmo assim.",
  unavailable: "Serviço temporariamente indisponível. Seus dados foram mantidos; tente novamente.",
}

export type SubmitSuccess = {
  ok: true
  idempotent: boolean
  opportunityId: string
  protocol: string
  attributionRole: OpportunityAttributionRole
  stage: "novo"
}

export type SubmitOutcome = { status: number; body: Record<string, unknown> }

export function errorOutcome(code: SubmitErrorCode, field?: string): SubmitOutcome {
  const body: Record<string, unknown> = { ok: false, code, message: SUBMIT_ERROR_MESSAGE[code] }
  if (code === "duplicate_recent_closed") body.requiresConfirmation = true
  if (code === "invalid_payload" && field && (OPPORTUNITY_PAYLOAD_KEYS as readonly string[]).includes(field)) {
    body.field = field
    if (field in FIELD_MESSAGE) body.message = FIELD_MESSAGE[field as OpportunityField]
  }
  return { status: SUBMIT_ERROR_STATUS[code], body }
}

/** Re-monta campo a campo; qualquer formato inesperado => 503 fechado. */
export function mapSubmitResult(raw: unknown): SubmitOutcome {
  if (typeof raw !== "object" || raw === null) return errorOutcome("unavailable")
  const r = raw as Record<string, unknown>
  if (r.ok === true) {
    const id = typeof r.opportunityId === "string" && UUID_RE.test(r.opportunityId) ? r.opportunityId : null
    const protocol = typeof r.protocol === "string" && /^[0-9A-F]{8}$/.test(r.protocol) ? r.protocol : null
    const role = (OPPORTUNITY_ATTRIBUTION_ROLES as readonly string[]).includes(String(r.attributionRole)) ? (r.attributionRole as OpportunityAttributionRole) : null
    if (!id || !protocol || !role || r.stage !== "novo") return errorOutcome("unavailable")
    const body: SubmitSuccess = { ok: true, idempotent: r.idempotent === true, opportunityId: id, protocol, attributionRole: role, stage: "novo" }
    return { status: body.idempotent ? 200 : 201, body }
  }
  const code = (SUBMIT_ERROR_CODES as readonly string[]).includes(String(r.code)) ? (r.code as SubmitErrorCode) : "unavailable"
  return errorOutcome(code, typeof r.field === "string" ? r.field : undefined)
}

// ---------------------------------------------------------------------------
// Contexto do formulário (employee_opportunity_form_context)
// ---------------------------------------------------------------------------
export type FormContext = {
  employeeStatus: string
  canCreate: boolean
  eligibleRoles: OpportunityAttributionRole[]
  roleChoiceRequired: boolean
  plans: Array<{ id: string; name: string }>
}

export function toFormContext(raw: unknown): FormContext | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  const roles = Array.isArray(r.eligibleRoles)
    ? r.eligibleRoles.filter((x): x is OpportunityAttributionRole => (OPPORTUNITY_ATTRIBUTION_ROLES as readonly string[]).includes(String(x)))
    : []
  const plans = Array.isArray(r.plans)
    ? r.plans.flatMap((p) => {
        if (typeof p !== "object" || p === null) return []
        const { id, name } = p as Record<string, unknown>
        return typeof id === "string" && UUID_RE.test(id) && typeof name === "string" ? [{ id, name: name.slice(0, 120) }] : []
      })
    : []
  return {
    employeeStatus: typeof r.employeeStatus === "string" ? r.employeeStatus : "",
    canCreate: r.canCreate === true && roles.length > 0,
    eligibleRoles: roles,
    roleChoiceRequired: roles.length > 1,
    plans,
  }
}

/** Chave por abertura do formulário (renovada só após sucesso). */
export function newIdempotencyKey(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return `eo_${random().replace(/-/g, "")}`
}
