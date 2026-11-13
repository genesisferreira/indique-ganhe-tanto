import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import type { EmployeeSessionClient, EmployeeSessionResult } from "@/lib/employee-portal/api-gate"
import { MAX_BODY_BYTES, runLoadFormContext, runSubmitOpportunity, type SubmitRequest } from "@/lib/employee-opportunities/handlers"

const PLAN = "0b3c1f7e-5d2a-4c1b-9e8f-1a2b3c4d5e6f"
const OPP = "11111111-2222-4333-8444-555555555555"
type Who = "anon" | "funcionario" | "paused" | "no_employee" | "admin_master" | "comercial" | "indicador" | "auth_down"

function fake(who: Who, rpcResult: { data: unknown; error: { code?: string; message?: string } | null } = { data: { ok: true, idempotent: false, opportunityId: OPP, protocol: "11111111", attributionRole: "technician_originator", stage: "novo" }, error: null }) {
  const log: string[] = []
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const profile = who === "anon" || who === "auth_down" ? null : ["funcionario", "paused", "no_employee"].includes(who) ? { role: "funcionario", is_active: true } : { role: who, is_active: true }
  const employee = who === "funcionario" ? { status: "active" } : who === "paused" ? { status: "paused" } : null
  const client: EmployeeSessionClient = {
    auth: {
      getUser: async () => {
        log.push("auth")
        if (who === "auth_down") return { data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } }
        return { data: { user: who === "anon" ? null : { id: "u-" + who } } }
      },
    },
    from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { log.push(`select:${table}`); return { data: table === "profiles" ? profile : employee, error: null } } }) }) }),
    rpc: async (fn: string, args?: Record<string, unknown>) => { log.push(`rpc:${fn}`); rpcCalls.push({ fn, args }); return rpcResult },
  }
  return { session: { ok: true, client } as EmployeeSessionResult, log, rpcCalls }
}

const body = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: "eo_0123456789abcdef0123", planId: PLAN, name: "Maria da Silva", phone: "(31) 99876-0001", zipcode: "30140-071",
  street: "Rua A", number: "10", neighborhood: "Centro", city: "BH", consent: true, ...over,
})
function req(payload: unknown, headers: Record<string, string> = { "content-type": "application/json", origin: "https://crm.example", host: "crm.example" }): SubmitRequest & { reads: number } {
  const r = {
    url: "https://crm.example/api/employee/opportunities",
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    reads: 0,
    async text() { r.reads++; return typeof payload === "string" ? payload : JSON.stringify(payload) },
  }
  return r
}

