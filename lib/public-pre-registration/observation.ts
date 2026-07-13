import {
  BRBYTE_FIELD_MAX_LENGTH,
  truncateBrbyteField,
} from "@/lib/brbyte/truncate-field"
import { PUBLIC_ERP_LEAD_SOURCE } from "@/lib/referral-reward-eligibility"
import type {
  PreferredContactPeriod,
  PreferredInstallationPeriod,
} from "@/types/referral"

const LOG_TAG = "[brbyte:public-pre-registration:interest_obs_truncated]"
const SEP = " | "

export type { PreferredInstallationPeriod, PreferredContactPeriod }

export type PublicPreRegistrationObservationInput = {
  preferredInstallationPeriod: PreferredInstallationPeriod
  /** Nome oficial da oferta comercial (catálogo público). */
  offerName: string
  /** Preço formatado, ex.: "R$ 184,90". */
  offerPriceLabel: string
  phoneHasWhatsapp: boolean
  preferredContactPeriod?: PreferredContactPeriod | null
  campaignSummary?: string | null
  observacaoCliente?: string | null
}

export type PublicPreRegistrationObservationBuild = {
  value: string
  truncated: boolean
  originalLength: number
}

export function getPreferredInstallationPeriodLabel(
  period: PreferredInstallationPeriod
): string {
  switch (period) {
    case "morning":
      return "Manhã"
    case "afternoon":
      return "Tarde"
    case "no_preference":
      return "Sem preferência"
    default:
      return "Sem preferência"
  }
}

export function getPreferredContactPeriodLabel(
  period: PreferredContactPeriod
): string {
  switch (period) {
    case "morning":
      return "Manhã"
    case "afternoon":
      return "Tarde"
    case "evening":
      // Compatibilidade histórica — não oferecido em novos cadastros
      return "Noite"
    case "no_preference":
      return "Sem preferência"
    default:
      return "Sem preferência"
  }
}

export function getPhoneHasWhatsappLabel(value: boolean): string {
  return value ? "Sim" : "Não"
}

function segment(label: string, value: string): string {
  return `${label}: ${value}`
}

function joinSegments(segments: string[]): string {
  return segments.filter(Boolean).join(SEP)
}

function buildCampaignSummary(input: {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
}): string | null {
  const parts = [
    input.utm_source?.trim(),
    input.utm_medium?.trim(),
    input.utm_campaign?.trim(),
  ].filter(Boolean)
  if (parts.length === 0) return null
  return parts.join("/")
}

export function summarizeUtmCampaign(input: {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  gclid?: string | null
  fbclid?: string | null
  ref_code?: string | null
}): string | null {
  const explicit = buildCampaignSummary(input)
  if (explicit) return explicit
  if (input.ref_code?.trim()) return `ref:${input.ref_code.trim()}`
  if (input.gclid?.trim()) return "gclid"
  if (input.fbclid?.trim()) return "fbclid"
  return null
}

/**
 * Monta interest_obs para pré-cadastro público (máx. 255 caracteres).
 *
 * Prioridade:
 * 1. Origem  2. Oferta  3. Valor  4. Período instalação
 * 5. WhatsApp  6. Horário contato  7. Campanha  8. Obs  9. LGPD
 *
 * Obrigatórios (nunca removidos): Origem, Oferta, Valor, Período instalação.
 * Truncar primeiro: Obs → Campanha → Contato.
 */
export function buildPublicPreRegistrationObservation(
  input: PublicPreRegistrationObservationInput
): PublicPreRegistrationObservationBuild {
  const maxLength = BRBYTE_FIELD_MAX_LENGTH

  const origem = segment("Origem", PUBLIC_ERP_LEAD_SOURCE)
  const oferta = segment("Oferta", input.offerName.trim() || "Não informado")
  const valor = segment(
    "Valor",
    input.offerPriceLabel.trim() || "Não informado"
  )
  const periodo = segment(
    "Instalação",
    getPreferredInstallationPeriodLabel(input.preferredInstallationPeriod)
  )
  const whatsapp = segment(
    "WhatsApp",
    getPhoneHasWhatsappLabel(input.phoneHasWhatsapp)
  )
  const lgpd = segment("LGPD", "Sim")

  const requiredCore = [origem, oferta, valor, periodo]
  const segments = [...requiredCore, whatsapp]

  const contactLabel = input.preferredContactPeriod
    ? getPreferredContactPeriodLabel(input.preferredContactPeriod)
    : null
  const campaign = input.campaignSummary?.trim() || null
  const obs = input.observacaoCliente?.trim() || null

  const fullDraftParts = [
    ...requiredCore,
    whatsapp,
    ...(contactLabel ? [segment("Contato", contactLabel)] : []),
    ...(campaign ? [segment("Campanha", campaign)] : []),
    ...(obs ? [segment("Obs", obs)] : []),
    lgpd,
  ]
  const fullDraft = joinSegments(fullDraftParts)

  const tryAppend = (label: string, value: string | null | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return false
    const next = segment(label, trimmed)
    const candidate = joinSegments([...segments, next, lgpd])
    if (candidate.length <= maxLength) {
      segments.push(next)
      return true
    }
    return false
  }

  // Contato e campanha só entram se couberem (truncados primeiro se necessário)
  tryAppend("Contato", contactLabel)
  tryAppend("Campanha", campaign)

  let assembled = joinSegments([...segments, lgpd])

  if (obs) {
    // Obs usa o espaço restante; truncada antes de outros campos obrigatórios
    const withoutLgpd = joinSegments(segments)
    const prefix = withoutLgpd ? `${withoutLgpd}${SEP}Obs: ` : "Obs: "
    const suffix = `${SEP}${lgpd}`
    const remaining = maxLength - prefix.length - suffix.length
    if (remaining > 0) {
      const observationPart =
        obs.length <= remaining ? obs : obs.slice(0, remaining)
      assembled = `${prefix}${observationPart}${suffix}`
    }
  }

  const truncatedDuringAssembly = fullDraft.length > maxLength
  const final = truncateBrbyteField(assembled, maxLength)

  if (truncatedDuringAssembly || final.truncated) {
    console.warn(LOG_TAG, {
      originalLength: Math.max(fullDraft.length, final.originalLength),
      finalLength: final.value.length,
      maxLength,
    })
  }

  return {
    value: final.value,
    truncated: truncatedDuringAssembly || final.truncated,
    originalLength: Math.max(fullDraft.length, final.originalLength),
  }
}
