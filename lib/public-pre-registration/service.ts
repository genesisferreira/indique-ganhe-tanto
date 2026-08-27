import "server-only"

import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  getPublicPreRegistrationBaseCrmPlanId,
  getPublicPreRegistrationDedupMinutes,
  getPublicPreRegistrationDefaultBrbytePlanPk,
  isPublicPreRegistrationEnabled,
  PUBLIC_PRE_REGISTRATION_DEFAULT_SOURCE_PAGE,
} from "@/lib/public-pre-registration/config"
import {
  buildPublicPreRegistrationObservation,
  summarizeUtmCampaign,
} from "@/lib/public-pre-registration/observation"
import {
  normalizePublicPreRegistrationFields,
  type PublicPreRegistrationChannel,
  type PublicPreRegistrationPayload,
} from "@/lib/public-pre-registration/validate"
import {
  NEUTRAL_NETWORK_ERP_LEAD_SOURCE,
  NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
  PUBLIC_ERP_LEAD_SOURCE,
  PUBLIC_PRE_REGISTRATION_SOURCE,
} from "@/lib/referral-reward-eligibility"

const LOG_TAG = "[public-pre-registration]"

type LooseQueryBuilder = {
  eq: (col: string, val: unknown) => LooseQueryBuilder
  gte: (col: string, val: string) => LooseQueryBuilder
  order: (
    col: string,
    opts: { ascending: boolean }
  ) => LooseQueryBuilder
  limit: (n: number) => LooseQueryBuilder
  maybeSingle: () => Promise<{
    data:
      | { id: string; brbyte_sync_status: string | null }
      | { id: string }
      | null
    error: { message: string } | null
  }>
  single: () => Promise<{
    data: { id: string } | null
    error: { message: string } | null
  }>
}

type PublicPreRegistrationDb = {
  from: (table: "referrals" | "audit_logs" | "plans") => {
    insert: (
      row: Record<string, unknown>
    ) => {
      select: (cols: string) => {
        single: () => Promise<{
          data: { id: string } | null
          error: { message: string } | null
        }>
      }
    }
    select: (cols: string) => LooseQueryBuilder
    update: (row: Record<string, unknown>) => {
      eq: (
        col: string,
        val: string
      ) => Promise<{ error: { message: string } | null }>
    }
  }
}

function getPublicPreRegistrationDb(): PublicPreRegistrationDb {
  return createServiceRoleClient() as unknown as PublicPreRegistrationDb
}

const SUCCESS_MESSAGE =
  "Pré-cadastro recebido com sucesso! Nossa equipe verificará a disponibilidade no seu endereço e entrará em contato em breve."

const SUCCESS_ERP_DEFERRED_MESSAGE =
  "Recebemos seu pré-cadastro. Nossa equipe dará continuidade ao atendimento."

export type PublicPreRegistrationResult = {
  ok: boolean
  message: string
  referralId?: string
}

function maskDocumentForLog(document: string): string {
  const digits = document.replace(/\D/g, "")
  if (digits.length < 4) return "***"
  return `***${digits.slice(-4)}`
}

function resolveChannelMeta(channel: PublicPreRegistrationChannel): {
  source: string
  erpLeadSource: string
  defaultSourcePage: string
  brbyteSourceContext:
    | "public_pre_registration"
    | "neutral_network_pre_registration"
} {
  if (channel === "neutral_network") {
    return {
      source: NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
      erpLeadSource: NEUTRAL_NETWORK_ERP_LEAD_SOURCE,
      defaultSourcePage: "/pre-cadastro-rede-neutra",
      brbyteSourceContext: "neutral_network_pre_registration",
    }
  }
  return {
    source: PUBLIC_PRE_REGISTRATION_SOURCE,
    erpLeadSource: PUBLIC_ERP_LEAD_SOURCE,
    defaultSourcePage: PUBLIC_PRE_REGISTRATION_DEFAULT_SOURCE_PAGE,
    brbyteSourceContext: "public_pre_registration",
  }
}

async function findRecentDuplicate(
  document: string,
  source: string
): Promise<{ id: string; brbyte_sync_status: string | null } | null> {
  const minutes = getPublicPreRegistrationDedupMinutes()
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString()
  const supabase = getPublicPreRegistrationDb()
  const { data } = await supabase
    .from("referrals")
    .select("id, brbyte_sync_status")
    .eq("source", source)
    .eq("referred_document", document)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as { id: string; brbyte_sync_status: string | null } | null) ?? null
}

