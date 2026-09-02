import { isValidCNPJ, isValidCPF, isValidPhoneBR } from "@/lib/client/formatters"
import {
  isValidControllrInvoiceDueDay,
  validateControllrBirthDate,
} from "@/lib/brbyte/normalize-controllr-text"
import {
  isCommercialOfferModality,
  resolveOfferForModality,
  type CommercialOfferModality,
} from "@/lib/commercial-offers/catalog"
import {
  resolveIndicatorCrmPlanId,
  type ResolveIndicatorCrmPlanInput,
} from "@/lib/commercial-offers/indicator-resolve"
import {
  normalizeReferralDocument,
  normalizeReferralPhone,
  normalizeReferralZipcode,
} from "@/lib/referral-field-normalize"
import { isReferralContractType } from "@/lib/referral-contract-type"
import type { IndicadoPersonType, ReferralContractType } from "@/types/referral"
import {
  isUniqueViolationError,
  normalizeAssistedIdempotencyKey,
} from "./idempotency"
import {
  COMMERCIAL_ASSISTED_CREATE_AUDIT_EVENT,
  COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
  COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
} from "./constants"
import { authorizeCommercialIndicatorSearch } from "./search-auth"
import { isValidIndicatorForAssistedReferral } from "./search-result"

export type AssistedReferralClientPayload = {
  indicator_profile_id?: unknown
  referred_person_type?: unknown
  referred_name?: unknown
  referred_company_trade_name?: unknown
  referred_document?: unknown
  referred_rg?: unknown
  referred_birth_date?: unknown
  referred_phone?: unknown
  referred_email?: unknown
  referred_zipcode?: unknown
  referred_state?: unknown
  referred_city?: unknown
  referred_neighborhood?: unknown
  referred_street?: unknown
  referred_number?: unknown
  referred_complement?: unknown
  referred_observation?: unknown
  preferred_invoice_due_day?: unknown
  referral_contract_type?: unknown
  public_offer_code?: unknown
  reward_type?: unknown
  installation_fee_awareness?: unknown
  contract_type_awareness?: unknown
  /** UUID da tentativa lógica — não controla ownership/reward/source. */
  assisted_idempotency_key?: unknown
  // Campos que o browser NÃO pode impor — ignorados se enviados:
  created_by_profile_id?: unknown
  commercial_profile_id?: unknown
  source?: unknown
  erp_lead_source?: unknown
  reward_eligible?: unknown
  public_offer_price?: unknown
  plan_id?: unknown
}

export type AssistedReferralValidatedInput = {
  indicatorProfileId: string
  personType: IndicadoPersonType
  referredName: string
  tradeName: string | null
  document: string
  rg: string | null
  birthDate: string | null
  phone: string
  email: string | null
  zipcode: string | null
  state: string | null
  city: string | null
  neighborhood: string | null
  street: string | null
  number: string | null
  complement: string | null
  observation: string | null
  preferredInvoiceDueDay: number
  contractType: ReferralContractType
  offerCode: string
  rewardType: "pix" | "desconto_fatura"
  installationFeeAwareness: true
  contractTypeAwareness: true
  idempotencyKey: string
}

