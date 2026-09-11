import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildPasswordRecoveryRedirectTo,
  passwordResetPublicMessage,
  sanitizePasswordRecoveryNextPath,
} from "./password-reset"

describe("password-reset helpers", () => {
  it("mensagem pública é neutra", () => {
    const msg = passwordResetPublicMessage()
    assert.equal(msg.includes("cadastrado"), true)
    assert.equal(msg.toLowerCase().includes("não encontrado"), false)
    assert.equal(msg.toLowerCase().includes("inexistente"), false)
  })

  it("next de recovery só aceita /atualizar-senha", () => {
    assert.equal(sanitizePasswordRecoveryNextPath("/admin"), "/atualizar-senha")
    assert.equal(sanitizePasswordRecoveryNextPath("//evil"), "/atualizar-senha")
    assert.equal(sanitizePasswordRecoveryNextPath(null), "/atualizar-senha")
  })

  it("redirectTo usa callback same-origin", () => {
    assert.equal(
      buildPasswordRecoveryRedirectTo("https://crm.example.com"),
      "https://crm.example.com/auth/callback?next=%2Fatualizar-senha"
    )
  })
})
