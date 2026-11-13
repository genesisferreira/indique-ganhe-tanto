import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { runPayrollWrite, sameOrigin } from "./handlers"

const req = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }, url = "https://crm.tantotelecom.com.br/api"): {
  url: string
  headers: { get(name: string): string | null }
  text(): Promise<string>
} => ({
  url,
  headers: { get: (n) => headers[n.toLowerCase()] ?? headers[n] ?? null },
  text: async () => JSON.stringify(body),
})

describe("3.1F-J5 handlers", () => {
  it("same-origin e consulta/unauth bloqueados sem RPC", async () => {
    assert.equal(sameOrigin(req({}, { origin: "https://evil.example", host: "crm.tantotelecom.com.br" })), false)
    assert.equal(sameOrigin(req({}, { origin: "https://crm.tantotelecom.com.br", host: "crm.tantotelecom.com.br" })), true)
    const unauth = await runPayrollWrite("approve", { ok: false, status: 401 }, { rpc: async () => ({ data: null, error: null }) }, req({}))
    assert.equal(unauth.body.code, "unauthenticated")
    const forb = await runPayrollWrite("approve", { ok: false, status: 403 }, { rpc: async () => ({ data: null, error: null }) }, req({}))
    assert.equal(forb.body.code, "forbidden")
  })
  it("payload fechado: chave extra não chega na RPC", async () => {
    let called = 0
    const client = { rpc: async () => { called += 1; return { data: { ok: true }, error: null } } }
    const out = await runPayrollWrite("approve", { ok: true }, client, req({
      idempotencyKey: "abcdefghijklmnop",
      profileId: "11111111-1111-4111-8111-111111111111",
      active: true,
    }))
    assert.equal(called, 0)
    assert.equal(out.body.code, "unknown_field")
  })
  it("erro de RPC 42501 vira forbidden e timeout não vira lista", async () => {
    const client = { rpc: async () => ({ data: null, error: { code: "42501" } }) }
    const out = await runPayrollWrite("open", { ok: true }, client, req({
      idempotencyKey: "abcdefghijklmnop",
      employeeId: "11111111-1111-4111-8111-111111111111",
      competenceMonth: "2026-10-01",
    }))
    assert.equal(out.body.code, "forbidden")
    const boom = await runPayrollWrite("open", { ok: true }, null, req({}))
    assert.equal(boom.body.code, "unavailable")
    assert.equal(Array.isArray(boom.body.items), false)
  })
})
