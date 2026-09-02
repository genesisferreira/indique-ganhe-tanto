import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isValidIndicatorPixKeyValue,
  normalizeIndicatorPixKeyValue,
  validateIndicatorPixKeyForSignup,
} from "./pix-key-validation"

const VALID_CPF = "529.982.247-25"
const VALID_CNPJ = "11.222.333/0001-81"
const VALID_EMAIL = "indicador@example.com"
const VALID_PHONE = "(11) 98765-4321"
const VALID_ALEATORIA = "a1b2c3d4-e5f6-4789-a012-3456789abcde"

describe("pix key validation (signup)", () => {
  it("CPF válido normaliza para 11 dígitos", () => {
    assert.equal(normalizeIndicatorPixKeyValue("cpf", VALID_CPF), "52998224725")
    assert.equal(isValidIndicatorPixKeyValue("cpf", VALID_CPF), true)
  })

  it("CPF inválido falha", () => {
    assert.equal(isValidIndicatorPixKeyValue("cpf", "111.111.111-11"), false)
    assert.equal(isValidIndicatorPixKeyValue("cpf", "123"), false)
  })

  it("CNPJ válido normaliza para 14 dígitos", () => {
    assert.equal(normalizeIndicatorPixKeyValue("cnpj", VALID_CNPJ), "11222333000181")
    assert.equal(isValidIndicatorPixKeyValue("cnpj", VALID_CNPJ), true)
  })

  it("CNPJ inválido falha", () => {
    assert.equal(isValidIndicatorPixKeyValue("cnpj", "11.111.111/1111-11"), false)
  })

  it("e-mail normaliza para lowercase e valida formato básico", () => {
    assert.equal(
      normalizeIndicatorPixKeyValue("email", "  Indicador@Example.COM "),
      "indicador@example.com"
    )
    assert.equal(isValidIndicatorPixKeyValue("email", VALID_EMAIL), true)
    assert.equal(isValidIndicatorPixKeyValue("email", "invalido"), false)
  })

  it("telefone normaliza dígitos BR e valida 10/11", () => {
    assert.equal(normalizeIndicatorPixKeyValue("telefone", VALID_PHONE), "11987654321")
    assert.equal(isValidIndicatorPixKeyValue("telefone", VALID_PHONE), true)
    assert.equal(isValidIndicatorPixKeyValue("telefone", "123"), false)
  })

  it("aleatória exige UUID (padrão Bacen)", () => {
    assert.equal(normalizeIndicatorPixKeyValue("aleatoria", VALID_ALEATORIA), VALID_ALEATORIA)
    assert.equal(isValidIndicatorPixKeyValue("aleatoria", VALID_ALEATORIA), true)
    assert.equal(isValidIndicatorPixKeyValue("aleatoria", "abc123def456"), false)
  })

  it("tipo desconhecido falha na validação de signup", () => {
    const result = validateIndicatorPixKeyForSignup("invalid", VALID_CPF)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, "invalid_pix_key_type")
    }
  })
})
