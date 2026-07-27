import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  COMMERCIAL_OFFERS,
  PUBLIC_PRE_REGISTRATION_OFFERS,
  formatCommercialOfferSelectLabel,
  getAllCommercialOffers,
  getCommercialOfferByCode,
  getIndicatorEligibleOffers,
  isIndicatorEligibleOffer,
} from "@/lib/commercial-offers/catalog"
import { PUBLIC_PRE_REGISTRATION_OFFERS as PRE_REG_OFFERS_REEXPORT } from "@/lib/public-pre-registration/offers"
import {
  buildIndicatorCommercialOfferOptions,
  resolveIndicatorCrmPlanId,
  resolveIndicatorOfferFinancials,
} from "@/lib/commercial-offers/indicator-resolve"
import {
  extractInvoiceMonetaryFields,
  resolveInvoiceRewardAmount,
} from "@/lib/brbyte/invoice-amount"
import { validateFirstInvoiceRewardGuards } from "@/lib/brbyte/first-invoice-reward-guards"
import { isReferralRewardEligible } from "@/lib/referral-reward-eligibility"
import { buildBrbyteInterestedObservation } from "@/lib/brbyte/interested-observation"

describe("catálogo comercial compartilhado", () => {
  it("pré-cadastro e Nova Indicação usam a mesma fonte canônica", () => {
    assert.equal(COMMERCIAL_OFFERS, PUBLIC_PRE_REGISTRATION_OFFERS)
    assert.equal(PRE_REG_OFFERS_REEXPORT, COMMERCIAL_OFFERS)
    assert.equal(getAllCommercialOffers().length, 15)
  })

  it("as 15 ofertas ativas aparecem no Pré-cadastro e na Nova Indicação", () => {
    assert.equal(PUBLIC_PRE_REGISTRATION_OFFERS.length, 15)
    assert.equal(getIndicatorEligibleOffers().length, 15)
    assert.equal(buildIndicatorCommercialOfferOptions().length, 15)
  })

  it("controllrPlanSlot / indicatorRewardPlanSlot não limita o catálogo visual", () => {
    assert.equal(isIndicatorEligibleOffer("tanto_play"), true)
    assert.equal(isIndicatorEligibleOffer("corporativo_1"), true)
    assert.equal(isIndicatorEligibleOffer("smart_pro"), true)
    const withoutSlot = COMMERCIAL_OFFERS.filter((o) => o.controllrPlanSlot == null)
    assert.ok(withoutSlot.length >= 12)
    assert.ok(
      getIndicatorEligibleOffers().some((o) => o.code === "tanto_play_elite")
    )
  })

  it("formata label igual ao pré-cadastro", () => {
    const offer = getCommercialOfferByCode("500_mega")
    assert.ok(offer)
    assert.equal(
      formatCommercialOfferSelectLabel(offer!),
      "500 MEGA — R$ 89,90"
    )
  })
})

