import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolvePasswordRecoveryCallback } from "./password-recovery-callback"

describe("password recovery callback", () => {
  it("A) code válido troca sessão e redireciona para next sanitizado", async () => {
    const exchanged: string[] = []
    const result = await resolvePasswordRecoveryCallback({
      code: "pkce-code",
      nextRaw: "/atualizar-senha",
      exchangeCodeForSession: async (code) => {
        exchanged.push(code)
        return { error: null }
      },
    })
    assert.deepEqual(exchanged, ["pkce-code"])
    assert.equal(result.ok, true)
    assert.equal(result.path, "/atualizar-senha")
  })

  it("B) exchange falho redireciona para recovery_error", async () => {
    const result = await resolvePasswordRecoveryCallback({
      code: "pkce-code",
      nextRaw: "/atualizar-senha",
      exchangeCodeForSession: async () => ({ error: { message: "invalid" } }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.path, "/atualizar-senha?recovery_error=invalid_or_expired")
    assert.equal(result.path.includes("pkce-code"), false)
  })

  it("C) sem code não finge sucesso", async () => {
    let called = false
    const result = await resolvePasswordRecoveryCallback({
      code: null,
      nextRaw: "/admin",
      exchangeCodeForSession: async () => {
        called = true
        return { error: null }
      },
    })
    assert.equal(called, false)
    assert.equal(result.ok, false)
    assert.equal(result.path, "/atualizar-senha?recovery_error=invalid_or_expired")
  })
})
