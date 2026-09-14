import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolvePasswordRecoveryVerifyOtp } from "./password-recovery-verify"
import { parseRecoveryConfirmBody } from "./recovery-token-fragment"

const VALID_HASH = "b".repeat(40)

describe("password recovery verifyOtp", () => {
  it("G) POST sem token não chama verifyOtp", async () => {
    let called = false
    const result = await resolvePasswordRecoveryVerifyOtp({
      parsed: parseRecoveryConfirmBody({}),
      verifyOtp: async () => {
        called = true
        return { error: null }
      },
    })
    assert.equal(called, false)
    assert.equal(result.ok, false)
    assert.equal(result.path, "/atualizar-senha?recovery_error=invalid_or_expired")
  })

  it("H) type errado fail-closed", async () => {
    let called = false
    const result = await resolvePasswordRecoveryVerifyOtp({
      parsed: parseRecoveryConfirmBody({
        token_hash: VALID_HASH,
        type: "email",
      }),
      verifyOtp: async () => {
        called = true
        return { error: null }
      },
    })
    assert.equal(called, false)
    assert.equal(result.ok, false)
    assert.equal(result.path.includes(VALID_HASH), false)
  })

  it("I) token inválido no verify vira recovery_error", async () => {
    const result = await resolvePasswordRecoveryVerifyOtp({
      parsed: parseRecoveryConfirmBody({
        token_hash: VALID_HASH,
        type: "recovery",
      }),
      verifyOtp: async () => ({ error: { message: "Token has expired or is invalid" } }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.path, "/atualizar-senha?recovery_error=invalid_or_expired")
    assert.equal(result.path.includes("Token"), false)
    assert.equal(result.path.includes(VALID_HASH), false)
  })

  it("J) verifyOtp sucesso redireciona para /atualizar-senha", async () => {
    const calls: Array<{ token_hash: string; type: string }> = []
    const result = await resolvePasswordRecoveryVerifyOtp({
      parsed: parseRecoveryConfirmBody({
        token_hash: VALID_HASH,
        type: "recovery",
        next: "/admin",
      }),
      verifyOtp: async (args) => {
        calls.push(args)
        return { error: null }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.path, "/atualizar-senha")
    assert.deepEqual(calls, [{ token_hash: VALID_HASH, type: "recovery" }])
  })

  it("P) replay do mesmo token é inválido", async () => {
    let uses = 0
    const verifyOtp = async () => {
      uses += 1
      if (uses === 1) return { error: null }
      return { error: { message: "expired" } }
    }
    const parsed = parseRecoveryConfirmBody({
      token_hash: VALID_HASH,
      type: "recovery",
    })
    const first = await resolvePasswordRecoveryVerifyOtp({ parsed, verifyOtp })
    const second = await resolvePasswordRecoveryVerifyOtp({ parsed, verifyOtp })
    assert.equal(first.ok, true)
    assert.equal(second.ok, false)
    assert.equal(second.path, "/atualizar-senha?recovery_error=invalid_or_expired")
    assert.equal(uses, 2)
  })
})
