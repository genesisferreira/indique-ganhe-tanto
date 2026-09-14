import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createRecoveryConfirmSingleFlight,
  recoverySuccessDestination,
  submitRecoveryConfirmation,
} from "./recovery-confirm-client"

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
}

describe("recovery confirm client", () => {
  it("200 + {ok:true} sem Location é sucesso no destino fixo", async () => {
    const result = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: async () => jsonResponse({ ok: true }),
    })
    assert.equal(result.kind, "success")
    assert.equal(recoverySuccessDestination(), "/atualizar-senha")
    assert.equal(recoverySuccessDestination().includes("token"), false)
    assert.equal(recoverySuccessDestination().includes("?"), false)
    assert.equal(recoverySuccessDestination().includes("#"), false)
  })

  it("{ok:false} não é sucesso", async () => {
    const result = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: async () => jsonResponse({ ok: false }),
    })
    assert.equal(result.kind, "invalid_or_expired")
  })

  it("JSON inválido e rede não viram sucesso", async () => {
    const invalidJson = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: async () =>
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    })
    assert.equal(invalidJson.kind, "protocol_failure")

    const network = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch")
      },
    })
    assert.equal(network.kind, "protocol_failure")
  })

  it("redirect inesperado falha fechado", async () => {
    const result = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: async (_input, init) => {
        assert.equal(init?.redirect, "error")
        throw new TypeError("redirect")
      },
    })
    assert.equal(result.kind, "protocol_failure")
  })

  it("dois cliques simultâneos produzem somente um POST", async () => {
    let posts = 0
    const runExclusive = createRecoveryConfirmSingleFlight()
    const pending: Promise<unknown>[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const job = () =>
      runExclusive(async () => {
        posts += 1
        await gate
        return submitRecoveryConfirmation({
          tokenHash: "a".repeat(32),
          fetchImpl: async () => jsonResponse({ ok: true }),
        })
      })

    pending.push(job())
    pending.push(job())
    release()
    const outcomes = await Promise.all(pending)
    assert.equal(posts, 1)
    assert.equal(outcomes.filter((item) => item === "skipped").length, 1)
    assert.equal(
      outcomes.some(
        (item) => item !== "skipped" && (item as { kind: string }).kind === "success"
      ),
      true
    )
  })

  it("fetch nativo precisa de bind; mocks de função ocultam Illegal invocation", async () => {
    function windowBrandedFetch(
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit
    ): Promise<Response> {
      if (this !== globalThis) {
        return Promise.reject(
          new TypeError(
            "Failed to execute 'fetch' on 'Window': Illegal invocation"
          )
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }

    const unbound = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: windowBrandedFetch,
    })
    assert.equal(unbound.kind, "protocol_failure")

    const bound = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: windowBrandedFetch.bind(globalThis),
    })
    assert.equal(bound.kind, "success")
  })

  it("fetch usa POST JSON same-origin e não envia Location", async () => {
    let method = ""
    let redirect: RequestRedirect | undefined
    let credentials: RequestCredentials | undefined
    const result = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: async (_url, init) => {
        method = String(init?.method)
        redirect = init?.redirect
        credentials = init?.credentials
        return jsonResponse({ ok: true })
      },
    })
    assert.equal(result.kind, "success")
    assert.equal(method, "POST")
    assert.equal(redirect, "error")
    assert.equal(credentials, "same-origin")
  })

  it("interceptação do POST não chama rede: sucesso, invalid, falha e um POST", async () => {
    let posts = 0
    function interceptingFetch(
      this: unknown,
      _input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      if (this !== globalThis) {
        return Promise.reject(
          new TypeError(
            "Failed to execute 'fetch' on 'Window': Illegal invocation"
          )
        )
      }
      posts += 1
      assert.equal(init?.method, "POST")
      const url = String(_input)
      assert.equal(url.includes("supabase"), false)
      return Promise.resolve(jsonResponse({ ok: true }))
    }

    const bound = interceptingFetch.bind(globalThis)
    posts = 0
    const success = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: bound,
    })
    assert.equal(success.kind, "success")
    assert.equal(posts, 1)

    function interceptFalse(
      this: unknown,
      _input: RequestInfo | URL
    ): Promise<Response> {
      if (this !== globalThis) {
        return Promise.reject(new TypeError("Illegal invocation"))
      }
      posts += 1
      return Promise.resolve(jsonResponse({ ok: false }))
    }
    posts = 0
    const invalid = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: interceptFalse.bind(globalThis),
    })
    assert.equal(invalid.kind, "invalid_or_expired")
    assert.equal(posts, 1)

    function interceptNetwork(this: unknown): Promise<Response> {
      if (this !== globalThis) {
        return Promise.reject(new TypeError("Illegal invocation"))
      }
      posts += 1
      return Promise.reject(new TypeError("Failed to fetch"))
    }
    posts = 0
    const network = await submitRecoveryConfirmation({
      tokenHash: "a".repeat(32),
      fetchImpl: interceptNetwork.bind(globalThis),
    })
    assert.equal(network.kind, "protocol_failure")
    assert.equal(posts, 1)
  })
})
