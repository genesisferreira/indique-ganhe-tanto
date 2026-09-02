import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  maskCpfForDisplay,
  maskEmailForDisplay,
  maskPhoneForDisplay,
} from "./mask"

describe("commercial-assisted mask", () => {
  it("mascara telefone mostrando só os 4 últimos dígitos", () => {
    assert.equal(maskPhoneForDisplay("(11) 98765-4321"), "(**) *****-4321")
    assert.equal(maskPhoneForDisplay("11987654321"), "(**) *****-4321")
  })

  it("mascara e-mail preservando domínio", () => {
    assert.equal(maskEmailForDisplay("joao.silva@tanto.com.br"), "jo***@tanto.com.br")
    assert.equal(maskEmailForDisplay("  A@X.COM "), "a***@x.com")
  })

  it("mascara CPF mostrando só os 2 últimos dígitos", () => {
    assert.equal(maskCpfForDisplay("529.982.247-25"), "***.***.***-25")
    assert.equal(maskCpfForDisplay("52998224725"), "***.***.***-25")
  })

  it("CPF null/inválido não inventa placeholder", () => {
    assert.equal(maskCpfForDisplay(null), null)
    assert.equal(maskCpfForDisplay(""), null)
    assert.equal(maskCpfForDisplay("123"), null)
  })
})
