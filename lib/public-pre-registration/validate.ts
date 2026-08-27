import {
  normalizeReferralDocument,
  normalizeReferralPhone,
  normalizeReferralZipcode,
} from "@/lib/referral-field-normalize"
import {
  isValidCEP,
  isValidCNPJ,
  isValidCPF,
  isValidPhoneBR,
  onlyDigits,
} from "@/lib/client/formatters"
import type {
  IndicadoPersonType,
  PreferredContactPeriod,
  PreferredInstallationPeriod,
  ReferralContractType,
} from "@/types/referral"
import {
  isCommercialOfferModality,
  listOffersForModality,
  listNeutralNetworkOffers,
  resolveNeutralNetworkOffer,
  resolveOfferForModality,
  type ResolvedCommercialOffer,
} from "@/lib/commercial-offers/catalog"
import {
  isValidPublicPreRegistrationDueDay,
  normalizePublicPreRegistrationText,
  validatePublicPreRegistrationBirthDate,
} from "@/lib/public-pre-registration/normalize"

/** Espelha config sem importar `server-only` (testável). */
const PUBLIC_PRE_REGISTRATION_UTM_MAX_LENGTH = 120

export type { PreferredInstallationPeriod, PreferredContactPeriod }

export type PublicPreRegistrationChannel =
  | "pre_registration"
  | "neutral_network"

export type PublicPreRegistrationPayload = {
  channel: PublicPreRegistrationChannel
  personType: IndicadoPersonType
  fullName: string
  document: string
  tradeName?: string | null
  phone: string
  phoneHasWhatsapp: boolean
  email?: string | null
  rg?: string | null
  cep: string
  state: string
  city: string
  neighborhood: string
  street: string
  number: string
  complement?: string | null
  /** Obrigatório para PF; opcional/ausente para PJ. */
  birthDate: string | null
  preferredInvoiceDueDay: number
  offerCode: string
  /** Oferta resolvida no servidor (preço canônico). */
  offer: ResolvedCommercialOffer
  contractType: ReferralContractType
  preferredInstallationPeriod: PreferredInstallationPeriod
  preferredContactPeriod?: PreferredContactPeriod | null
  clientObservation?: string | null
  lgpdAccepted: boolean
  honeypot?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  gclid?: string | null
  fbclid?: string | null
  ref?: string | null
  /** @deprecated Use document — mantido para logs/testes legados. */
  cpf?: string
}

const INSTALL_PERIODS = new Set<PreferredInstallationPeriod>([
  "morning",
  "afternoon",
  "no_preference",
])

const CONTACT_PERIODS_NEW = new Set<string>([
  "morning",
  "afternoon",
  "no_preference",
])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitizeText(
  value: unknown,
  maxLength: number
): string | null {
  if (value == null) return null
  const str = String(value).trim()
  if (!str) return null
  return str.slice(0, maxLength)
}

export function sanitizeUtmField(value: unknown): string | null {
  return sanitizeText(value, PUBLIC_PRE_REGISTRATION_UTM_MAX_LENGTH)
}

function parsePersonType(raw: Record<string, unknown>): IndicadoPersonType {
  const value = String(raw.personType ?? raw.referred_person_type ?? "pf")
    .trim()
    .toLowerCase()
  return value === "pj" ? "pj" : "pf"
}

