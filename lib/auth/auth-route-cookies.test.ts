import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  attachAuthCookiesToResponse,
  collectAuthCookiesFromSetAll,
} from "./auth-route-cookies"

describe("auth route cookie propagation", () => {
  it("K) Set-Cookie do Supabase é copiado para a resposta final", () => {
    const setCalls: Array<{
      name: string
      value: string
      options?: { httpOnly?: boolean; path?: string }
    }> = []
    const response = {
      cookies: {
        set(
          name: string,
          value: string,
          options?: { httpOnly?: boolean; path?: string }
        ) {
          setCalls.push({ name, value, options })
        },
      },
      headers: new Headers({
        Location: "https://crm.example.com/atualizar-senha",
      }),
    }

    const jar = collectJarThenAttach(response, [
      {
        name: "sb-example-auth-token",
        value: "session-cookie",
        options: { httpOnly: true, path: "/" },
      },
    ])

    assert.equal(jar.length, 1)
    assert.deepEqual(setCalls, [
      {
        name: "sb-example-auth-token",
        value: "session-cookie",
        options: { httpOnly: true, path: "/" },
      },
    ])
    assert.equal(response.headers.get("Location")?.includes("token_hash"), false)
    assert.equal(
      response.headers.get("Location"),
      "https://crm.example.com/atualizar-senha"
    )
  })
})

function collectJarThenAttach(
  response: {
    cookies: {
      set: (
        name: string,
        value: string,
        options?: { httpOnly?: boolean; path?: string }
      ) => void
    }
  },
  incoming: Array<{
    name: string
    value: string
    options?: { httpOnly?: boolean; path?: string }
  }>
) {
  const jar: typeof incoming = []
  collectAuthCookiesFromSetAll(jar, incoming)
  attachAuthCookiesToResponse(response, jar)
  return jar
}
