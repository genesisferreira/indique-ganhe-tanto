export const PUBLIC_PRE_REGISTRATION_SOURCE = "public_pre_registration" as const
export const PUBLIC_ERP_LEAD_SOURCE = "Pré-cadastro Web"

export type ReferralRewardEligibilityInput = {
  source?: string | null
  reward_eligible?: boolean | null
  indicator_profile_id?: string | null
  erp_lead_source?: string | null
}

/** Indica se o registro pode participar do fluxo financeiro (recompensa/carteira/Pix). */
export function isReferralRewardEligible(
  input: ReferralRewardEligibilityInput
): boolean {
  if (input.reward_eligible === false) return false
  if (input.source === PUBLIC_PRE_REGISTRATION_SOURCE) return false
  if (input.erp_lead_source === PUBLIC_ERP_LEAD_SOURCE) return false
  if (!input.indicator_profile_id?.trim()) return false
  return true
}

export function isPublicPreRegistrationReferral(
  input: Pick<ReferralRewardEligibilityInput, "source" | "erp_lead_source">
): boolean {
  return (
    input.source === PUBLIC_PRE_REGISTRATION_SOURCE ||
    input.erp_lead_source === PUBLIC_ERP_LEAD_SOURCE
  )
}
