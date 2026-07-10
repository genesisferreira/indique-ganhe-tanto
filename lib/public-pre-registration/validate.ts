import {
  normalizeReferralDocument,
  normalizeReferralPhone,
  normalizeReferralZipcode,
} from "@/lib/referral-field-normalize"
import {
  isValidCEP,
  isValidCPF,
  isValidPhoneBR,
  onlyDigits,
} from "@/lib/client/formatters"
import type { PreferredInstallationPeriod } from "@/types/referral"
import type { PreferredContactPeriod } from "@/types/referral"
import { PUBLIC_PRE_REGISTRATION_UTM_MAX_LENGTH } from "@/lib/public-pre-registration/config"

export type { PreferredInstallationPeriod, PreferredContactPeriod }

export type PublicPreRegistrationPayload = {
  fullName: string
  cpf: string
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
  planId: string
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
}

const INSTALL_PERIODS = new Set<PreferredInstallationPeriod>([
  "morning",
  "afternoon",
  "no_preference",
])

const CONTACT_PERIODS = new Set<PreferredContactPeriod>([
  "morning",
  "afternoon",
  "evening",
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

export function parsePublicPreRegistrationPayload(
  body: unknown
): { ok: true; data: PublicPreRegistrationPayload } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Dados inválidos." }
  }

  const raw = body as Record<string, unknown>

  const fullName = sanitizeText(raw.fullName, 200)
  const cpf = onlyDigits(String(raw.cpf ?? ""))
  const phone = onlyDigits(String(raw.phone ?? ""))
  const cep = onlyDigits(String(raw.cep ?? ""))
  const state = sanitizeText(raw.state, 2)
  const city = sanitizeText(raw.city, 120)
  const neighborhood = sanitizeText(raw.neighborhood, 120)
  const street = sanitizeText(raw.street, 200)
  const number = sanitizeText(raw.number, 20)
  const planId = sanitizeText(raw.planId, 64)
  const period = String(raw.preferredInstallationPeriod ?? "").trim()

  if (!fullName || fullName.length < 3) {
    return { ok: false, message: "Informe o nome completo." }
  }
  if (!isValidCPF(cpf)) {
    return { ok: false, message: "CPF inválido." }
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
  if (!planId) {
    return { ok: false, message: "Selecione um plano." }
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
    if (!CONTACT_PERIODS.has(contactPeriodRaw as PreferredContactPeriod)) {
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
      fullName,
      cpf,
      phone,
      phoneHasWhatsapp: phoneHasWhatsappRaw,
      email,
      rg: sanitizeText(raw.rg, 30),
      cep,
      state: state.toUpperCase(),
      city,
      neighborhood,
      street,
      number,
      complement: sanitizeText(raw.complement, 120),
      planId,
      preferredInstallationPeriod: period as PreferredInstallationPeriod,
      preferredContactPeriod,
      clientObservation: sanitizeText(raw.clientObservation, 500),
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

export function normalizePublicPreRegistrationFields(payload: PublicPreRegistrationPayload) {
  return {
    referred_name: payload.fullName,
    referred_phone: normalizeReferralPhone(payload.phone)!,
    referred_document: normalizeReferralDocument(payload.cpf)!,
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
    referred_person_type: "pf" as const,
  }
}
