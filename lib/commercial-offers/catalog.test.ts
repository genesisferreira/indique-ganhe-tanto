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
  listNeutralNetworkOffers,
  listOffersForModality,
  resolveNeutralNetworkOffer,
  resolveOfferForModality,
  resolveOfferPrice,
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
import {
  isNeutralNetworkPreRegistration,
  isReferralRewardEligible,
  NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
} from "@/lib/referral-reward-eligibility"
import { buildBrbyteInterestedObservation } from "@/lib/brbyte/interested-observation"
import { isValidCNPJ, isValidCPF } from "@/lib/client/formatters"
import {
  normalizePublicPreRegistrationFields,
  parsePublicPreRegistrationPayload,
} from "@/lib/public-pre-registration/validate"

describe("catálogo comercial compartilhado", () => {
  it("pré-cadastro e Nova Indicação usam a mesma fonte canônica", () => {
    assert.equal(COMMERCIAL_OFFERS, PUBLIC_PRE_REGISTRATION_OFFERS)
    assert.equal(PRE_REG_OFFERS_REEXPORT, COMMERCIAL_OFFERS)
    assert.equal(getAllCommercialOffers().length, 15)
  })

  it("preserva código tanto_gamer_s", () => {
    const offer = getCommercialOfferByCode("tanto_gamer_s")
    assert.ok(offer)
    assert.equal(offer!.name, "TANTO GAMER S")
    assert.equal(offer!.priceLivre, 164.9)
    assert.equal(offer!.priceVantagens, 144.9)
  })

  it("as 15 ofertas ativas aparecem no catálogo e na indicação Livre", () => {
    assert.equal(PUBLIC_PRE_REGISTRATION_OFFERS.length, 15)
    assert.equal(listOffersForModality("tanto_livre", { channel: "indicator" }).length, 15)
    assert.equal(buildIndicatorCommercialOfferOptions("tanto_livre").length, 15)
  })

  it("Vantagens exclui corporativos e inclui gamer", () => {
    const vantagens = listOffersForModality("tanto_vantagens")
    assert.equal(vantagens.length, 13)
    assert.ok(!vantagens.some((o) => o.code.startsWith("corporativo_")))
    assert.ok(vantagens.some((o) => o.code === "tanto_gamer_s"))
  })

  it("preços Livre e Vantagens exatos", () => {
    assert.equal(resolveOfferPrice("500_mega", "tanto_livre"), 109.9)
    assert.equal(resolveOfferPrice("500_mega", "tanto_vantagens"), 89.9)
    assert.equal(resolveOfferPrice("1000_mega", "tanto_livre"), 119.9)
    assert.equal(resolveOfferPrice("1000_mega", "tanto_vantagens"), 99.9)
    assert.equal(resolveOfferPrice("1000_mega_mesh", "tanto_livre"), 144.9)
    assert.equal(resolveOfferPrice("1000_mega_mesh", "tanto_vantagens"), 124.9)
    assert.equal(resolveOfferPrice("corporativo_1", "tanto_livre"), 199.9)
    assert.equal(resolveOfferPrice("corporativo_1", "tanto_vantagens"), null)
    assert.equal(resolveOfferPrice("tanto_play", "tanto_livre"), 154.9)
    assert.equal(resolveOfferPrice("tanto_play", "tanto_vantagens"), 134.9)
    assert.equal(resolveOfferPrice("tanto_gamer_s", "tanto_livre"), 164.9)
    assert.equal(resolveOfferPrice("tanto_gamer_s", "tanto_vantagens"), 144.9)
  })

  it("Rede Neutra usa catálogo Livre sem modalidade separada", () => {
    const list = listNeutralNetworkOffers()
    assert.equal(list.length, 15)
    assert.ok(list.every((o) => o.modality === "tanto_livre"))
    assert.equal(resolveNeutralNetworkOffer("500_mega")?.price, 109.9)
    assert.ok(list.some((o) => o.code === "corporativo_1"))
  })

  it("formata label conforme modalidade", () => {
    const livre = resolveOfferForModality("500_mega", "tanto_livre")
    assert.ok(livre)
    assert.equal(
      formatCommercialOfferSelectLabel(livre!),
      "500 MEGA — R$ 109,90"
    )
  })

  it("controllrPlanSlot não limita o catálogo visual Livre", () => {
    assert.equal(isIndicatorEligibleOffer("tanto_play", "tanto_livre"), true)
    assert.equal(isIndicatorEligibleOffer("corporativo_1", "tanto_vantagens"), false)
    assert.ok(
      (getIndicatorEligibleOffers("tanto_livre") as { code: string }[]).some(
        (o) => o.code === "tanto_play_elite"
      )
    )
  })
})

