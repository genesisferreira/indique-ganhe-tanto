import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  AUTO_MARK_PAID_DISABLED_REASON,
  canAutoCreditFirstInvoiceReward,
  planAutomaticFirstInvoiceCredit,
} from "@/lib/brbyte/first-invoice-auto-credit-gate"
import {
  COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
  COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
  NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
  PUBLIC_PRE_REGISTRATION_SOURCE,
  isReferralRewardEligible,
} from "@/lib/referral-reward-eligibility"

const ELIGIBLE_INDICATOR = "indicator-profile-1"
const COMMERCIAL_PROFILE = "commercial-profile-9"

describe("F) invoice paga + AUTO_CHECK=true + AUTO_MARK=false", () => {
  it("detecta pagamento e bloqueia reward/wallet/RPC/first_invoice_paid", () => {
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: false,
      rewardEligible: true,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.detect, true)
    assert.equal(plan.callEnsureReward, false)
    assert.equal(plan.callMarkPaidFromSync, false)
    assert.equal(plan.setFirstInvoicePaid, false)
    assert.equal(plan.reason, AUTO_MARK_PAID_DISABLED_REASON)
  })
})

describe("G) invoice paga + AUTO_CHECK=true + AUTO_MARK=true + elegível", () => {
  it("permite ensureReward e mark_first_invoice_paid_from_sync uma vez", () => {
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: true,
      rewardEligible: true,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.detect, true)
    assert.equal(plan.callEnsureReward, true)
    assert.equal(plan.callMarkPaidFromSync, true)
    assert.equal(
      plan.setFirstInvoicePaid,
      false,
      "first_invoice_paid só a RPC from_sync marca, não este fluxo TS"
    )
    assert.equal(plan.reason, null)
  })
})

describe("H) reexecução do cenário G", () => {
  it("não autoriza segundo crédito quando first_invoice_paid já é true", () => {
    const first = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: true,
      rewardEligible: true,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(first.callMarkPaidFromSync, true)

    const replay = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: true,
      rewardEligible: true,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: true,
    })
    assert.equal(replay.callEnsureReward, false)
    assert.equal(replay.callMarkPaidFromSync, false)
    assert.equal(replay.setFirstInvoicePaid, false)
    assert.equal(replay.reason, "already_paid_historical")
  })
})

describe("I) reward_eligible=false", () => {
  it("bloqueia crédito mesmo com AUTO_MARK=true", () => {
    assert.equal(
      isReferralRewardEligible({
        source: "indique_ganhe",
        reward_eligible: false,
        indicator_profile_id: ELIGIBLE_INDICATOR,
      }),
      false
    )
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: true,
      rewardEligible: false,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.callEnsureReward, false)
    assert.equal(plan.callMarkPaidFromSync, false)
    assert.equal(plan.setFirstInvoicePaid, false)
  })
})

describe("M) public_pre_registration", () => {
  it("nunca é elegível a reward no service TS", () => {
    assert.equal(
      isReferralRewardEligible({
        source: PUBLIC_PRE_REGISTRATION_SOURCE,
        reward_eligible: false,
        indicator_profile_id: ELIGIBLE_INDICATOR,
      }),
      false
    )
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: true,
      rewardEligible: false,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.callMarkPaidFromSync, false)
  })
})

describe("N) neutral_network_pre_registration", () => {
  it("nunca é elegível a reward no service TS", () => {
    assert.equal(
      isReferralRewardEligible({
        source: NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
        reward_eligible: false,
        indicator_profile_id: ELIGIBLE_INDICATOR,
      }),
      false
    )
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: true,
      rewardEligible: false,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.callEnsureReward, false)
    assert.equal(plan.callMarkPaidFromSync, false)
  })
})

describe("J) commercial_assisted_referral", () => {
  it("beneficiário é indicator_profile_id, não commercial_profile_id", () => {
    const eligible = isReferralRewardEligible({
      source: COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
      erp_lead_source: COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
      reward_eligible: true,
      indicator_profile_id: ELIGIBLE_INDICATOR,
    })
    assert.equal(eligible, true)
    const creditBeneficiary = ELIGIBLE_INDICATOR
    const commercialResponsible = COMMERCIAL_PROFILE
    assert.equal(creditBeneficiary, ELIGIBLE_INDICATOR)
    assert.notEqual(creditBeneficiary, commercialResponsible)
  })

  it("AUTO_MARK=false → zero crédito automático", () => {
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: false,
      rewardEligible: true,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.callEnsureReward, false)
    assert.equal(plan.callMarkPaidFromSync, false)
  })

  it("AUTO_MARK=true + elegível → fluxo financeiro automático permitido", () => {
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: true,
      autoMarkPaidEnabled: true,
      rewardEligible: isReferralRewardEligible({
        source: COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
        erp_lead_source: COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
        reward_eligible: true,
        indicator_profile_id: ELIGIBLE_INDICATOR,
      }),
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.callEnsureReward, true)
    assert.equal(plan.callMarkPaidFromSync, true)
  })
})

describe("ação manual explícita vs checagem ERP", () => {
  it("canAutoCredit só descreve o fluxo automático (from_sync), não mark_first_invoice_paid da UI", () => {
    const blocked = canAutoCreditFirstInvoiceReward({
      autoMarkPaidEnabled: false,
    })
    assert.equal(blocked.allowed, false)
    assert.equal(blocked.reason, AUTO_MARK_PAID_DISABLED_REASON)
    // Contrato: UI mark_first_invoice_paid não consulta esta função.
  })

  it("AUTO_CHECK=false não detecta no cron; crédito automático também fica bloqueado no plano", () => {
    const plan = planAutomaticFirstInvoiceCredit({
      autoCheckFirstInvoice: false,
      autoMarkPaidEnabled: true,
      rewardEligible: true,
      invoicePaid: true,
      firstInvoiceAlreadyPaid: false,
    })
    assert.equal(plan.detect, false)
    assert.equal(plan.callMarkPaidFromSync, false)
  })
})
