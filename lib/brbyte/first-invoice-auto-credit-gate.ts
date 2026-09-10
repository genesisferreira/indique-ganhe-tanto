/**
 * Gate de crédito automático da 1ª fatura (Sprint 1.2R-C).
 *
 * Separação:
 * - BRBYTE_AUTO_CHECK_FIRST_INVOICE → DETECÇÃO (cron consulta Controllr).
 * - BRBYTE_AUTO_MARK_PAID_ENABLED → CRÉDITO AUTOMÁTICO (reward/wallet/RPC).
 *
 * A checagem ERP (cron ou POST admin /check-first-invoice) NÃO pode creditar
 * se AUTO_MARK=false. Isso não afeta a ação manual explícita
 * `mark_first_invoice_paid` da UI admin/comercial.
 *
 * Elegibilidade, valor da fatura e idempotência continuam em
 * `validateFirstInvoiceRewardGuards` / `isReferralRewardEligible`.
 */

export const AUTO_MARK_PAID_DISABLED_REASON = "auto_mark_paid_disabled" as const
export const AUTO_CHECK_FIRST_INVOICE_DISABLED_REASON =
  "auto_check_first_invoice_disabled" as const

export type AutoCreditGateResult =
  | { allowed: true; reason: null }
  | { allowed: false; reason: typeof AUTO_MARK_PAID_DISABLED_REASON }

/**
 * Autoriza efeitos financeiros automáticos (ensureReward + RPC from_sync).
 * Único critério desta função: o flag de crédito automático.
 */
export function canAutoCreditFirstInvoiceReward(input: {
  autoMarkPaidEnabled: boolean
}): AutoCreditGateResult {
  if (!input.autoMarkPaidEnabled) {
    return { allowed: false, reason: AUTO_MARK_PAID_DISABLED_REASON }
  }
  return { allowed: true, reason: null }
}

export type AutomaticFirstInvoiceCreditPlan = {
  /** Pode consultar/persistir evidência ERP da fatura. */
  detect: boolean
  /** Pode chamar ensureReward + mark_first_invoice_paid_from_sync. */
  callEnsureReward: boolean
  callMarkPaidFromSync: boolean
  /** Este fluxo automático NÃO deve setar referrals.first_invoice_paid. */
  setFirstInvoicePaid: boolean
  reason: string | null
}

/**
 * Plano testável do fluxo automático (detecção vs crédito).
 * Não substitui guards de elegibilidade/valor — apenas compõe o gate.
 */
export function planAutomaticFirstInvoiceCredit(input: {
  autoCheckFirstInvoice: boolean
  autoMarkPaidEnabled: boolean
  rewardEligible: boolean
  invoicePaid: boolean
  firstInvoiceAlreadyPaid: boolean
}): AutomaticFirstInvoiceCreditPlan {
  const blocked = {
    callEnsureReward: false,
    callMarkPaidFromSync: false,
    setFirstInvoicePaid: false,
  } as const

  if (!input.autoCheckFirstInvoice) {
    return {
      detect: false,
      ...blocked,
      reason: AUTO_CHECK_FIRST_INVOICE_DISABLED_REASON,
    }
  }

  if (input.firstInvoiceAlreadyPaid) {
    return {
      detect: true,
      ...blocked,
      reason: "already_paid_historical",
    }
  }

  if (!input.invoicePaid) {
    return {
      detect: true,
      ...blocked,
      reason: "invoice_not_paid",
    }
  }

  if (!input.rewardEligible) {
    return {
      detect: true,
      ...blocked,
      reason: "not_reward_eligible",
    }
  }

  const credit = canAutoCreditFirstInvoiceReward({
    autoMarkPaidEnabled: input.autoMarkPaidEnabled,
  })
  if (!credit.allowed) {
    return {
      detect: true,
      ...blocked,
      reason: credit.reason,
    }
  }

  return {
    detect: true,
    callEnsureReward: true,
    callMarkPaidFromSync: true,
    setFirstInvoicePaid: false,
    reason: null,
  }
}
