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
  planoNome: string
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
 * Prioridade: Origem, Período instalação, Plano, WhatsApp, Campanha, Obs, LGPD.
 * Período de contato entra somente se couber.
 */
export function buildPublicPreRegistrationObservation(
  input: PublicPreRegistrationObservationInput
): PublicPreRegistrationObservationBuild {
  const maxLength = BRBYTE_FIELD_MAX_LENGTH

  const origem = segment("Origem", PUBLIC_ERP_LEAD_SOURCE)
  const periodo = segment(
    "Período",
    getPreferredInstallationPeriodLabel(input.preferredInstallationPeriod)
  )
  const plano = segment("Plano", input.planoNome.trim() || "Não informado")
  const whatsapp = segment(
    "WhatsApp",
    getPhoneHasWhatsappLabel(input.phoneHasWhatsapp)
  )
  const lgpd = segment("LGPD", "Sim")

  const fullDraftParts = [origem, periodo, plano, whatsapp, lgpd]
  if (input.preferredContactPeriod) {
    fullDraftParts.splice(
      4,
      0,
      segment(
        "Contato",
        getPreferredContactPeriodLabel(input.preferredContactPeriod)
      )
    )
  }
  if (input.campaignSummary?.trim()) {
    fullDraftParts.splice(
      fullDraftParts.length - 1,
      0,
      segment("Campanha", input.campaignSummary.trim())
    )
  }
  const obs = input.observacaoCliente?.trim()
  if (obs) {
    fullDraftParts.splice(fullDraftParts.length - 1, 0, segment("Obs", obs))
  }

  const fullDraft = joinSegments(fullDraftParts)
  const segments = [origem, periodo, plano, whatsapp]

  const tryAppend = (label: string, value: string | null | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    const next = segment(label, trimmed)
    const candidate = joinSegments([...segments, next, lgpd])
    if (candidate.length <= maxLength) {
      segments.push(next)
    }
  }

  if (input.preferredContactPeriod) {
    tryAppend(
      "Contato",
      getPreferredContactPeriodLabel(input.preferredContactPeriod)
    )
  }

  tryAppend("Campanha", input.campaignSummary)

  let assembled = joinSegments([...segments, lgpd])

  if (obs) {
    const prefix = assembled ? `${assembled}${SEP}Obs: ` : "Obs: "
    const remaining = maxLength - prefix.length
    if (remaining > 0) {
      const observationPart =
        obs.length <= remaining ? obs : obs.slice(0, remaining)
      assembled = `${prefix}${observationPart}`
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