export type AssistedReferralInsertRow = {
  indicator_profile_id: string
  created_by_profile_id: string
  commercial_profile_id: string | null
  source: typeof COMMERCIAL_ASSISTED_REFERRAL_SOURCE
  erp_lead_source: typeof COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE
  reward_eligible: true
  reward_amount: null
  reward_type: "pix" | "desconto_fatura"
  referred_name: string
  referred_company_trade_name: string | null
  referred_phone: string
  referred_email: string | null
  referred_document: string
  referred_rg: string | null
  referred_person_type: IndicadoPersonType
  referred_birth_date: string | null
  referred_zipcode: string | null
  referred_state: string | null
  referred_city: string | null
  referred_neighborhood: string | null
  referred_street: string | null
  referred_number: string | null
  referred_complement: string | null
  referred_observation: string | null
  referred_address: null
  preferred_invoice_due_day: number
  referral_contract_type: ReferralContractType
  installation_fee_awareness: true
  installation_fee_awareness_at: string
  contract_type_awareness: true
  contract_type_awareness_at: string
  plan_id: string
  public_offer_code: string
  public_offer_name: string
  public_offer_price: number
  status: "pendente" | "em_atendimento"
  assigned_at: string | null
  last_interaction_at: string | null
  assisted_idempotency_key: string
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function nullableTrim(value: unknown): string | null {
  const t = asString(value).trim()
  return t ? t : null
}

export function validateAssistedReferralClientPayload(
  body: AssistedReferralClientPayload
):
  | { ok: true; data: AssistedReferralValidatedInput }
  | { ok: false; message: string } {
  const indicatorProfileId = asString(body.indicator_profile_id).trim()
  if (!indicatorProfileId) {
    return { ok: false, message: "Selecione um indicador válido." }
  }

  const idempotencyKey = normalizeAssistedIdempotencyKey(
    body.assisted_idempotency_key
  )
  if (!idempotencyKey) {
    return {
      ok: false,
      message: "Chave de idempotência inválida. Recarregue e tente novamente.",
    }
  }

  const personRaw = asString(body.referred_person_type).trim().toLowerCase()
  const personType: IndicadoPersonType = personRaw === "pj" ? "pj" : "pf"

  const referredName = asString(body.referred_name).trim()
  if (!referredName) {
    return {
      ok: false,
      message:
        personType === "pj"
          ? "Informe a razão social do indicado."
          : "Informe o nome completo do indicado.",
    }
  }

  const tradeName = nullableTrim(body.referred_company_trade_name)
  if (personType === "pj" && !tradeName) {
    return { ok: false, message: "Informe o nome fantasia." }
  }

  const document = normalizeReferralDocument(asString(body.referred_document))
  if (personType === "pf") {
    if (!document || document.length !== 11 || !isValidCPF(document)) {
      return { ok: false, message: "Informe um CPF válido." }
    }
  } else if (!document || document.length !== 14 || !isValidCNPJ(document)) {
    return { ok: false, message: "Informe um CNPJ válido." }
  }

  const phone = normalizeReferralPhone(asString(body.referred_phone))
  if (!phone || !isValidPhoneBR(phone)) {
    return { ok: false, message: "Informe um telefone válido com DDD." }
  }

  let birthDate: string | null = null
  if (personType === "pf") {
    const birthValidation = validateControllrBirthDate(
      asString(body.referred_birth_date)
    )
    if (!birthValidation.ok) {
      if (birthValidation.reason === "missing") {
        return { ok: false, message: "Informe a data de nascimento." }
      }
      if (birthValidation.reason === "future") {
        return {
          ok: false,
          message: "A data de nascimento não pode estar no futuro.",
        }
      }
      return { ok: false, message: "Informe uma data de nascimento válida." }
    }
    birthDate = birthValidation.value
  } else {
    const rawBirth = asString(body.referred_birth_date).trim()
    if (rawBirth) {
      const birthValidation = validateControllrBirthDate(rawBirth)
      if (!birthValidation.ok) {
        return { ok: false, message: "Informe uma data de nascimento válida." }
      }
      birthDate = birthValidation.value
    }
  }

  const dueDayRaw = body.preferred_invoice_due_day
  const dueDay =
    typeof dueDayRaw === "number"
      ? dueDayRaw
      : Number.parseInt(asString(dueDayRaw), 10)
  if (!isValidControllrInvoiceDueDay(dueDay)) {
    return {
      ok: false,
      message: "Escolha o dia de vencimento: 05, 10, 15, 20, 25 ou 30.",
    }
  }

  const modalityRaw = asString(body.referral_contract_type).trim()
  if (!isCommercialOfferModality(modalityRaw) || !isReferralContractType(modalityRaw)) {
    return { ok: false, message: "Selecione uma modalidade válida." }
  }
  const contractType = modalityRaw as ReferralContractType & CommercialOfferModality

  const offerCode = asString(body.public_offer_code).trim()
  const resolvedOffer = resolveOfferForModality(offerCode, contractType)
  if (!offerCode || !resolvedOffer) {
    return {
      ok: false,
      message: "Selecione um plano válido para a modalidade.",
    }
  }

  if (body.installation_fee_awareness !== true) {
    return {
      ok: false,
      message:
        "Confirme que o indicado está ciente sobre possíveis taxas de instalação.",
    }
  }
  if (body.contract_type_awareness !== true) {
    return {
      ok: false,
      message:
        "Confirme que explicou a diferença entre Tanto Livre e Tanto Vantagens.",
    }
  }

  const rewardRaw = asString(body.reward_type).trim()
  const rewardType =
    rewardRaw === "desconto_fatura" || rewardRaw === "desconto"
      ? "desconto_fatura"
      : "pix"

  const street = nullableTrim(body.referred_street)
  const number = nullableTrim(body.referred_number)
  if (street && !number) {
    return {
      ok: false,
      message: "Informe o número do endereço.",
    }
  }

  const zipcode = normalizeReferralZipcode(asString(body.referred_zipcode))

  return {
    ok: true,
    data: {
      indicatorProfileId,
      personType,
      referredName,
      tradeName: personType === "pj" ? tradeName : null,
      document,
      rg: nullableTrim(body.referred_rg),
      birthDate,
      phone,
      email: nullableTrim(body.referred_email),
      zipcode,
      state: nullableTrim(body.referred_state),
      city: nullableTrim(body.referred_city),
      neighborhood: nullableTrim(body.referred_neighborhood),
      street,
      number,
      complement: nullableTrim(body.referred_complement),
      observation: nullableTrim(body.referred_observation),
      preferredInvoiceDueDay: dueDay,
      contractType,
      offerCode,
      rewardType,
      installationFeeAwareness: true,
      contractTypeAwareness: true,
      idempotencyKey,
    },
  }
}

/**
 * Monta a row de insert. Ownership controlado pelo servidor — ignora campos
 * privileged do browser (created_by, commercial, source, reward_eligible, price).
 */
export function buildAssistedReferralInsertRow(input: {
  validated: AssistedReferralValidatedInput
  actorProfileId: string
  actorRole: "comercial" | "admin_master"
  offerName: string
  offerPrice: number
  planId: string
  nowIso: string
}): AssistedReferralInsertRow {
  const isCommercial = input.actorRole === "comercial"
  return {
    indicator_profile_id: input.validated.indicatorProfileId,
    created_by_profile_id: input.actorProfileId,
    commercial_profile_id: isCommercial ? input.actorProfileId : null,
    source: COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
    erp_lead_source: COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
    reward_eligible: true,
    reward_amount: null,
    reward_type: input.validated.rewardType,
    referred_name: input.validated.referredName,
    referred_company_trade_name: input.validated.tradeName,
    referred_phone: input.validated.phone,
    referred_email: input.validated.email,
    referred_document: input.validated.document,
    referred_rg: input.validated.rg,
    referred_person_type: input.validated.personType,
    referred_birth_date: input.validated.birthDate,
    referred_zipcode: input.validated.zipcode,
    referred_state: input.validated.state,
    referred_city: input.validated.city,
    referred_neighborhood: input.validated.neighborhood,
    referred_street: input.validated.street,
    referred_number: input.validated.number,
    referred_complement: input.validated.complement,
    referred_observation: input.validated.observation,
    referred_address: null,
    preferred_invoice_due_day: input.validated.preferredInvoiceDueDay,
    referral_contract_type: input.validated.contractType,
    installation_fee_awareness: true,
    installation_fee_awareness_at: input.nowIso,
    contract_type_awareness: true,
    contract_type_awareness_at: input.nowIso,
    plan_id: input.planId,
    public_offer_code: input.validated.offerCode,
    public_offer_name: input.offerName,
    public_offer_price: input.offerPrice,
    status: isCommercial ? "em_atendimento" : "pendente",
    assigned_at: isCommercial ? input.nowIso : null,
    last_interaction_at: isCommercial ? input.nowIso : null,
    assisted_idempotency_key: input.validated.idempotencyKey,
  }
}

export function buildAssistedCreateAuditMetadata(input: {
  referralId: string
  indicatorProfileId: string
  commercialProfileId: string | null
  createdByProfileId: string
}): Record<string, unknown> {
  return {
    event: COMMERCIAL_ASSISTED_CREATE_AUDIT_EVENT,
    referral_id: input.referralId,
    indicator_profile_id: input.indicatorProfileId,
    commercial_profile_id: input.commercialProfileId,
    created_by_profile_id: input.createdByProfileId,
    source: COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
  }
}

/** Prova que payload privilegiado do browser é ignorado. */
export function assertServerOwnsPrivilegedFields(
  row: AssistedReferralInsertRow,
  actorProfileId: string,
  actorRole: "comercial" | "admin_master"
): boolean {
  if (row.created_by_profile_id !== actorProfileId) return false
  if (row.source !== COMMERCIAL_ASSISTED_REFERRAL_SOURCE) return false
  if (row.erp_lead_source !== COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE) return false
  if (row.reward_eligible !== true) return false
  if (actorRole === "comercial" && row.commercial_profile_id !== actorProfileId) {
    return false
  }
  if (actorRole === "admin_master" && row.commercial_profile_id !== null) {
    return false
  }
  return true
}

export type CreateAssistedReferralDeps = {
  getUser: () => Promise<{ id: string } | null>
  getActorProfile: (userId: string) => Promise<{
    id: string
    role: string
    is_active: boolean | null
    full_name: string | null
  } | null>
  loadIndicatorProfile: (id: string) => Promise<{
    id: string
    role: string
    is_active: boolean | null
    full_name: string | null
  } | null>
  listPlanRows: () => Promise<ResolveIndicatorCrmPlanInput["planRows"]>
  resolvePlanEnv: () => {
    plan500Id: string | null
    plan1000Id: string | null
    baseCrmPlanId: string | null
  }
  insertReferral: (
    row: AssistedReferralInsertRow
  ) => Promise<
    | { id: string }
    | { error: string; code?: string | null; uniqueViolation?: boolean }
  >
  findReferralByIdempotencyKey: (key: string) => Promise<{
    id: string
    indicator_profile_id: string
    created_by_profile_id: string | null
    commercial_profile_id: string | null
    referred_name: string
    source: string | null
    reward_eligible: boolean | null
  } | null>
  insertReferralHistory: (input: {
    referralId: string
    actorProfileId: string
    newStatus: string
    metadata: Record<string, unknown>
  }) => Promise<void>
  insertAudit: (input: {
    actorProfileId: string
    entityId: string
    metadata: Record<string, unknown>
  }) => Promise<void>
  createControllrInterest: (input: {
    referralId: string
    actorUserId: string
  }) => Promise<{ ok: boolean; message?: string; skipped?: boolean }>
  nowIso?: string
}

export type CreateAssistedReferralResult =
  | {
      ok: true
      referralId: string
      indicatorName: string
      referredName: string
      responsibleName: string
      commercialProfileId: string | null
      replayed: boolean
      controllr: { ok: boolean; skipped?: boolean; message?: string }
    }
  | { ok: false; status: number; message: string }

export async function createAssistedReferral(
  deps: CreateAssistedReferralDeps,
  body: AssistedReferralClientPayload
): Promise<CreateAssistedReferralResult> {
  const user = await deps.getUser()
  if (!user) {
    return {
      ok: false,
      status: 401,
      message: "Sessão não encontrada. Faça login novamente.",
    }
  }

  const actor = await deps.getActorProfile(user.id)
  const auth = authorizeCommercialIndicatorSearch({
    userId: user.id,
    profile: actor,
  })
  if (!auth.ok) {
    return { ok: false, status: auth.status, message: auth.message }
  }

  const actorRole = auth.role
  if (actorRole !== "comercial" && actorRole !== "admin_master") {
    return { ok: false, status: 403, message: "Acesso restrito ao Comercial." }
  }

  const validated = validateAssistedReferralClientPayload(body)
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.message }
  }

  const existingByKey = await deps.findReferralByIdempotencyKey(
    validated.data.idempotencyKey
  )
  if (existingByKey) {
    if (existingByKey.created_by_profile_id !== auth.profileId) {
      return {
        ok: false,
        status: 409,
        message: "Chave de idempotência já utilizada por outra sessão.",
      }
    }
    const indicatorName =
      (
        await deps.loadIndicatorProfile(existingByKey.indicator_profile_id)
      )?.full_name?.trim() || "Indicador"
    return {
      ok: true,
      referralId: existingByKey.id,
      indicatorName,
      referredName: existingByKey.referred_name,
      responsibleName:
        actorRole === "comercial"
          ? actor?.full_name?.trim() || "Comercial"
          : "Distribuição automática",
      commercialProfileId: existingByKey.commercial_profile_id,
      replayed: true,
      controllr: { ok: true, skipped: true, message: "replay" },
    }
  }

  const indicator = await deps.loadIndicatorProfile(
    validated.data.indicatorProfileId
  )
  if (!indicator) {
    return { ok: false, status: 400, message: "Indicador não encontrado." }
  }
  const indicatorCheck = isValidIndicatorForAssistedReferral(indicator)
  if (!indicatorCheck.ok) {
    if (indicatorCheck.reason === "inactive") {
      return { ok: false, status: 400, message: "Indicador inativo." }
    }
    if (indicatorCheck.reason === "not_indicator") {
      return {
        ok: false,
        status: 400,
        message: "O perfil selecionado não é um indicador.",
      }
    }
    return { ok: false, status: 400, message: "Indicador inválido." }
  }

  const resolvedOffer = resolveOfferForModality(
    validated.data.offerCode,
    validated.data.contractType
  )
  if (!resolvedOffer) {
    return {
      ok: false,
      status: 400,
      message: "Selecione um plano válido para a modalidade.",
    }
  }

  const planRows = await deps.listPlanRows()
  const planEnv = deps.resolvePlanEnv()
  const crmPlan = resolveIndicatorCrmPlanId({
    offerCode: validated.data.offerCode,
    planRows,
    plan500Id: planEnv.plan500Id,
    plan1000Id: planEnv.plan1000Id,
    baseCrmPlanId: planEnv.baseCrmPlanId,
  })
  if (!crmPlan.ok) {
    return {
      ok: false,
      status: 400,
      message:
        crmPlan.reason === "crm_plan_unresolved"
          ? "Plano técnico Controllr não configurado. Contate o suporte."
          : "Selecione um plano válido.",
    }
  }

  const nowIso = deps.nowIso ?? new Date().toISOString()
  const row = buildAssistedReferralInsertRow({
    validated: validated.data,
    actorProfileId: auth.profileId,
    actorRole,
    offerName: resolvedOffer.base.name,
    offerPrice: resolvedOffer.base.price,
    planId: crmPlan.planId,
    nowIso,
  })

  if (!assertServerOwnsPrivilegedFields(row, auth.profileId, actorRole)) {
    return {
      ok: false,
      status: 500,
      message: "Erro interno ao montar a indicação.",
    }
  }

  const inserted = await deps.insertReferral(row)
  if ("error" in inserted) {
    if (inserted.uniqueViolation || isUniqueViolationError(inserted)) {
      const raced = await deps.findReferralByIdempotencyKey(
        validated.data.idempotencyKey
      )
      if (raced && raced.created_by_profile_id === auth.profileId) {
        return {
          ok: true,
          referralId: raced.id,
          indicatorName: indicator.full_name?.trim() || "Indicador",
          referredName: raced.referred_name,
          responsibleName:
            actorRole === "comercial"
              ? actor?.full_name?.trim() || "Comercial"
              : "Distribuição automática",
          commercialProfileId: raced.commercial_profile_id,
          replayed: true,
          controllr: { ok: true, skipped: true, message: "replay" },
        }
      }
    }
    return {
      ok: false,
      status: 500,
      message: "Não foi possível criar a indicação. Tente novamente.",
    }
  }

  const metadata = buildAssistedCreateAuditMetadata({
    referralId: inserted.id,
    indicatorProfileId: row.indicator_profile_id,
    commercialProfileId: row.commercial_profile_id,
    createdByProfileId: row.created_by_profile_id,
  })

  try {
    await deps.insertReferralHistory({
      referralId: inserted.id,
      actorProfileId: auth.profileId,
      newStatus: row.status,
      metadata: {
        action: COMMERCIAL_ASSISTED_CREATE_AUDIT_EVENT,
        ...metadata,
      },
    })
  } catch {
    // best-effort
  }

  try {
    await deps.insertAudit({
      actorProfileId: auth.profileId,
      entityId: inserted.id,
      metadata,
    })
  } catch {
    // best-effort
  }

  let controllr: { ok: boolean; skipped?: boolean; message?: string } = {
    ok: true,
    skipped: true,
  }
  try {
    const interest = await deps.createControllrInterest({
      referralId: inserted.id,
      actorUserId: auth.profileId,
    })
    controllr = {
      ok: interest.ok,
      skipped: interest.skipped,
      message: interest.message,
    }
  } catch {
    controllr = {
      ok: false,
      message: "Indicação salva. Integração Controllr pendente.",
    }
  }

  return {
    ok: true,
    referralId: inserted.id,
    indicatorName: indicator.full_name?.trim() || "Indicador",
    referredName: row.referred_name,
    responsibleName:
      actorRole === "comercial"
        ? actor?.full_name?.trim() || "Comercial"
        : "Distribuição automática",
    commercialProfileId: row.commercial_profile_id,
    replayed: false,
    controllr,
  }
}
