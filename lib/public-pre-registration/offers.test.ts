import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildPublicPreRegistrationObservation } from "./observation"
import {
  getPublicPreRegistrationOfferByCode,
  PUBLIC_PRE_REGISTRATION_OFFERS,
} from "./offers"
import { BRBYTE_FIELD_MAX_LENGTH } from "@/lib/brbyte/truncate-field"

describe("public pre-registration offers catalog", () => {
  it("expõe exatamente 15 ofertas", () => {
    assert.equal(PUBLIC_PRE_REGISTRATION_OFFERS.length, 15)
  })

  it("resolve oferta por código e ignora preço arbitrário do client", () => {
    const offer = getPublicPreRegistrationOfferByCode("tanto_play_elite")
    assert.ok(offer)
    assert.equal(offer?.name, "TANTO PLAY ELITE")
    assert.equal(offer?.price, 184.9)
    assert.equal(offer?.displayPrice, "R$ 184,90")
  })

  it("rejeita código desconhecido", () => {
    assert.equal(getPublicPreRegistrationOfferByCode("plano_falso"), null)
  })
})

describe("buildPublicPreRegistrationObservation", () => {
  it("inclui Origem, Oferta, Valor e Instalação e respeita 255", () => {
    const result = buildPublicPreRegistrationObservation({
      preferredInstallationPeriod: "afternoon",
      offerName: "TANTO PLAY ELITE",
      offerPriceLabel: "R$ 184,90",
      birthDate: "1990-08-15",
      preferredInvoiceDueDay: 10,
      phoneHasWhatsapp: true,
      preferredContactPeriod: "morning",
      campaignSummary: "google/cpc/lancamento",
      observacaoCliente:
        "Observação muito longa do cliente para forçar truncamento do interest_obs no Controllr e validar o limite de caracteres do campo.",
    })

    assert.ok(result.value.includes("ORIGEM:"))
    assert.ok(result.value.includes("OFERTA: TANTO PLAY ELITE"))
    assert.ok(result.value.includes("VALOR: R$ 184,90"))
    assert.ok(result.value.includes("NASCIMENTO: 15/08/1990"))
    assert.ok(result.value.includes("VENCIMENTO: DIA 10"))
    assert.ok(result.value.includes("INSTALAÇÃO: TARDE"))
    assert.ok(result.value.length <= BRBYTE_FIELD_MAX_LENGTH)
  })

  it("mantém label Noite apenas para evening histórico", () => {
    const result = buildPublicPreRegistrationObservation({
      preferredInstallationPeriod: "morning",
      offerName: "500 MEGA",
      offerPriceLabel: "R$ 89,90",
      birthDate: "1985-01-02",
      preferredInvoiceDueDay: 5,
      phoneHasWhatsapp: false,
      preferredContactPeriod: "evening",
    })
    assert.ok(
      result.value.includes("CONTATO: NOITE") ||
        result.value.length <= BRBYTE_FIELD_MAX_LENGTH
    )
  })
})
