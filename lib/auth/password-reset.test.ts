import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildPasswordRecoveryFailurePath,
  buildPasswordRecoveryRedirectTo,
  detectRecoveryUrlError,
  gatePasswordUpdateForm,
  normalizeRecoveryEmail,
  passwordResetPublicMessage,
  passwordsMatchForUpdate,
  sanitizePasswordRecoveryNextPath,
} from "./password-reset"

describe("password-reset helpers", () => {
  it("mensagem pública é neutra e não enumera conta", () => {
    const msg = passwordResetPublicMessage()
    assert.match(msg, /Se existir uma conta/i)
    assert.equal(msg.toLowerCase().includes("não encontrado"), false)
    assert.equal(msg.toLowerCase().includes("inexistente"), false)
    assert.equal(msg.toLowerCase().includes("cadastrado"), false)
  })

  it("L) e-mail de recovery usa trim/lowercase", () => {
    assert.equal(normalizeRecoveryEmail("  Ana.FUNC@Example.COM "), "ana.func@example.com")
  })

  it("next de recovery só aceita /atualizar-senha", () => {
    assert.equal(sanitizePasswordRecoveryNextPath("/admin"), "/atualizar-senha")
    assert.equal(sanitizePasswordRecoveryNextPath("//evil"), "/atualizar-senha")
    assert.equal(sanitizePasswordRecoveryNextPath(null), "/atualizar-senha")
  })

  it("redirectTo aponta para landing same-origin sem consumir OTP", () => {
    assert.equal(
      buildPasswordRecoveryRedirectTo("https://crm.example.com"),
      "https://crm.example.com/auth/recuperar-confirmacao"
    )
  })

  it("D) otp_expired no hash bloqueia", () => {
    const reason = detectRecoveryUrlError({
      search: "",
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    })
    assert.equal(reason, "otp_expired")
    assert.equal(
      gatePasswordUpdateForm({ urlError: reason, hasAuthenticatedUser: true }).showForm,
      false
    )
  })

  it("E) access_denied bloqueia", () => {
    const reason = detectRecoveryUrlError({
      search: "",
      hash: "#error=access_denied",
    })
    assert.equal(reason, "access_denied")
    assert.equal(
      gatePasswordUpdateForm({ urlError: reason, hasAuthenticatedUser: false }).showForm,
      false
    )
  })

  it("F) recovery_error query bloqueia", () => {
    const reason = detectRecoveryUrlError({
      search: "?recovery_error=invalid_or_expired",
      hash: "",
    })
    assert.equal(reason, "invalid_or_expired")
    assert.equal(buildPasswordRecoveryFailurePath(), "/atualizar-senha?recovery_error=invalid_or_expired")
  })

  it("G) sem sessão o formulário não aparece", () => {
    assert.equal(
      gatePasswordUpdateForm({ urlError: null, hasAuthenticatedUser: false }).showForm,
      false
    )
  })

  it("H) sessão válida libera formulário", () => {
    assert.equal(
      gatePasswordUpdateForm({ urlError: null, hasAuthenticatedUser: true }).showForm,
      true
    )
  })

  it("J) senha e confirmação precisam coincidir", () => {
    assert.equal(passwordsMatchForUpdate("short", "short").ok, false)
    assert.equal(passwordsMatchForUpdate("longenough", "different1").ok, false)
    assert.equal(passwordsMatchForUpdate("longenough", "longenough").ok, true)
  })
})