let warns: string[] = []
const orig = console.warn
beforeEach(() => { warns = []; console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")) } })
afterEach(() => { console.warn = orig })

describe("3.1F-J3 POST /api/employee/opportunities — ordem e autorização", () => {
  it("funcionário: gate → corpo → exatamente UMA RPC com p_payload allowlisted", async () => {
    const f = fake("funcionario"); const r = req(body({ document: "" }))
    const out = await runSubmitOpportunity(f.session, r)
    assert.equal(out.status, 201)
    assert.deepEqual(f.log, ["auth", "select:profiles", "select:employees", "rpc:submit_employee_sales_opportunity"])
    assert.equal(f.rpcCalls.length, 1)
    assert.deepEqual(Object.keys(f.rpcCalls[0].args ?? {}), ["p_payload"])
    const p = f.rpcCalls[0].args?.p_payload as Record<string, unknown>
    assert.equal(p.phone, "31998760001")
    for (const k of ["employeeId", "employee_id", "profileId", "sectorId", "document"]) assert.equal(k in p, false, k)
  })
  for (const [who, status] of [["anon", 401], ["admin_master", 403], ["comercial", 403], ["indicador", 403], ["no_employee", 403], ["auth_down", 503]] as const) {
    it(`${who} => ${status} sem ler o corpo e sem RPC`, async () => {
      const f = fake(who); const r = req(body())
      const out = await runSubmitOpportunity(f.session, r)
      assert.equal(out.status, status)
      assert.equal(r.reads, 0)
      assert.equal(f.rpcCalls.length, 0)
    })
  }
  it("pausado passa o gate; a RPC decide employee_not_active (403)", async () => {
    const f = fake("paused", { data: { ok: false, code: "employee_not_active" }, error: null })
    const out = await runSubmitOpportunity(f.session, req(body()))
    assert.equal(out.status, 403)
    assert.equal(out.body.code, "employee_not_active")
  })
  it("falha ao criar cliente da sessão => 503", async () => {
    assert.equal((await runSubmitOpportunity({ ok: false, reason: "unavailable" }, req(body()))).status, 503)
  })
  it("origem cruzada => 403 sem RPC; content-type não-JSON => 400 sem RPC", async () => {
    const f = fake("funcionario")
    assert.equal((await runSubmitOpportunity(f.session, req(body(), { "content-type": "application/json", origin: "https://evil.example", host: "crm.example" }))).status, 403)
    assert.equal((await runSubmitOpportunity(f.session, req(body(), { "content-type": "application/json", origin: "https://crm.example.evil.example", host: "crm.example" }))).status, 403)
    assert.equal((await runSubmitOpportunity(f.session, req(body(), { "content-type": "application/json", origin: "null", host: "crm.example" }))).status, 403)
    assert.equal((await runSubmitOpportunity(f.session, req(body(), { "content-type": "application/x-www-form-urlencoded" }))).status, 400)
    assert.equal(f.rpcCalls.length, 0)
  })
  it("origem igual ao host público (proxy/X-Forwarded-Host) é aceita; sem Origin vale o content-type", async () => {
    const f = fake("funcionario")
    assert.equal((await runSubmitOpportunity(f.session, req(body(), { "content-type": "application/json", origin: "https://crm.example", host: "internal:3000", "x-forwarded-host": "crm.example" }))).status, 201)
    assert.equal((await runSubmitOpportunity(f.session, req(body(), { "content-type": "application/json; charset=utf-8", host: "crm.example" }))).status, 201)
    assert.equal(f.rpcCalls.length, 2)
  })
  it("corpo grande, JSON inválido, campo desconhecido ou identidade => 400 sem RPC", async () => {
    const f = fake("funcionario")
    for (const p of ["x".repeat(MAX_BODY_BYTES + 1), "{not json", body({ employeeId: "e" }), body({ profile_id: "p" }), body({ consent: false })]) {
      const out = await runSubmitOpportunity(f.session, req(p))
      assert.equal(out.status, 400, String(p).slice(0, 40))
    }
    assert.equal(f.rpcCalls.length, 0)
  })
  it("códigos da RPC repassados com status corretos", async () => {
    for (const [code, status] of [["duplicate_open", 409], ["duplicate_recent_closed", 409], ["idempotency_conflict", 409], ["role_choice_required", 422], ["role_not_eligible", 403], ["no_eligible_role", 403]] as const) {
      const f = fake("funcionario", { data: { ok: false, code, ...(code === "duplicate_recent_closed" ? { requiresConfirmation: true } : {}) }, error: null })
      const out = await runSubmitOpportunity(f.session, req(body()))
      assert.equal(out.status, status, code)
      assert.equal(out.body.code, code)
    }
  })
  it("erro de RPC: 42501 => 403; outro => 503; log só com classe/código, sem PII", async () => {
    const a = fake("funcionario", { data: null, error: { code: "42501", message: "permission denied for Maria 31998760001" } })
    assert.equal((await runSubmitOpportunity(a.session, req(body()))).status, 403)
    const b = fake("funcionario", { data: null, error: { code: "57014", message: "timeout Maria" } })
    assert.equal((await runSubmitOpportunity(b.session, req(body()))).status, 503)
    assert.ok(warns.length >= 2)
    for (const w of warns) assert.equal(/Maria|31998760001|99876|30140|Rua|permission denied|timeout/i.test(w), false, w)
  })
})

describe("3.1F-J3 contexto do formulário", () => {
  it("funcionário: uma RPC (employee_opportunity_form_context) após o gate", async () => {
    const f = fake("funcionario", { data: { employeeStatus: "active", canCreate: true, eligibleRoles: ["technician_originator"], plans: [{ id: PLAN, name: "P" }] }, error: null })
    const r = await runLoadFormContext(f.session)
    assert.equal(r.ok, true)
    assert.deepEqual(f.log, ["auth", "select:profiles", "select:employees", "rpc:employee_opportunity_form_context"])
  })
  for (const [who, kind] of [["anon", "unauthenticated"], ["indicador", "forbidden"], ["comercial", "forbidden"], ["admin_master", "forbidden"]] as const) {
    it(`${who} => ${kind} sem RPC`, async () => {
      const f = fake(who)
      const r = await runLoadFormContext(f.session)
      assert.deepEqual(r, { ok: false, kind })
      assert.equal(f.rpcCalls.length, 0)
    })
  }
})