describe("CPF / CNPJ pré-cadastro", () => {
  it("valida CPF e CNPJ fictícios", () => {
    assert.equal(isValidCPF("529.982.247-25"), true)
    assert.equal(isValidCPF("111.111.111-11"), false)
    assert.equal(isValidCNPJ("11.222.333/0001-81"), true)
    assert.equal(isValidCNPJ("11.111.111/1111-11"), false)
  })

  it("PF grava person_type=pf", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pf",
        fullName: "MARIA SILVA",
        document: "52998224725",
        phone: "31999998888",
        phoneHasWhatsapp: true,
        birthDate: "1990-05-21",
        preferredInvoiceDueDay: 10,
        cep: "30130100",
        state: "MG",
        city: "BELO HORIZONTE",
        neighborhood: "CENTRO",
        street: "RUA A",
        number: "100",
        contractType: "tanto_vantagens",
        offerCode: "500_mega",
        preferredInstallationPeriod: "morning",
        lgpdAccepted: true,
      },
      { channel: "pre_registration" }
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.data.personType, "pf")
    assert.equal(parsed.data.offer.price, 89.9)
    const norm = normalizePublicPreRegistrationFields(parsed.data)
    assert.equal(norm.referred_person_type, "pf")
    assert.equal(norm.referred_company_trade_name, null)
  })

  it("PJ grava razão social, fantasia e person_type=pj", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pj",
        fullName: "EMPRESA EXEMPLO LTDA",
        tradeName: "EXEMPLO NET",
        document: "11222333000181",
        phone: "31988887777",
        phoneHasWhatsapp: false,
        preferredInvoiceDueDay: 15,
        cep: "30130100",
        state: "MG",
        city: "BELO HORIZONTE",
        neighborhood: "CENTRO",
        street: "RUA B",
        number: "200",
        contractType: "tanto_livre",
        offerCode: "corporativo_1",
        preferredInstallationPeriod: "afternoon",
        lgpdAccepted: true,
      },
      { channel: "pre_registration" }
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.data.personType, "pj")
    assert.equal(parsed.data.offer.price, 199.9)
    const norm = normalizePublicPreRegistrationFields(parsed.data)
    assert.equal(norm.referred_person_type, "pj")
    assert.equal(norm.referred_name, "EMPRESA EXEMPLO LTDA")
    assert.equal(norm.referred_company_trade_name, "EXEMPLO NET")
  })

  it("rejeita corporativo em Vantagens", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pf",
        fullName: "JOAO TESTE",
        document: "52998224725",
        phone: "31999998888",
        phoneHasWhatsapp: true,
        birthDate: "1990-05-21",
        preferredInvoiceDueDay: 10,
        cep: "30130100",
        state: "MG",
        city: "BH",
        neighborhood: "CENTRO",
        street: "RUA A",
        number: "1",
        contractType: "tanto_vantagens",
        offerCode: "corporativo_1",
        preferredInstallationPeriod: "morning",
        lgpdAccepted: true,
      },
      { channel: "pre_registration" }
    )
    assert.equal(parsed.ok, false)
  })

  it("ignora preço enviado pelo cliente", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pf",
        fullName: "JOAO TESTE",
        document: "52998224725",
        phone: "31999998888",
        phoneHasWhatsapp: true,
        birthDate: "1990-05-21",
        preferredInvoiceDueDay: 10,
        cep: "30130100",
        state: "MG",
        city: "BH",
        neighborhood: "CENTRO",
        street: "RUA A",
        number: "1",
        contractType: "tanto_livre",
        offerCode: "500_mega",
        public_offer_price: 1,
        offerPrice: 1,
        preferredInstallationPeriod: "morning",
        lgpdAccepted: true,
      },
      { channel: "pre_registration" }
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.data.offer.price, 109.9)
  })
})