async function resolveBaseCrmPlanId(): Promise<string | null> {
  const fromEnv = getPublicPreRegistrationBaseCrmPlanId()
  if (fromEnv) return fromEnv

  const supabase = getPublicPreRegistrationDb()
  const { data, error } = await supabase
    .from("plans")
    .select("id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data || !("id" in data)) {
    console.error(LOG_TAG, {
      step: "resolve_base_crm_plan",
      message: error?.message ?? "no_plan",
    })
    return null
  }

  return data.id
}

async function logPublicPreRegistrationAudit(
  referralId: string,
  source: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await getPublicPreRegistrationDb()
      .from("audit_logs")
      .insert({
        actor_profile_id: null,
        target_profile_id: null,
        entity_name: "referral",
        entity_id: referralId,
        action: "create",
        old_data: null,
        new_data: metadata,
        metadata: {
          source,
          ...metadata,
        },
      })
  } catch (e) {
    console.error(LOG_TAG, {
      step: "audit_log",
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

export async function submitPublicPreRegistration(
  payload: PublicPreRegistrationPayload,
  options?: { sourcePage?: string }
): Promise<PublicPreRegistrationResult> {
  if (!isPublicPreRegistrationEnabled()) {
    return { ok: false, message: "Pré-cadastro indisponível no momento." }
  }

  const channelMeta = resolveChannelMeta(payload.channel)
  const normalized = normalizePublicPreRegistrationFields(payload)

  const duplicate = await findRecentDuplicate(
    normalized.referred_document,
    channelMeta.source
  )
  if (
    duplicate &&
    (duplicate.brbyte_sync_status === "created" ||
      duplicate.brbyte_sync_status === "converted" ||
      duplicate.brbyte_sync_status === "waiting_contract" ||
      duplicate.brbyte_sync_status === "waiting_invoice")
  ) {
    return {
      ok: true,
      message: SUCCESS_MESSAGE,
      referralId: duplicate.id,
    }
  }

  const basePlanId = await resolveBaseCrmPlanId()
  if (!basePlanId) {
    console.error(LOG_TAG, {
      step: "missing_base_crm_plan",
      document: maskDocumentForLog(normalized.referred_document),
    })
    return {
      ok: false,
      message: "Pré-cadastro temporariamente indisponível. Tente novamente em breve.",
    }
  }

  const campaignSummary = summarizeUtmCampaign({
    utm_source: payload.utm_source,
    utm_medium: payload.utm_medium,
    utm_campaign: payload.utm_campaign,
    utm_content: payload.utm_content,
    utm_term: payload.utm_term,
    gclid: payload.gclid,
    fbclid: payload.fbclid,
    ref_code: payload.ref,
  })

  const nowIso = new Date().toISOString()
  const supabase = getPublicPreRegistrationDb()
  const sourcePage = sanitizeSourcePage(
    options?.sourcePage ?? channelMeta.defaultSourcePage,
    channelMeta.defaultSourcePage
  )

  const brbytePlanPk = getPublicPreRegistrationDefaultBrbytePlanPk()

  // Preço canônico do servidor — nunca do cliente
  const canonicalPrice = payload.offer.price
  const canonicalName = payload.offer.name
  const canonicalCode = payload.offer.code

  const insertRow: Record<string, unknown> = {
    indicator_profile_id: null,
    ...normalized,
    referred_address: [
      normalized.referred_street,
      normalized.referred_number,
      normalized.referred_neighborhood,
      normalized.referred_city,
      normalized.referred_state,
    ]
      .filter(Boolean)
      .join(", "),
    plan_id: basePlanId,
    referred_birth_date: payload.birthDate,
    preferred_invoice_due_day: payload.preferredInvoiceDueDay,
    public_offer_code: canonicalCode,
    public_offer_name: canonicalName,
    public_offer_price: canonicalPrice,
    reward_type: null,
    reward_amount: null,
    status: "pendente",
    source: channelMeta.source,
    reward_eligible: false,
    erp_lead_source: channelMeta.erpLeadSource,
    preferred_installation_period: payload.preferredInstallationPeriod,
    preferred_contact_period: payload.preferredContactPeriod,
    phone_has_whatsapp: payload.phoneHasWhatsapp,
    source_page: sourcePage,
    public_pre_registration_at: nowIso,
    utm_source: payload.utm_source,
    utm_medium: payload.utm_medium,
    utm_campaign: payload.utm_campaign,
    utm_content: payload.utm_content,
    utm_term: payload.utm_term,
    gclid: payload.gclid,
    fbclid: payload.fbclid,
    ref_code: payload.ref,
    brbyte_sync_status: "pending",
    installation_fee_awareness: true,
    installation_fee_awareness_at: nowIso,
    contract_type_awareness: true,
    contract_type_awareness_at: nowIso,
    referral_contract_type: payload.contractType,
  }

  const { data: inserted, error: insertError } = await supabase
    .from("referrals")
    .insert(insertRow)
    .select("id")
    .single()

  if (insertError || !inserted?.id) {
    console.error(LOG_TAG, {
      step: "insert_referral",
      message: insertError?.message ?? "no_id",
      document: maskDocumentForLog(normalized.referred_document),
    })
    return {
      ok: false,
      message: "Não foi possível registrar seu pré-cadastro. Tente novamente.",
    }
  }

  const referralId = inserted.id

  await logPublicPreRegistrationAudit(referralId, channelMeta.source, {
    public_offer_code: canonicalCode,
    public_offer_name: canonicalName,
    public_offer_price: canonicalPrice,
    referral_contract_type: payload.contractType,
    referred_person_type: payload.personType,
    referred_birth_date: payload.birthDate,
    preferred_invoice_due_day: payload.preferredInvoiceDueDay,
    preferred_installation_period: payload.preferredInstallationPeriod,
    preferred_contact_period: payload.preferredContactPeriod,
    phone_has_whatsapp: payload.phoneHasWhatsapp,
    source_page: sourcePage,
    document_masked: maskDocumentForLog(normalized.referred_document),
    utm_source: payload.utm_source,
    utm_campaign: payload.utm_campaign,
    reward_eligible: false,
  })

  const obsPreview = buildPublicPreRegistrationObservation({
    preferredInstallationPeriod: payload.preferredInstallationPeriod,
    offerName: canonicalName,
    offerPriceLabel: payload.offer.displayPrice,
    birthDate: payload.birthDate ?? "",
    preferredInvoiceDueDay: payload.preferredInvoiceDueDay,
    phoneHasWhatsapp: payload.phoneHasWhatsapp,
    preferredContactPeriod: payload.preferredContactPeriod,
    campaignSummary,
    observacaoCliente: payload.clientObservation,
  })

  console.log(LOG_TAG, {
    step: "submit",
    referralId,
    channel: payload.channel,
    offer: canonicalCode,
    contractType: payload.contractType,
    interest_obs_length: obsPreview.value.length,
    interest_obs_truncated: obsPreview.truncated,
    has_brbyte_plan_pk: Boolean(brbytePlanPk),
  })

  if (!brbytePlanPk) {
    await supabase
      .from("referrals")
      .update({
        brbyte_sync_status: "error",
        brbyte_sync_error:
          "PUBLIC_PRE_REGISTRATION_DEFAULT_BRBYTE_PLAN_PK não configurado",
        brbyte_last_error_at: nowIso,
      })
      .eq("id", referralId)

    console.warn(LOG_TAG, {
      step: "missing_brbyte_plan_pk",
      referralId,
    })

    return {
      ok: true,
      message: SUCCESS_ERP_DEFERRED_MESSAGE,
      referralId,
    }
  }

  const brbyteResult = await createBrbyteInterestFromReferral({
    referralId,
    actorUserId: null,
    sourceContext: channelMeta.brbyteSourceContext,
  })

  if (!brbyteResult.ok) {
    return {
      ok: true,
      message: SUCCESS_ERP_DEFERRED_MESSAGE,
      referralId,
    }
  }

  return {
    ok: true,
    message: SUCCESS_MESSAGE,
    referralId,
  }
}

function sanitizeSourcePage(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith("/")) {
    return fallback
  }
  return trimmed.slice(0, 120)
}
