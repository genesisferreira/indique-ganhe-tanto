import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isValidPublicPreRegistrationDueDay,
  validatePublicPreRegistrationBirthDate,
  formatPublicPreRegistrationBirthDate,
  normalizePublicPreRegistrationErpTextFields,
  normalizePublicPreRegistrationText,
} from "./normalize"

describe("data de nascimento do pré-cadastro", () => {
  const today = new Date(2026, 6, 16)

  it("aceita data válida", () => {
    assert.deepEqual(
      validatePublicPreRegistrationBirthDate("1990-08-15", today),
      { ok: true, value: "1990-08-15" }
    )
    assert.equal(
      formatPublicPreRegistrationBirthDate("1990-08-15"),
      "15/08/1990"
    )
  })

  it("rejeita data futura", () => {
    assert.deepEqual(
      validatePublicPreRegistrationBirthDate("2026-07-17", today),
      { ok: false, reason: "future" }
    )
  })

  it("rejeita data de calendário inválida", () => {
    assert.deepEqual(
      validatePublicPreRegistrationBirthDate("2026-02-30", today),
      { ok: false, reason: "invalid" }
    )
  })
})

describe("dia preferido de vencimento", () => {
  it("aceita somente 05, 10, 15, 20, 25 e 30", () => {
    for (const day of [5, 10, 15, 20, 25, 30]) {
      assert.equal(isValidPublicPreRegistrationDueDay(day), true)
    }
  })

  it("rejeita vencimentos fora da lista", () => {
    for (const day of [0, 1, 6, 31, 10.5]) {
      assert.equal(isValidPublicPreRegistrationDueDay(day), false)
    }
  })
})

describe("normalização textual pública", () => {
  it("converte textos com acentos e espaços duplicados para maiúsculas", () => {
    assert.equal(
      normalizePublicPreRegistrationText("  José   da Conceição  "),
      "JOSÉ DA CONCEIÇÃO"
    )
    assert.equal(
      normalizePublicPreRegistrationText(" rua são joão, apto 2 "),
      "RUA SÃO JOÃO, APTO 2"
    )
  })

  it("normaliza nome, endereço e observação sem afetar campos técnicos", () => {
    const publicFields = {
      name: normalizePublicPreRegistrationText("Maria da Silva"),
      address: normalizePublicPreRegistrationText("Rua das Flores"),
      observation: normalizePublicPreRegistrationText("ligar após às 14h"),
    }
    const technicalFields = {
      email: "Cliente@Teste.com",
      cpf: "12345678900",
      phone: "11999999999",
      cep: "01001000",
      birthDate: "1990-08-15",
    }

    assert.deepEqual(publicFields, {
      name: "MARIA DA SILVA",
      address: "RUA DAS FLORES",
      observation: "LIGAR APÓS ÀS 14H",
    })
    assert.deepEqual(technicalFields, {
      email: "Cliente@Teste.com",
      cpf: "12345678900",
      phone: "11999999999",
      cep: "01001000",
      birthDate: "1990-08-15",
    })
  })

  it("normaliza os textos destinados ao Controllr", () => {
    assert.deepEqual(
      normalizePublicPreRegistrationErpTextFields({
        name: "José dos Santos",
        rg: "mg 12.345",
        state: "sp",
        city: "São Paulo",
        neighborhood: "Jardim América",
        street: "Rua das Acácias",
        number: "12 b",
        complement: "fundos casa 2",
      }),
      {
        name: "JOSÉ DOS SANTOS",
        rg: "MG 12.345",
        state: "SP",
        city: "SÃO PAULO",
        neighborhood: "JARDIM AMÉRICA",
        street: "RUA DAS ACÁCIAS",
        number: "12 B",
        complement: "FUNDOS CASA 2",
      }
    )
  })
})
