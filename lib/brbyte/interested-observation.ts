import { getReferralContractTypeLabel } from "@/lib/referral-contract-type"
import {
  formatControllrBirthDate,
  normalizeControllrText,
} from "@/lib/brbyte/normalize-controllr-text"
import {
  BRBYTE_FIELD_MAX_LENGTH,
  truncateBrbyteField,
} from "@/lib/brbyte/truncate-field"
import type { ReferralContractType } from "@/types/referral"

const LOG_TAG = "[brbyte:interested-observation:truncated]"
const OBSERVATION_SEPARATOR = " | "

/** Entrada mínima para montar observação de Interessado no ERP (sem I/O). */
export type BrbyteInterestedObservationInput = {
  erpLeadSource?: string | null
  indicadorNome?: string | null
  tipoContratacao?: ReferralContractType | string | null
  planoNome?: string | null
  birthDate?: string | null
  preferredInvoiceDueDay?: number | null
  observacaoIndicado?: string | null
  installationFeeAwareness?: boolean | null
  contractTypeAwareness?: boolean | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  tipoRecompensa?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  cpfIndicado?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  enderecoInstalacao?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  numeroInstalacao?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  bairroInstalacao?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  cidadeInstalacao?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  estadoInstalacao?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  cepInstalacao?: string | null
  /** @deprecated Mantido para compatibilidade de chamadas antigas. */
  enderecoIndicado?: string | null
}

export type BrbyteInterestedObservationBuild = {
  value: string
  truncated: boolean
  originalLength: number
}

function yesNo(value: boolean | null | undefined): string {
  return value ? "SIM" : "NÃO"
}

function segment(label: string, value: string): string {
  return `${label}: ${value}`
}

function joinSegments(segments: string[]): string {
  return segments.filter(Boolean).join(OBSERVATION_SEPARATOR)
}

function upperText(value: string | null | undefined, fallback: string): string {
  return normalizeControllrText(value) ?? fallback
}

function buildMandatorySegments(
  referral: BrbyteInterestedObservationInput
): string[] {
  const origem = segment(
    "ORIGEM",
    upperText(referral.erpLeadSource, "INDIQUE E GANHE")
  )

  let indicadorNome = upperText(referral.indicadorNome, "NÃO INFORMADO")
  const plano = segment(
    "PLANO",
    upperText(referral.planoNome, "NÃO INFORMADO")
  )
  const nascimento = segment(
    "NASCIMENTO",
    formatControllrBirthDate(referral.birthDate) ?? "NÃO INFORMADO"
  )
  const dueDay =
    typeof referral.preferredInvoiceDueDay === "number" &&
    Number.isInteger(referral.preferredInvoiceDueDay)
      ? referral.preferredInvoiceDueDay
      : null
  const vencimento = segment(
    "VENCIMENTO",
    dueDay != null ? `DIA ${String(dueDay).padStart(2, "0")}` : "NÃO INFORMADO"
  )

  while (indicadorNome.length > 0) {
    const indicador = segment("INDICADOR", indicadorNome)
    const candidate = joinSegments([
      origem,
      indicador,
      plano,
      nascimento,
      vencimento,
    ])
    if (candidate.length <= BRBYTE_FIELD_MAX_LENGTH) {
      return [origem, indicador, plano, nascimento, vencimento]
    }
    indicadorNome = indicadorNome.slice(0, -1).trimEnd()
  }

  return [
    origem,
    segment("INDICADOR", "NÃO INFORMADO"),
    plano,
    nascimento,
    vencimento,
  ]
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
 *
 * Prioridade:
 * 1. ORIGEM  2. INDICADOR  3. PLANO  4. NASCIMENTO  5. VENCIMENTO
 * 6. CONTRATAÇÃO  7. TAXAS  8. LIVRE/VANTAGENS  9. OBSERVAÇÃO LIVRE
 *
 * Nunca remove: ORIGEM, INDICADOR, PLANO, NASCIMENTO, VENCIMENTO.
 */
export function buildBrbyteInterestedObservation(
  referral: BrbyteInterestedObservationInput
): BrbyteInterestedObservationBuild {
  const maxLength = BRBYTE_FIELD_MAX_LENGTH
  const mandatory = buildMandatorySegments(referral)

  const contratacao = upperText(
    getReferralContractTypeLabel(referral.tipoContratacao),
    "NÃO INFORMADO"
  )
  const taxas = yesNo(referral.installationFeeAwareness)
  const livre = yesNo(referral.contractTypeAwareness)
  const formObservation = upperText(referral.observacaoIndicado, "")

  const fullDraft = joinSegments([
    ...mandatory,
    segment("CONTRATAÇÃO", contratacao),
    segment("TAXAS", taxas),
    segment("LIVRE/VANTAGENS", livre),
    ...(formObservation ? [segment("OBS", formObservation)] : []),
  ])

  const segments = [...mandatory]
  appendSegmentIfFits(segments, "CONTRATAÇÃO", contratacao, maxLength)
  appendSegmentIfFits(segments, "TAXAS", taxas, maxLength)
  appendSegmentIfFits(segments, "LIVRE/VANTAGENS", livre, maxLength)

  let assembled = joinSegments(segments)

  if (formObservation) {
    const prefix = assembled
      ? `${assembled}${OBSERVATION_SEPARATOR}OBS: `
      : "OBS: "
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
  const truncated = truncatedDuringAssembly || final.truncated

  if (truncated) {
    console.warn(LOG_TAG, {
      originalLength: Math.max(fullDraft.length, final.originalLength),
      finalLength: final.value.length,
      maxLength,
    })
  }

  return {
    value: final.value,
    truncated,
    originalLength: Math.max(fullDraft.length, final.originalLength),
  }
}
