import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canAutoCreditFirstInvoiceReward } from "@/lib/brbyte/first-invoice-auto-credit-gate"
import { deriveCommercialStateFromErpConversion } from "@/lib/brbyte/erp-conversion-commercial-sync"
import {
  canExecuteManualMarkFirstInvoice,
  planFirstInvoiceFinancialCredit,
  projectConcurrentWalletInsert,
  referralIsFinanciallyEligible,
  resolveRewardBeneficiary,
} from "@/lib/finance/first-invoice-rpc-hardening"
import {
  COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
  COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
  NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
  PUBLIC_PRE_REGISTRATION_SOURCE,
  isReferralRewardEligible,
} from "@/lib/referral-reward-eligibility"

const INDICATOR = "indicator-1"
const COMMERCIAL = "commercial-9"
const CREATED_BY = "commercial-9"

describe("A) reward_eligible=false → sem reward/wallet", () => {
  it("bloqueia crédito e criação", () => {
    const eligible = referralIsFinanciallyEligible({
      rewardEligible: false,
      source: "indique_ganhe",
      erpLeadSource: "Indique e Ganhe",
      indicatorProfileId: INDICATOR,
    })
    assert.equal(eligible, false)
    const plan = planFirstInvoiceFinancialCredit({
      eligible,
      authorized: true,
      alreadyHasWalletCredit: false,
      firstInvoicePaid: false,
      amountFromServer: 99.9,
      beneficiary: INDICATOR,
    })
    assert.equal(plan.createReward, false)
    assert.equal(plan.creditWallet, false)
    assert.equal(plan.code, "not_reward_eligible")
  })
})

describe("B) public_pre_registration → reward bloqueada", () => {
  it("bloqueia mesmo com reward_eligible true adulterado", () => {
    assert.equal(
      referralIsFinanciallyEligible({
        rewardEligible: true,
        source: PUBLIC_PRE_REGISTRATION_SOURCE,
        erpLeadSource: "Pré-cadastro Web",
        indicatorProfileId: INDICATOR,
      }),
      false
    )
    assert.equal(
      isReferralRewardEligible({
        source: PUBLIC_PRE_REGISTRATION_SOURCE,
        reward_eligible: false,
        indicator_profile_id: null,
      }),
      false
    )
  })
})

describe("C) neutral_network_pre_registration → reward bloqueada", () => {
  it("bloqueia Rede Neutra mesmo se reward_eligible=true", () => {
    assert.equal(
      referralIsFinanciallyEligible({
        rewardEligible: true,
        source: NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
        erpLeadSource: "Pré-cadastro Rede Neutra",
        indicatorProfileId: INDICATOR,
      }),
      false
    )
  })
})

describe("D) commercial_assisted_referral elegível", () => {
  it("continua elegível com reward_eligible=true", () => {
    assert.equal(
      referralIsFinanciallyEligible({
        rewardEligible: true,
        source: COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
        erpLeadSource: COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
        indicatorProfileId: INDICATOR,
      }),
      true
    )
    assert.equal(
      isReferralRewardEligible({
        source: COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
        reward_eligible: true,
        indicator_profile_id: INDICATOR,
      }),
      true
    )
  })
})

describe("E) beneficiário assisted = indicator_profile_id", () => {
  it("nunca usa created_by nem commercial", () => {
    const beneficiary = resolveRewardBeneficiary({
      indicatorProfileId: INDICATOR,
      createdByProfileId: CREATED_BY,
      commercialProfileId: COMMERCIAL,
    })
    assert.equal(beneficiary, INDICATOR)
    assert.notEqual(beneficiary, CREATED_BY)
    const plan = planFirstInvoiceFinancialCredit({
      eligible: true,
      authorized: true,
      alreadyHasWalletCredit: false,
      firstInvoicePaid: false,
      amountFromServer: 129.9,
      amountFromBrowser: 9999,
      beneficiary,
    })
    assert.equal(plan.beneficiary, INDICATOR)
    assert.equal(plan.amount, 129.9)
  })
})

