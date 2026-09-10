/**
 * Espelho testável das regras SQL do Sprint 1.2R-D.
 * Não conecta em banco; não materializa wallet.
 */

export const NON_REWARD_SOURCES = [
  "public_pre_registration",
  "neutral_network_pre_registration",
] as const

export const NON_REWARD_ERP_LEAD_SOURCES = [
  "Pré-cadastro Web",
  "Pré-cadastro Rede Neutra",
] as const

export type FinancialReferralSnapshot = {
  rewardEligible: boolean | null | undefined
  source: string | null | undefined
  erpLeadSource: string | null | undefined
  indicatorProfileId: string | null | undefined
}

export function referralIsFinanciallyEligible(
  input: FinancialReferralSnapshot
): boolean {
  if (input.rewardEligible === false) return false
  const source = (input.source ?? "").trim()
  if (
    source === "public_pre_registration" ||
    source === "neutral_network_pre_registration"
  ) {
    return false
  }
  const erp = (input.erpLeadSource ?? "").trim()
  if (erp === "Pré-cadastro Web" || erp === "Pré-cadastro Rede Neutra") {
    return false
  }
  if (!input.indicatorProfileId?.trim()) return false
  return true
}

export function resolveRewardBeneficiary(input: {
  indicatorProfileId: string | null | undefined
  createdByProfileId: string | null | undefined
  commercialProfileId: string | null | undefined
}): string | null {
  const indicator = input.indicatorProfileId?.trim() || null
  return indicator
}

export type ManualMarkAuthInput = {
  role: string | null | undefined
  authUserId: string | null | undefined
  commercialProfileId: string | null | undefined
}

export function canExecuteManualMarkFirstInvoice(
  input: ManualMarkAuthInput
): { allowed: boolean; code: "forbidden" | null } {
  const role = input.role ?? null
  if (
    role !== "admin_financeiro" &&
    role !== "admin_master" &&
    role !== "comercial"
  ) {
    return { allowed: false, code: "forbidden" }
  }
  if (role === "comercial") {
    const auth = input.authUserId?.trim() || null
    const assigned = input.commercialProfileId?.trim() || null
    if (!auth || !assigned || auth !== assigned) {
      return { allowed: false, code: "forbidden" }
    }
  }
  return { allowed: true, code: null }
}

export type CreditAttempt = {
  eligible: boolean
  authorized: boolean
  alreadyHasWalletCredit: boolean
  firstInvoicePaid: boolean
  amountFromBrowser?: number | null
  amountFromServer: number
  beneficiary: string | null
}

export type CreditPlan = {
  createReward: boolean
  creditWallet: boolean
  setFirstInvoicePaid: boolean
  beneficiary: string | null
  amount: number | null
  idempotent: boolean
  code: string | null
}

export function planFirstInvoiceFinancialCredit(
  attempt: CreditAttempt
): CreditPlan {
  const blocked = {
    createReward: false,
    creditWallet: false,
    setFirstInvoicePaid: false,
    beneficiary: attempt.beneficiary,
    amount: null as number | null,
    idempotent: false,
    code: null as string | null,
  }

  if (!attempt.authorized) {
    return { ...blocked, code: "forbidden" }
  }
  if (!attempt.eligible) {
    return { ...blocked, code: "not_reward_eligible" }
  }
  if (!attempt.beneficiary) {
    return { ...blocked, code: "not_reward_eligible" }
  }
  if (attempt.alreadyHasWalletCredit) {
    return {
      createReward: false,
      creditWallet: false,
      setFirstInvoicePaid: true,
      beneficiary: attempt.beneficiary,
      amount: attempt.amountFromServer,
      idempotent: true,
      code: "already_released",
    }
  }
  if (attempt.firstInvoicePaid) {
    return { ...blocked, idempotent: true, code: "already_paid" }
  }

  const amount = attempt.amountFromServer
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ...blocked, code: "invalid_amount" }
  }

  return {
    createReward: false,
    creditWallet: true,
    setFirstInvoicePaid: true,
    beneficiary: attempt.beneficiary,
    amount,
    idempotent: false,
    code: null,
  }
}

export function projectConcurrentWalletInsert(input: {
  existingCreditRewardIds: Set<string>
  rewardId: string
}): { inserted: boolean; uniqueViolation: boolean } {
  if (input.existingCreditRewardIds.has(input.rewardId)) {
    return { inserted: false, uniqueViolation: true }
  }
  input.existingCreditRewardIds.add(input.rewardId)
  return { inserted: true, uniqueViolation: false }
}