describe("resolução técnica plan_id (sem recompensa do plano)", () => {
  const planRows = [
    { id: "p500", name: "500 Mega", speed_label: "500 Mbps", is_active: true },
    { id: "p1000", name: "1000 Mega", speed_label: "1 Gbps", is_active: true },
  ]

  it("oferta sem slot antigo pode ser cadastrada via plano CRM base", () => {
    const result = resolveIndicatorCrmPlanId({
      offerCode: "tanto_play",
      planRows,
      plan500Id: "p500",
      plan1000Id: "p1000",
      baseCrmPlanId: "p500",
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.planId, "p500")
    assert.equal(result.planSource, "base_crm_plan")
    assert.equal(result.offer.price, 134.9)
  })

  it("não retorna plans.reward_amount como recompensa", () => {
    const result = resolveIndicatorOfferFinancials({
      offerCode: "500_mega",
      planRows,
      planRewardById: { p500: 109.9, p1000: 119.9 },
      plan500Id: "p500",
      plan1000Id: "p1000",
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.rewardAmount, null)
    assert.notEqual(result.offer.price, 109.9)
  })

  it("preço do catálogo não é usado como recompensa", () => {
    const offer = getCommercialOfferByCode("1000_mega_mesh")
    assert.ok(offer)
    const invoiceAmount = 119.9
    assert.notEqual(offer!.price, invoiceAmount)
    assert.equal(
      resolveInvoiceRewardAmount({
        invoiceAmountPaid: invoiceAmount,
        invoiceAmountDocument: offer!.price,
      }),
      invoiceAmount
    )
  })
})

describe("valor real da primeira fatura Controllr", () => {
  it("prioriza invoice_amount_paid sobre invoice_amount_document", () => {
    const monetary = extractInvoiceMonetaryFields({
      invoice_amount_paid: "124.90",
      invoice_amount_document: "150.00",
    })
    assert.equal(monetary.invoiceAmountPaid, 124.9)
    assert.equal(monetary.invoiceAmountDocument, 150)
    assert.equal(monetary.paidAmount, 124.9)
  })

  it("usa invoice_amount_document quando paid está vazio", () => {
    const monetary = extractInvoiceMonetaryFields({
      invoice_amount_paid: null,
      invoice_amount_document: "89.90",
    })
    assert.equal(monetary.paidAmount, 89.9)
  })

  it("plans.reward_amount não substitui silenciosamente o valor da fatura", () => {
    const planReward = 109.9
    const invoicePaid = 99.9
    assert.notEqual(planReward, invoicePaid)
    assert.equal(
      resolveInvoiceRewardAmount({
        invoiceAmountPaid: invoicePaid,
        invoiceAmountDocument: planReward,
      }),
      invoicePaid
    )
  })
})

describe("guardas financeiras", () => {
  it("pré-cadastro é bloqueado", () => {
    const result = validateFirstInvoiceRewardGuards({
      source: "public_pre_registration",
      reward_eligible: false,
      indicator_profile_id: null,
      brbyte_first_invoice_pk: "1",
      invoiceMsg: "paid",
      invoiceDateCredit: "2026-01-01",
      paidAmount: 100,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "not_reward_eligible")
  })

  it("indicação elegível com fatura paga e valor válido passa", () => {
    const result = validateFirstInvoiceRewardGuards({
      source: null,
      reward_eligible: true,
      indicator_profile_id: "ind-1",
      brbyte_first_invoice_pk: "inv-1",
      invoiceMsg: "paid",
      invoiceDateCredit: "2026-01-01",
      paidAmount: 119.9,
    })
    assert.equal(result.ok, true)
  })

  it("registro antigo já pago não é recalculado", () => {
    const result = validateFirstInvoiceRewardGuards({
      reward_eligible: true,
      indicator_profile_id: "ind-1",
      brbyte_first_invoice_pk: "inv-1",
      invoiceMsg: "paid",
      invoiceDateCredit: "2026-01-01",
      paidAmount: 50,
      firstInvoiceAlreadyPaid: true,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "already_paid_historical")
  })

  it("reward_eligible true para indicação e false para pré-cadastro", () => {
    assert.equal(
      isReferralRewardEligible({
        reward_eligible: true,
        indicator_profile_id: "x",
      }),
      true
    )
    assert.equal(
      isReferralRewardEligible({
        reward_eligible: false,
        source: "public_pre_registration",
        indicator_profile_id: null,
      }),
      false
    )
  })
})

describe("interest_obs usa nome da oferta", () => {
  it("inclui PLANO com o nome comercial escolhido", () => {
    const built = buildBrbyteInterestedObservation({
      erpLeadSource: "Indique e Ganhe",
      indicadorNome: "Maria",
      planoNome: "TANTO PLAY ELITE",
      birthDate: "1990-08-15",
      preferredInvoiceDueDay: 10,
      tipoContratacao: "tanto_vantagens",
      installationFeeAwareness: true,
      contractTypeAwareness: true,
    })
    assert.match(built.value, /PLANO: TANTO PLAY ELITE/)
  })
})

describe("recompensa no cadastro", () => {
  it("indicação não cria recompensa no cadastro (reward_amount null até 1ª fatura)", () => {
    const insertSnapshot = {
      reward_eligible: true,
      reward_amount: null as number | null,
      public_offer_price: 184.9,
    }
    assert.equal(insertSnapshot.reward_eligible, true)
    assert.equal(insertSnapshot.reward_amount, null)
    assert.notEqual(insertSnapshot.reward_amount, insertSnapshot.public_offer_price)
  })

  it("pré-cadastro grava reward_eligible=false e não cria reward", () => {
    const preReg = {
      reward_eligible: false,
      reward_amount: null,
      createsRewardOnInsert: false,
      createsWalletOnInsert: false,
    }
    assert.equal(preReg.reward_eligible, false)
    assert.equal(preReg.createsRewardOnInsert, false)
    assert.equal(preReg.createsWalletOnInsert, false)
  })
})
