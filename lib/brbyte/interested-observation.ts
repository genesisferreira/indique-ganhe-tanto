import { getReferralContractTypeLabel } from "@/lib/referral-contract-type"
import type { RecompensaTipo, ReferralContractType } from "@/types/referral"

/** Entrada mínima para montar observação de Interessado no ERP (sem I/O). */
export type BrbyteInterestedObservationInput = {
  erpLeadSource?: string | null
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

/**
 * Monta texto de observação para futura criação de Interessado no ERP BRByte.
 * Não envia dados — apenas formata string.
 */
export function buildBrbyteInterestedObservation(
  referral: BrbyteInterestedObservationInput
): string {
  const lines: string[] = [
    `Origem: ${referral.erpLeadSource?.trim() || "Indique e Ganhe"}`,
    `Tipo de contratação: ${getReferralContractTypeLabel(referral.tipoContratacao)}`,
    `Plano de interesse: ${referral.planoNome?.trim() || "Não informado"}`,
    `Tipo de recompensa: ${rewardTypeLabel(referral.tipoRecompensa)}`,
    `CPF informado: ${referral.cpfIndicado?.replace(/\D/g, "") ? "Sim" : "Não"}`,
  ]

  const address = buildAddressLine(referral)
  lines.push(`Endereço: ${address || "Não informado"}`)

  const observation = referral.observacaoIndicado?.trim()
  lines.push(`Observação do indicador: ${observation || "—"}`)

  return lines.join("\n")
}
