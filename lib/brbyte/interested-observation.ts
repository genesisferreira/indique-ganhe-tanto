import { getReferralContractTypeLabel } from "@/lib/referral-contract-type"
import {
  BRBYTE_FIELD_MAX_LENGTH,
  truncateBrbyteField,
} from "@/lib/brbyte/truncate-field"
import type { RecompensaTipo, ReferralContractType } from "@/types/referral"

const OBSERVATION_SEPARATOR = " | "

/** Entrada mínima para montar observação de Interessado no ERP (sem I/O). */
export type BrbyteInterestedObservationInput = {
  erpLeadSource?: string | null
  indicadorNome?: string | null
  tipoContratacao?: ReferralContractType | string | null
  planoNome?: string | null
  tipoRecompensa?: RecompensaTipo | string | null
  cpfIndicado?: string | null
  enderecoInstalacao?: string | null
  numeroInstalacao?: string | null
  bairroInstalacao?: string | null
  cidadeInstalacao?: string | null
  estadoInstalacao?: string | null
  cepInstalacao?: string | null
  observacaoIndicado?: string | null
  /** Campo legado referrals.referred_address */
  enderecoIndicado?: string | null
  installationFeeAwareness?: boolean | null
  contractTypeAwareness?: boolean | null
}

export type BrbyteInterestedObservationBuild = {
  value: string
  truncated: boolean
  originalLength: number
}

function rewardTypeLabel(value: RecompensaTipo | string | null | undefined): string {
  if (value === "desconto_fatura") return "Desconto na fatura"
  if (value === "pix") return "Pix"
  return "Não informado"
}

function buildAddressLine(input: BrbyteInterestedObservationInput): string | null {
  const legacy = input.enderecoIndicado?.trim()
  if (legacy) return legacy

  const street = input.enderecoInstalacao?.trim()
  const number = input.numeroInstalacao?.trim()
  const neighborhood = input.bairroInstalacao?.trim()
  const city = input.cidadeInstalacao?.trim()
  const state = input.estadoInstalacao?.trim()
  const zip = input.cepInstalacao?.replace(/\D/g, "") || null

  const parts: string[] = []
  if (street) {
    parts.push(number ? `${street}, nº ${number}` : street)
  } else if (number) {
    parts.push(`nº ${number}`)
  }
  if (neighborhood) parts.push(neighborhood)

  const cityState = [city, state].filter(Boolean).join("/")
  if (cityState) parts.push(cityState)
  if (zip) parts.push(`CEP ${zip}`)

  return parts.length > 0 ? parts.join(", ") : null
}

function yesNo(value: boolean | null | undefined): string {
  return value ? "Sim" : "Não"
}

function segment(label: string, value: string): string {
  return `${label}: ${value}`
}

function joinSegments(segments: string[]): string {
  return segments.filter(Boolean).join(OBSERVATION_SEPARATOR)
}

function buildEssentialSegments(
  referral: BrbyteInterestedObservationInput,
  maxLength: number
): string[] {
  const origem = segment("Origem", referral.erpLeadSource?.trim() || "Indique e Ganhe")
  const tipoContratacao = segment(
    "Tipo contratação",
    getReferralContractTypeLabel(referral.tipoContratacao)
  )
  const taxas = segment("Taxas ciente", yesNo(referral.installationFeeAwareness))
  const livre = segment(
    "Livre/Vantagens ciente",
    yesNo(referral.contractTypeAwareness)
  )

  let indicadorNome = referral.indicadorNome?.trim() || "Não informado"
  while (indicadorNome.length > 0) {
    const indicador = segment("Indicador", indicadorNome)
    const candidate = joinSegments([
      origem,
      indicador,
      tipoContratacao,
      taxas,
      livre,
    ])
    if (candidate.length <= maxLength) {
      return [origem, indicador, tipoContratacao, taxas, livre]
    }
    indicadorNome = indicadorNome.slice(0, -1).trimEnd()
  }

  return [origem, tipoContratacao, taxas, livre]
}

function appendSegmentIfFits(
  segments: string[],
  label: string,
  value: string | null | undefined,
  maxLength: number
): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return false

  const nextSegment = segment(label, trimmed)
  const candidate = joinSegments([...segments, nextSegment])
  if (candidate.length > maxLength) return false

  segments.push(nextSegment)
  return true
}

/**
 * Monta observação para criação de Interessado no ERP BRByte (máx. 255 caracteres).
 * Prioriza informações essenciais; campos opcionais e observação do formulário só entram se couberem.
 */
export function buildBrbyteInterestedObservation(
  referral: BrbyteInterestedObservationInput
): BrbyteInterestedObservationBuild {
  const maxLength = BRBYTE_FIELD_MAX_LENGTH

  const essentialSegments = buildEssentialSegments(referral, maxLength)

  const fullDraftSegments = [
    ...essentialSegments,
    segment("Plano", referral.planoNome?.trim() || "Não informado"),
    segment("Recompensa", rewardTypeLabel(referral.tipoRecompensa)),
    segment(
      "CPF informado",
      referral.cpfIndicado?.replace(/\D/g, "") ? "Sim" : "Não"
    ),
    segment("Endereço", buildAddressLine(referral) || "Não informado"),
  ]

  const formObservation = referral.observacaoIndicado?.trim()
  const fullDraft = joinSegments([
    ...fullDraftSegments,
    ...(formObservation ? [segment("Obs", formObservation)] : []),
  ])

  const segments = [...essentialSegments]

  appendSegmentIfFits(segments, "Plano", referral.planoNome, maxLength)
  appendSegmentIfFits(
    segments,
    "Recompensa",
    rewardTypeLabel(referral.tipoRecompensa),
    maxLength
  )
  appendSegmentIfFits(
    segments,
    "CPF informado",
    referral.cpfIndicado?.replace(/\D/g, "") ? "Sim" : "Não",
    maxLength
  )

  const address = buildAddressLine(referral)
  if (address) {
    appendSegmentIfFits(segments, "Endereço", address, maxLength)
  }

  let assembled = joinSegments(segments)

  if (formObservation) {
    const prefix = assembled
      ? `${assembled}${OBSERVATION_SEPARATOR}Obs: `
      : "Obs: "
    const remaining = maxLength - prefix.length
    if (remaining > 0) {
      const observationPart =
        formObservation.length <= remaining
          ? formObservation
          : formObservation.slice(0, remaining)
      assembled = `${prefix}${observationPart}`
    }
  }

  const truncatedDuringAssembly =
    fullDraft.length > maxLength || assembled.length > maxLength

  const final = truncateBrbyteField(assembled, maxLength)

  return {
    value: final.value,
    truncated: truncatedDuringAssembly || final.truncated,
    originalLength: Math.max(fullDraft.length, final.originalLength),
  }
}