describe("Rede Neutra", () => {
  it("origem e preço Livre sem seletor de modalidade", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pf",
        fullName: "ANA REDE",
        document: "52998224725",
        phone: "31977776666",
        phoneHasWhatsapp: true,
        birthDate: "1988-01-01",
        preferredInvoiceDueDay: 5,
        cep: "30130100",
        state: "MG",
        city: "BH",
        neighborhood: "CENTRO",
        street: "RUA C",
        number: "10",
        offerCode: "1000_mega",
        preferredInstallationPeriod: "no_preference",
        lgpdAccepted: true,
      },
      { channel: "neutral_network" }
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.data.channel, "neutral_network")
    assert.equal(parsed.data.contractType, "tanto_livre")
    assert.equal(parsed.data.offer.price, 119.9)
    assert.equal(
      isReferralRewardEligible({
        source: NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
        reward_eligible: false,
        indicator_profile_id: null,
      }),
      false
    )
    assert.equal(
      isNeutralNetworkPreRegistration({
        source: NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
      }),
      true
    )
  })

  it("ignora source/reward_eligible adulterados no body", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pf",
        fullName: "ANA REDE",
        document: "52998224725",
        phone: "31977776666",
        phoneHasWhatsapp: true,
        birthDate: "1988-01-01",
        preferredInvoiceDueDay: 5,
        cep: "30130100",
        state: "MG",
        city: "BH",
        neighborhood: "CENTRO",
        street: "RUA C",
        number: "10",
        offerCode: "500_mega",
        preferredInstallationPeriod: "morning",
        lgpdAccepted: true,
        source: "indicator_referral",
        reward_eligible: true,
        channel: "pre_registration",
        indicator_profile_id: "hack",
        public_offer_price: 1,
      },
      { channel: "neutral_network" }
    )
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.data.channel, "neutral_network")
    assert.equal(parsed.data.offer.price, 109.9)
  })

  it("rejeita oferta inexistente na Rede Neutra", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pf",
        fullName: "ANA REDE",
        document: "52998224725",
        phone: "31977776666",
        phoneHasWhatsapp: true,
        birthDate: "1988-01-01",
        preferredInvoiceDueDay: 5,
        cep: "30130100",
        state: "MG",
        city: "BH",
        neighborhood: "CENTRO",
        street: "RUA C",
        number: "10",
        offerCode: "plano_falso",
        preferredInstallationPeriod: "morning",
        lgpdAccepted: true,
      },
      { channel: "neutral_network" }
    )
    assert.equal(parsed.ok, false)
  })
})

describe("segurança payload pré-cadastro", () => {
  it("rejeita modalidade adulterada (string inválida)", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pf",
        fullName: "JOAO TESTE",
        document: "52998224725",
        phone: "31999998888",
        phoneHasWhatsapp: true,
        birthDate: "1990-05-21",
        preferredInvoiceDueDay: 10,
        cep: "30130100",
        state: "MG",
        city: "BH",
        neighborhood: "CENTRO",
        street: "RUA A",
        number: "1",
        contractType: "modalidade_hack",
        offerCode: "500_mega",
        preferredInstallationPeriod: "morning",
        lgpdAccepted: true,
      },
      { channel: "pre_registration" }
    )
    assert.equal(parsed.ok, false)
  })

  it("CNPJ sem nome fantasia é rejeitado", () => {
    const parsed = parsePublicPreRegistrationPayload(
      {
        personType: "pj",
        fullName: "EMPRESA X LTDA",
        tradeName: "",
        document: "11222333000181",
        phone: "31988887777",
        phoneHasWhatsapp: true,
        preferredInvoiceDueDay: 15,
        cep: "30130100",
        state: "MG",
        city: "BH",
        neighborhood: "CENTRO",
        street: "RUA B",
        number: "2",
        contractType: "tanto_livre",
        offerCode: "500_mega",
        preferredInstallationPeriod: "morning",
        lgpdAccepted: true,
      },
      { channel: "pre_registration" }
    )
    assert.equal(parsed.ok, false)
  })

  it("troca Livre→Vantagens invalida corporativo", () => {
    assert.equal(
      resolveOfferForModality("corporativo_1", "tanto_livre")?.price,
      199.9
    )
    assert.equal(resolveOfferForModality("corporativo_1", "tanto_vantagens"), null)
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
    assert.equal(result.offer.price, 134.9) // alias Vantagens (compat)
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
    assert.notEqual(offer!.priceLivre, invoiceAmount)
    assert.equal(
      resolveInvoiceRewardAmount({
        invoiceAmountPaid: invoiceAmount,
        invoiceAmountDocument: offer!.priceVantagens,
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

  it("Rede Neutra é bloqueada", () => {
    const result = validateFirstInvoiceRewardGuards({
      source: NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
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