export function parsePublicPreRegistrationPayload(
  body: unknown,
  options?: { channel?: PublicPreRegistrationChannel }
): { ok: true; data: PublicPreRegistrationPayload } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Dados inválidos." }
  }

  const raw = body as Record<string, unknown>
  // Canal/origem são definidos pela rota — nunca pelo body do cliente.
  if (
    raw.source != null ||
    raw.reward_eligible != null ||
    raw.channel != null ||
    raw.indicator_profile_id != null
  ) {
    // Campos ignorados de propósito (não confiar no cliente).
  }

  const channel: PublicPreRegistrationChannel =
    options?.channel === "neutral_network" ? "neutral_network" : "pre_registration"
  const personType = parsePersonType(raw)

  const fullName = sanitizeText(raw.fullName ?? raw.razaoSocial, 200)
  const documentDigits = onlyDigits(
    String(raw.document ?? raw.cpf ?? raw.cnpj ?? "")
  )
  const tradeName = sanitizeText(raw.tradeName ?? raw.nomeFantasia, 200)
  const phone = onlyDigits(String(raw.phone ?? ""))
  const cep = onlyDigits(String(raw.cep ?? ""))
  const state = sanitizeText(raw.state, 2)
  const city = sanitizeText(raw.city, 120)
  const neighborhood = sanitizeText(raw.neighborhood, 120)
  const street = sanitizeText(raw.street, 200)
  const number = sanitizeText(raw.number, 20)
  const offerCode = sanitizeText(raw.offerCode, 64)
  const period = String(raw.preferredInstallationPeriod ?? "").trim()
  const preferredInvoiceDueDay = Number(raw.preferredInvoiceDueDay)

  if (!fullName || fullName.length < 3) {
    return {
      ok: false,
      message:
        personType === "pj"
          ? "Informe a razão social."
          : "Informe o nome completo.",
    }
  }

  if (personType === "pj") {
    if (!isValidCNPJ(documentDigits)) {
      return { ok: false, message: "CNPJ inválido." }
    }
    if (!tradeName || tradeName.length < 2) {
      return { ok: false, message: "Informe o nome fantasia." }
    }
  } else if (!isValidCPF(documentDigits)) {
    return { ok: false, message: "CPF inválido." }
  }

  let birthDate: string | null = null
  if (personType === "pf") {
    const birthDateResult = validatePublicPreRegistrationBirthDate(raw.birthDate)
    if (!birthDateResult.ok) {
      if (birthDateResult.reason === "future") {
        return {
          ok: false,
          message: "A data de nascimento não pode estar no futuro.",
        }
      }
      return { ok: false, message: "Informe a data de nascimento." }
    }
    birthDate = birthDateResult.value
  } else if (raw.birthDate != null && String(raw.birthDate).trim()) {
    const birthDateResult = validatePublicPreRegistrationBirthDate(raw.birthDate)
    if (!birthDateResult.ok) {
      return { ok: false, message: "Data de nascimento inválida." }
    }
    birthDate = birthDateResult.value
  }

  if (!isValidPhoneBR(phone)) {
    return { ok: false, message: "Telefone inválido." }
  }
  if (!isValidCEP(cep)) {
    return { ok: false, message: "CEP inválido." }
  }
  if (!state || state.length !== 2) {
    return { ok: false, message: "Informe o estado (UF)." }
  }
  if (!city) {
    return { ok: false, message: "Informe a cidade." }
  }
  if (!neighborhood) {
    return { ok: false, message: "Informe o bairro." }
  }
  if (!street) {
    return { ok: false, message: "Informe o endereço." }
  }
  if (!number) {
    return { ok: false, message: "Informe o número." }
  }
  if (!isValidPublicPreRegistrationDueDay(preferredInvoiceDueDay)) {
    return { ok: false, message: "Escolha um dia de vencimento." }
  }
  if (!offerCode) {
    return { ok: false, message: "Selecione um plano ou serviço de interesse." }
  }

  let contractType: ReferralContractType
  let offer: ResolvedCommercialOffer | null

  if (channel === "neutral_network") {
    contractType = "tanto_livre"
    offer = resolveNeutralNetworkOffer(offerCode)
    if (!offer) {
      return { ok: false, message: "Oferta inválida ou indisponível." }
    }
  } else {
    const modalityRaw = String(
      raw.contractType ?? raw.referral_contract_type ?? raw.modality ?? ""
    ).trim()
    if (!isCommercialOfferModality(modalityRaw)) {
      return { ok: false, message: "Selecione a modalidade (Tanto Livre ou Tanto Vantagens)." }
    }
    contractType = modalityRaw
    offer = resolveOfferForModality(offerCode, contractType)
    if (!offer || !offer.base.availableInPreRegistration) {
      return { ok: false, message: "Oferta inválida para a modalidade escolhida." }
    }
  }

  // Ignora qualquer preço enviado pelo cliente
  if (raw.offerPrice != null || raw.public_offer_price != null) {
    // no-op: preço só do catálogo servidor
  }

  if (!INSTALL_PERIODS.has(period as PreferredInstallationPeriod)) {
    return { ok: false, message: "Selecione o melhor período para instalação." }
  }

  const phoneHasWhatsappRaw = raw.phoneHasWhatsapp
  if (phoneHasWhatsappRaw !== true && phoneHasWhatsappRaw !== false) {
    return {
      ok: false,
      message: "Informe se o número possui WhatsApp.",
    }
  }

  const contactPeriodRaw = String(raw.preferredContactPeriod ?? "").trim()
  let preferredContactPeriod: PreferredContactPeriod | null = null
  if (contactPeriodRaw) {
    if (!CONTACT_PERIODS_NEW.has(contactPeriodRaw)) {
      return {
        ok: false,
        message: "Selecione um horário de contato válido.",
      }
    }
    preferredContactPeriod = contactPeriodRaw as PreferredContactPeriod
  }

  if (raw.lgpdAccepted !== true) {
    return { ok: false, message: "É necessário aceitar a política de privacidade." }
  }

  const email = sanitizeText(raw.email, 200)
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, message: "E-mail inválido." }
  }

  const honeypot = sanitizeText(raw.honeypot ?? raw.website, 200)
  if (honeypot) {
    return { ok: false, message: "Não foi possível processar o envio." }
  }

  return {
    ok: true,
    data: {
      channel,
      personType,
      fullName: normalizePublicPreRegistrationText(fullName)!,
      document: documentDigits,
      cpf: documentDigits,
      tradeName:
        personType === "pj"
          ? normalizePublicPreRegistrationText(tradeName)
          : null,
      phone,
      phoneHasWhatsapp: phoneHasWhatsappRaw,
      email,
      rg:
        personType === "pf"
          ? normalizePublicPreRegistrationText(sanitizeText(raw.rg, 30))
          : null,
      cep,
      state: normalizePublicPreRegistrationText(state)!,
      city: normalizePublicPreRegistrationText(city)!,
      neighborhood: normalizePublicPreRegistrationText(neighborhood)!,
      street: normalizePublicPreRegistrationText(street)!,
      number: normalizePublicPreRegistrationText(number)!,
      complement: normalizePublicPreRegistrationText(
        sanitizeText(raw.complement, 120)
      ),
      birthDate,
      preferredInvoiceDueDay,
      offerCode: offer.code,
      offer,
      contractType,
      preferredInstallationPeriod: period as PreferredInstallationPeriod,
      preferredContactPeriod,
      clientObservation: normalizePublicPreRegistrationText(
        sanitizeText(raw.clientObservation, 500)
      ),
      lgpdAccepted: true,
      utm_source: sanitizeUtmField(raw.utm_source),
      utm_medium: sanitizeUtmField(raw.utm_medium),
      utm_campaign: sanitizeUtmField(raw.utm_campaign),
      utm_content: sanitizeUtmField(raw.utm_content),
      utm_term: sanitizeUtmField(raw.utm_term),
      gclid: sanitizeUtmField(raw.gclid),
      fbclid: sanitizeUtmField(raw.fbclid),
      ref: sanitizeUtmField(raw.ref),
    },
  }
}

export function normalizePublicPreRegistrationFields(
  payload: PublicPreRegistrationPayload
) {
  return {
    referred_name: payload.fullName,
    referred_phone: normalizeReferralPhone(payload.phone)!,
    referred_document: normalizeReferralDocument(payload.document)!,
    referred_zipcode: normalizeReferralZipcode(payload.cep),
    referred_state: payload.state,
    referred_city: payload.city,
    referred_neighborhood: payload.neighborhood,
    referred_street: payload.street,
    referred_number: payload.number,
    referred_complement: payload.complement,
    referred_email: payload.email,
    referred_rg: payload.rg,
    referred_observation: payload.clientObservation,
    referred_person_type: payload.personType,
    referred_company_trade_name:
      payload.personType === "pj" ? payload.tradeName ?? null : null,
  }
}

/** Helper de teste / UI: ofertas válidas por canal. */
export function listOffersForPublicChannel(
  channel: PublicPreRegistrationChannel,
  modality?: ReferralContractType | null
): ResolvedCommercialOffer[] {
  if (channel === "neutral_network") return listNeutralNetworkOffers()
  if (!modality || !isCommercialOfferModality(modality)) return []
  return listOffersForModality(modality, { channel: "pre_registration" })
}
