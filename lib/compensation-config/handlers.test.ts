import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { runAdminCompensationWrite, WRITE_RPC, type WriteKind } from "@/lib/compensation-config/handlers"

const KEY = "cc_0123456789abcdef0123456789abcdef"
const EMP = "11111111-2222-4333-8444-555555555555"
type Call = { fn: string; args?: Record<string, unknown> }

function client(result: { data: unknown; error: { code?: string } | null } = { data: { ok: true, idempotent: false, ruleId: EMP, version: 1, status: "draft" }, error: null }) {
  const calls: Call[] = []
  return { calls, c: { rpc: (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return Promise.resolve(result) } } }
}
function req(body: unknown, headers: Record<string, string> = {}) {
  const h = new Map(Object.entries({ "content-type": "application/json", host: "crm.lab", origin: "https://crm.lab", ...headers }).map(([k, v]) => [k.toLowerCase(), v]))
  let read = 0
  return { url: "http://localhost:3000/api/admin/remuneracao/regras", headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => { read++; return typeof body === "string" ? body : JSON.stringify(body) }, get reads() { return read } }
}
const rule = { idempotencyKey: KEY, name: "Técnico", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "31.50", effectiveFrom: "2026-12-01", reason: "Configuração inicial" }
const OK = { ok: true } as const

describe("3.1F-J4 handlers: ordem e autorização", () => {
  it("sem sessão => 401 sem ler corpo nem chamar RPC", async () => {
    const { c, calls } = client(); const r = req(rule)
    const out = await runAdminCompensationWrite("rule_save", { ok: false, status: 401 }, c, r)
    assert.equal(out.status, 401); assert.equal(calls.length, 0); assert.equal(r.reads, 0)
  })
  it("admin_consulta/funcionário (guard 403) => 403 sem RPC", async () => {
    const { c, calls } = client()
    const out = await runAdminCompensationWrite("profile_save", { ok: false, status: 403 }, c, req({}))
    assert.equal(out.status, 403); assert.equal(calls.length, 0)
  })
  it("RPC devolve forbidden (defesa no banco) => 403", async () => {
    const { c } = client({ data: { ok: false, code: "forbidden" }, error: null })
    assert.equal((await runAdminCompensationWrite("rule_save", OK, c, req(rule))).status, 403)
  })
  it("cliente indisponível => 503", async () => {
    assert.equal((await runAdminCompensationWrite("rule_save", OK, null, req(rule))).status, 503)
  })
  it("Origin de outro host => 403 sem RPC; X-Forwarded-Host aceito", async () => {
    const a = client()
    assert.equal((await runAdminCompensationWrite("rule_save", OK, a.c, req(rule, { origin: "https://evil.example" }))).status, 403)
    assert.equal(a.calls.length, 0)
    const b = client()
    assert.equal((await runAdminCompensationWrite("rule_save", OK, b.c, req(rule, { host: "localhost:3000", "x-forwarded-host": "crm.lab" }))).status, 201)
  })
  it("content-type não JSON, corpo grande ou JSON inválido => 400 sem RPC", async () => {
    const { c, calls } = client()
    assert.equal((await runAdminCompensationWrite("rule_save", OK, c, req(rule, { "content-type": "text/plain" }))).status, 400)
    assert.equal((await runAdminCompensationWrite("rule_save", OK, c, req("x".repeat(9000)))).status, 400)
    assert.equal((await runAdminCompensationWrite("rule_save", OK, c, req("{bad"))).status, 400)
    assert.equal(calls.length, 0)
  })
  it("campo desconhecido (active) => 400 sem RPC", async () => {
    const { c, calls } = client()
    const out = await runAdminCompensationWrite("rule_save", OK, c, req({ ...rule, active: true }))
    assert.equal(out.status, 400); assert.equal(out.body.code, "unknown_field"); assert.equal(calls.length, 0)
  })
})

describe("3.1F-J4 handlers: exatamente uma RPC SECURITY DEFINER", () => {
  const cases: [WriteKind, Record<string, unknown>][] = [
    ["rule_save", rule],
    ["rule_archive", { idempotencyKey: KEY, ruleId: EMP, reason: "Não utilizado" }],
    ["profile_save", { idempotencyKey: KEY, employeeId: EMP, validFrom: "2026-12-01", reason: "Contratação", salaryAmount: "2500.00", showSalary: true }],
    ["profile_archive", { idempotencyKey: KEY, profileId: EMP, reason: "Desligamento" }],
  ]
  for (const [kind, body] of cases) {
    it(`${kind} => ${WRITE_RPC[kind]}(p_payload)`, async () => {
      const { c, calls } = client()
      const out = await runAdminCompensationWrite(kind, OK, c, req(body))
      assert.equal(out.status, 201)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].fn, WRITE_RPC[kind])
      assert.deepEqual(Object.keys(calls[0].args ?? {}), ["p_payload"])
    })
  }
  it("conflitos mapeados para 409; replay idempotente => 200", async () => {
    for (const code of ["idempotency_conflict", "stale_version", "overlapping_rule"]) {
      const { c } = client({ data: { ok: false, code }, error: null })
      assert.equal((await runAdminCompensationWrite("rule_save", OK, c, req(rule))).status, 409)
    }
    const { c } = client({ data: { ok: true, idempotent: true, ruleId: EMP, version: 1 }, error: null })
    const out = await runAdminCompensationWrite("rule_save", OK, c, req(rule))
    assert.equal(out.status, 200); assert.equal(out.body.idempotent, true)
  })
  it("erro de RPC: log somente com classe (sem valores)", async () => {
    const logs: string[] = []
    const orig = console.warn
    console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(" ")) }
    try {
      const { c } = client({ data: null, error: { code: "XX000" } })
      const out = await runAdminCompensationWrite("profile_save", OK, c, req({ idempotencyKey: KEY, employeeId: EMP, validFrom: "2026-12-01", reason: "Contratação", salaryAmount: "2500.00" }))
      assert.equal(out.status, 503)
    } finally {
      console.warn = orig
    }
    assert.ok(logs.length >= 1)
    assert.equal(/2500|Contrata|11111111/.test(logs.join("\n")), false)
  })
})
