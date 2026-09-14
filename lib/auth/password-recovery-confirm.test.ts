import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { CookieOptions } from "@supabase/ssr"
import { executeRecoveryConfirm } from "./password-recovery-confirm"
import type { AuthCookieToSet } from "./auth-route-cookies"

const VALID_HASH = "c".repeat(40)

function cookies(list: AuthCookieToSet[]): AuthCookieToSet[] {
  return list
}

describe("password recovery confirm JSON", () => {
  it("sucesso retorna 200 + {ok:true} sem Location e com cookies", async () => {
    const chunkOptions: CookieOptions = {
      httpOnly: true,
      path: "/",
      secure: true,
      sameSite: "lax",
      maxAge: 3600,
    }
    const cookiesToSet = cookies([
      {
        name: "sb-example-auth-token.0",
        value: "chunk-zero",
        options: chunkOptions,
      },
      {
        name: "sb-example-auth-token.1",
        value: "chunk-one",
        options: chunkOptions,
      },
    ])

    const response = await executeRecoveryConfirm({
      body: { token_hash: VALID_HASH, type: "recovery" },
      cookiesToSet,
      verifyOtp: async () => ({ error: null }),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true)
    assert.equal(response.headers.get("location"), null)
    assert.match(response.headers.get("cache-control") ?? "", /no-store/)
    const body = (await response.json()) as { ok: boolean }
    assert.deepEqual(body, { ok: true })
    assert.equal(response.cookies.get("sb-example-auth-token.0")?.value, "chunk-zero")
    assert.equal(response.cookies.get("sb-example-auth-token.1")?.value, "chunk-one")
  })

  it("verifyOtp com erro retorna 200 {ok:false} sem publicar sessão", async () => {
    const cookiesToSet = cookies([
      {
        name: "sb-example-auth-token",
        value: "should-not-leak",
        options: { path: "/", httpOnly: true },
      },
    ])
    let called = false
    const response = await executeRecoveryConfirm({
      body: { token_hash: VALID_HASH, type: "recovery" },
      cookiesToSet,
      verifyOtp: async () => {
        called = true
        return { error: { message: "expired" } }
      },
    })
    assert.equal(called, true)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: false })
    assert.equal(response.headers.get("location"), null)
    assert.equal(response.cookies.get("sb-example-auth-token"), undefined)
    assert.match(response.headers.get("cache-control") ?? "", /no-store/)
  })

  it("entrada inválida falha 400 sem chamar verifyOtp", async () => {
    let called = false
    const response = await executeRecoveryConfirm({
      body: { token_hash: VALID_HASH, type: "email" },
      cookiesToSet: cookies([
        {
          name: "sb-example-auth-token",
          value: "nope",
          options: { path: "/" },
        },
      ]),
      verifyOtp: async () => {
        called = true
        return { error: null }
      },
    })
    assert.equal(called, false)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { ok: false })
    assert.equal(response.cookies.get("sb-example-auth-token"), undefined)
    assert.match(response.headers.get("cache-control") ?? "", /no-store/)
  })

  it("JSON malformado equivalente a body nulo falha sem verify", async () => {
    let called = false
    const response = await executeRecoveryConfirm({
      body: null,
      cookiesToSet: [],
      verifyOtp: async () => {
        called = true
        return { error: null }
      },
    })
    assert.equal(called, false)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { ok: false })
  })
})
