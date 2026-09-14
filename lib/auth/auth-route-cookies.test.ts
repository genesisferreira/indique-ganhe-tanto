import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  attachAuthCookiesToResponse,
  collectAuthCookiesFromSetAll,
  type AuthCookieToSet,
} from "./auth-route-cookies"

describe("auth route cookie propagation", () => {
  it("K) chunks e opções do Set-Cookie são copiados para a resposta", () => {
    const setCalls: AuthCookieToSet[] = []
    const response = {
      cookies: {
        set(name: string, value: string, options?: AuthCookieToSet["options"]) {
          setCalls.push({ name, value, options: options ?? {} })
        },
      },
    }

    const incoming: AuthCookieToSet[] = [
      {
        name: "sb-example-auth-token.0",
        value: "chunk-zero",
        options: { httpOnly: true, path: "/", maxAge: 100, sameSite: "lax" },
      },
      {
        name: "sb-example-auth-token.1",
        value: "chunk-one",
        options: { httpOnly: true, path: "/", maxAge: 100, sameSite: "lax" },
      },
    ]
    const jar: AuthCookieToSet[] = []
    collectAuthCookiesFromSetAll(jar, incoming)
    attachAuthCookiesToResponse(response, jar)

    assert.deepEqual(setCalls, incoming)
  })
})
