/**
 * Guardas financeiras para liberação de recompensa na 1ª fatura.
 * Pré-cadastro e registros sem elegibilidade devem falhar de forma segura.
 */

import { isReferralRewardEligible } from "@/lib/referral-reward-eligibility"

export type FirstInvoiceRewardGuardInput = {
  source?: string | null
  reward_eligible?: boolean | null
  indicator_profile_id?: string | null
  erp_lead_source?: string | null
  brbyte_first_invoice_pk?: string | null
  invoiceMsg?: string | null
  invoiceDateCredit?: string | null
  paidAmount?: number | null
  rewardAlreadyExists?: boolean
  walletCreditAlreadyExists?: boolean
  /** Registro já confirmado financeiramente — não recalcular. */
  firstInvoiceAlreadyPaid?: boolean
}

export type FirstInvoiceRewardGuardResult =
  | { ok: true }
  | {
      ok: false
      code:
        | "not_reward_eligible"
        | "missing_indicator"
        | "missing_invoice_pk"
        | "invoice_not_paid"
        | "invalid_amount"
        | "reward_already_exists"
        | "wallet_already_exists"
        | "already_paid_historical"
      message: string
    }

export function validateFirstInvoiceRewardGuards(
  input: FirstInvoiceRewardGuardInput
): FirstInvoiceRewardGuardResult {
  if (input.firstInvoiceAlreadyPaid) {
    return {
      ok: false,
      code: "already_paid_historical",
      message: "Primeira fatura já confirmada — sem recálculo.",
    }
  }

  if (!isReferralRewardEligible(input)) {
    return {
      ok: false,
      code: "not_reward_eligible",
      message: "Registro sem elegibilidade financeira (pré-cadastro ou inelegível).",
    }
  }

  if (!input.indicator_profile_id?.trim()) {
    return {
      ok: false,
      code: "missing_indicator",
      message: "Indicação sem indicador vinculado.",
    }
  }

  if (!input.brbyte_first_invoice_pk?.trim()) {
    return {
      ok: false,
      code: "missing_invoice_pk",
      message: "Fatura Controllr não identificada.",
    }
  }

  const msg = input.invoiceMsg?.trim().toLowerCase()
  if (msg !== "paid" || !input.invoiceDateCredit?.trim()) {
    return {
      ok: false,
      code: "invoice_not_paid",
      message: "Primeira fatura ainda não consta como paga no Controllr.",
    }
  }

  const amount = Number(input.paidAmount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      code: "invalid_amount",
      message: "Valor da primeira fatura inválido ou ausente.",
    }
  }

  if (input.rewardAlreadyExists && input.walletCreditAlreadyExists) {
    return {
      ok: false,
      code: "wallet_already_exists",
      message: "Crédito já liberado — operação idempotente.",
    }
  }

  return { ok: true }
}
