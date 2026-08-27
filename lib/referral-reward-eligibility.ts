export const PUBLIC_PRE_REGISTRATION_SOURCE = "public_pre_registration" as const
export const NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE =
  "neutral_network_pre_registration" as const
export const PUBLIC_ERP_LEAD_SOURCE = "Pré-cadastro Web"
export const NEUTRAL_NETWORK_ERP_LEAD_SOURCE = "Pré-cadastro Rede Neutra"

/** Origens de captação pública sem recompensa (não Indique e Ganhe). */
export const NON_REWARD_PUBLIC_SOURCES = [
  PUBLIC_PRE_REGISTRATION_SOURCE,
  NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
] as const

export type ReferralRewardEligibilityInput = {
  source?: string | null
  reward_eligible?: boolean | null
  indicator_profile_id?: string | null
  erp_lead_source?: string | null
}

function isNonRewardPublicSource(source: string | null | undefined): boolean {
  return (
    source === PUBLIC_PRE_REGISTRATION_SOURCE ||
    source === NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE
  )
}

function isNonRewardErpLeadSource(
  erpLeadSource: string | null | undefined
): boolean {
  return (
    erpLeadSource === PUBLIC_ERP_LEAD_SOURCE ||
    erpLeadSource === NEUTRAL_NETWORK_ERP_LEAD_SOURCE
  )
}

/** Indica se o registro pode participar do fluxo financeiro (recompensa/carteira/Pix). */
export function isReferralRewardEligible(
  input: ReferralRewardEligibilityInput
): boolean {
  if (input.reward_eligible === false) return false
  if (isNonRewardPublicSource(input.source)) return false
  if (isNonRewardErpLeadSource(input.erp_lead_source)) return false
  if (!input.indicator_profile_id?.trim()) return false
  return true
}

/** Pré-cadastro web ou Rede Neutra (captação sem indicador/recompensa). */
export function isPublicPreRegistrationReferral(
  input: Pick<ReferralRewardEligibilityInput, "source" | "erp_lead_source">
): boolean {
  return (
    isNonRewardPublicSource(input.source) ||
    isNonRewardErpLeadSource(input.erp_lead_source)
  )
}

export function isNeutralNetworkPreRegistration(
  input: Pick<ReferralRewardEligibilityInput, "source" | "erp_lead_source">
): boolean {
  return (
    input.source === NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE ||
    input.erp_lead_source === NEUTRAL_NETWORK_ERP_LEAD_SOURCE
  )
}