describe("F) duas chamadas da mesma primeira fatura", () => {
  it("apenas um evento financeiro", () => {
    const ids = new Set<string>()
    const first = projectConcurrentWalletInsert({
      existingCreditRewardIds: ids,
      rewardId: "rw-1",
    })
    const second = projectConcurrentWalletInsert({
      existingCreditRewardIds: ids,
      rewardId: "rw-1",
    })
    assert.equal(first.inserted, true)
    assert.equal(second.inserted, false)
    assert.equal(second.uniqueViolation, true)

    const retryPlan = planFirstInvoiceFinancialCredit({
      eligible: true,
      authorized: true,
      alreadyHasWalletCredit: true,
      firstInvoicePaid: true,
      amountFromServer: 129.9,
      beneficiary: INDICATOR,
    })
    assert.equal(retryPlan.creditWallet, false)
    assert.equal(retryPlan.idempotent, true)
  })
})

describe("G) retry do cron/sync não duplica crédito", () => {
  it("alreadyHasWalletCredit é no-op de crédito", () => {
    const plan = planFirstInvoiceFinancialCredit({
      eligible: true,
      authorized: true,
      alreadyHasWalletCredit: true,
      firstInvoicePaid: false,
      amountFromServer: 80,
      beneficiary: INDICATOR,
    })
    assert.equal(plan.creditWallet, false)
    assert.equal(plan.createReward, false)
    assert.equal(plan.idempotent, true)
  })
})

describe("H) manual válido existente continua funcionando", () => {
  it("admin_master e comercial atribuído autorizados", () => {
    const admin = canExecuteManualMarkFirstInvoice({
      role: "admin_master",
      authUserId: "admin-1",
      commercialProfileId: COMMERCIAL,
    })
    const comercial = canExecuteManualMarkFirstInvoice({
      role: "comercial",
      authUserId: COMMERCIAL,
      commercialProfileId: COMMERCIAL,
    })
    assert.equal(admin.allowed, true)
    assert.equal(comercial.allowed, true)

    const plan = planFirstInvoiceFinancialCredit({
      eligible: true,
      authorized: true,
      alreadyHasWalletCredit: false,
      firstInvoicePaid: false,
      amountFromServer: 99.9,
      beneficiary: INDICATOR,
    })
    assert.equal(plan.creditWallet, true)
    assert.equal(plan.code, null)
  })
})

describe("I) authenticated sem autorização sobre terceiro", () => {
  it("indicador e comercial de outro lead bloqueados", () => {
    const indicator = canExecuteManualMarkFirstInvoice({
      role: "indicador",
      authUserId: INDICATOR,
      commercialProfileId: COMMERCIAL,
    })
    const otherCommercial = canExecuteManualMarkFirstInvoice({
      role: "comercial",
      authUserId: "commercial-other",
      commercialProfileId: COMMERCIAL,
    })
    assert.equal(indicator.allowed, false)
    assert.equal(otherCommercial.allowed, false)
    assert.equal(indicator.code, "forbidden")
  })
})

describe("J) service_role/sync legítimo continua possível", () => {
  it("from_sync não usa role UI; só elegibilidade + valor server-side", () => {
    const plan = planFirstInvoiceFinancialCredit({
      eligible: true,
      authorized: true,
      alreadyHasWalletCredit: false,
      firstInvoicePaid: false,
      amountFromServer: 149.9,
      amountFromBrowser: 1,
      beneficiary: INDICATOR,
    })
    assert.equal(plan.creditWallet, true)
    assert.equal(plan.amount, 149.9)
  })
})

describe("K) AUTO_MARK_PAID=false → sem crédito automático", () => {
  it("regressão 1.2R-C", () => {
    const gate = canAutoCreditFirstInvoiceReward({ autoMarkPaidEnabled: false })
    assert.equal(gate.allowed, false)
  })
})

describe("L) AUTO_MARK_PAID=true + elegível + fatura paga", () => {
  it("caminho automático permanece possível", () => {
    const gate = canAutoCreditFirstInvoiceReward({ autoMarkPaidEnabled: true })
    assert.equal(gate.allowed, true)
    const plan = planFirstInvoiceFinancialCredit({
      eligible: true,
      authorized: true,
      alreadyHasWalletCredit: false,
      firstInvoicePaid: false,
      amountFromServer: 99.9,
      beneficiary: INDICATOR,
    })
    assert.equal(plan.creditWallet, true)
  })
})

describe("M) ERP conversion isoladamente → zero efeito financeiro", () => {
  it("regressão 1.2R-A+B", () => {
    const commercial = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "em_atendimento",
      currentPipelineStage: "tentativa_contato",
    })
    assert.equal(commercial.createsReward, false)
    assert.equal(commercial.createsWallet, false)
    assert.equal(commercial.setsFirstInvoicePaid, false)
    assert.equal(commercial.callsMarkFirstInvoicePaidFromSync, false)
  })
})
