import assert from "node:assert/strict"
import { register } from "node:module"
import { describe, it, mock } from "node:test"

/**
 * 3.1F-J2D: testa os 5 route handlers REAIS (com NextResponse e cabeçalhos reais), simulando
 * somente `@/lib/supabase/server`. Requer `--experimental-test-module-mocks`; sem a flag a suíte
 * é ignorada (skip), nunca aprovada em silêncio.
 */
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { return n(s === "next/server" ? "next/server.js" : s, c) }`))

const hasModuleMocks = typeof (mock as unknown as { module?: unknown }).module === "function"

type Scenario = "create_throws" | "no_session" | "invalid_jwt" | "getuser_throws" | "profile_throws" | "employee_throws" | "denied" | "authorized"

const state = { scenario: "authorized" as Scenario, rpc: 0, writes: 0, log: [] as string[] }
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"])

function fakeSupabase() {
  const s = state.scenario
  if (s === "create_throws") throw new Error("SECRET_CREATE_DETAIL cookie=sb-x token=eyJ.a.b")
  const builder = (table: string) =>
    new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (WRITE_METHODS.has(prop)) { state.writes++; return () => { throw new Error("write") } }
          if (prop === "select") return () => ({
            eq: () => ({
              maybeSingle: async () => {
                state.log.push(`select:${table}`)
                if (table === "profiles" && s === "profile_throws") throw new Error("SECRET_DB relation profiles")
                if (table === "employees" && s === "employee_throws") throw new Error("SECRET_DB relation employees")
                if (table === "profiles") return { data: { role: s === "denied" ? "admin_consulta" : "funcionario", is_active: true }, error: null }
                return { data: { status: "active" }, error: null }
              },
            }),
          })
          return undefined
        },
      }
    )
  return {
    auth: {
      getUser: async () => {
        state.log.push("auth.getUser")
        if (s === "getuser_throws") throw new Error("SECRET_AUTH jwt=eyJ.c.d")
        if (s === "no_session") return { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" } }
        if (s === "invalid_jwt") return { data: { user: null }, error: { name: "AuthApiError", status: 403, message: "invalid JWT" } }
        return { data: { user: { id: "u-lab" } }, error: null }
      },
    },
    from: (table: string) => builder(table),
    rpc: async () => { state.rpc++; return { data: {}, error: null } },
  }
}

const ROUTES = [
  { name: "dashboard", mod: "@/app/api/employee/dashboard/route", spec: "dashboard", url: "http://lab.local/api/employee/dashboard" },
  { name: "sales", mod: "@/app/api/employee/sales/route", spec: "sales", url: "http://lab.local/api/employee/sales" },
  { name: "sales/[id]", mod: "@/app/api/employee/sales/[id]/route", spec: "saleDetail", url: "http://lab.local/api/employee/sales/x", param: { id: "00000000-0000-4000-8000-0000000000aa" } },
  { name: "compensation", mod: "@/app/api/employee/compensation/route", spec: "compensation", url: "http://lab.local/api/employee/compensation" },
  { name: "compensation/[competence]", mod: "@/app/api/employee/compensation/[competence]/route", spec: "competence", url: "http://lab.local/api/employee/compensation/x", param: { competence: "2026-11" } },
] as const

const MATRIX: { scenario: Scenario; status: number }[] = [
  { scenario: "create_throws", status: 503 },
  { scenario: "no_session", status: 401 },
  { scenario: "invalid_jwt", status: 401 },
  { scenario: "getuser_throws", status: 503 },
  { scenario: "profile_throws", status: 503 },
  { scenario: "employee_throws", status: 503 },
  { scenario: "denied", status: 403 },
]

describe("3.1F-J2D route handlers reais: falha de criação do cliente => 503 fechado", { skip: hasModuleMocks ? false : "requer --experimental-test-module-mocks" }, () => {
  let api: typeof import("@/lib/employee-portal/api-gate")
  const handlers: Record<string, (req: Request, ctx?: unknown) => Promise<Response>> = {}
  const parseCount: Record<string, number> = {}

  it("setup: simula somente @/lib/supabase/server", async () => {
    ;(mock as unknown as { module: (s: string, o: unknown) => void }).module("@/lib/supabase/server", {
      namedExports: { createClient: async () => fakeSupabase() },
    })
    api = await import("@/lib/employee-portal/api-gate")
    for (const r of ROUTES) {
      const spec = (api.EMPLOYEE_API as Record<string, { parse: (i: unknown) => unknown }>)[r.spec]
      const original = spec.parse
      parseCount[r.spec] = 0
      spec.parse = (i: unknown) => { parseCount[r.spec]++; return original(i) }
      handlers[r.name] = (await import(r.mod)).GET
    }
  })

  for (const r of ROUTES) {
    for (const row of [...MATRIX, { scenario: "authorized" as Scenario, status: 200 }]) {
      it(`${r.name}: ${row.scenario} => ${row.status}`, async () => {
        state.scenario = row.scenario
        state.rpc = 0
        state.writes = 0
        state.log = []
        parseCount[r.spec] = 0
        const allowed = row.scenario === "authorized"
        const counts = { url: 0, params: 0 }
        const request = {
          get url() {
            counts.url++
            if (!allowed || !state.log.includes("select:employees")) throw new Error("request.url antes do gate")
            return r.url
          },
        } as unknown as Request
        const param = "param" in r ? r.param : undefined
        const context = param
          ? { get params() { counts.params++; if (!allowed) throw new Error("params antes do gate"); return Promise.resolve(param) } }
          : undefined
        const warns: unknown[][] = []
        const original = console.warn
        console.warn = (...a: unknown[]) => { warns.push(a) }
        let res: Response
        try { res = await handlers[r.name](request, context) } finally { console.warn = original }
        const text = await res.text()
        const body = JSON.parse(text) as Record<string, unknown>
        assert.equal(res.status, row.status, text)
        assert.match(String(res.headers.get("cache-control")), /no-store/)
        assert.equal(res.headers.get("pragma"), "no-cache")
        assert.equal(res.headers.get("expires"), "0")
        assert.match(String(res.headers.get("vary")), /Cookie/)
        assert.equal(state.writes, 0)
        if (allowed) {
          assert.equal(state.rpc, 1)
          assert.equal(parseCount[r.spec], 1)
          assert.deepEqual(Object.keys(body).sort(), ["data", "ok"])
          return
        }
        assert.equal(state.rpc, 0)
        assert.equal(parseCount[r.spec], 0)
        assert.deepEqual(counts, { url: 0, params: 0 })
        if (row.status === 503) {
          assert.deepEqual(Object.keys(body).sort(), ["errorClass", "message", "ok"])
          assert.equal(body.ok, false)
          assert.equal(body.errorClass, "employee_portal_unavailable")
          assert.equal(body.message, "Não foi possível carregar os dados agora. Tente novamente.")
          assert.equal(/SECRET|eyJ|cookie|token|stack|relation|u-lab|Error/i.test(text.replace('"errorClass":"employee_portal_unavailable"', "")), false, text)
          assert.deepEqual(warns, [["[employee-portal] employee_portal_unavailable"]])
          if (row.scenario === "create_throws") assert.deepEqual(state.log, [])
        } else {
          assert.deepEqual(Object.keys(body).sort(), ["message", "ok"])
          assert.equal("errorClass" in body, false)
          assert.deepEqual(warns, [])
        }
      })
    }
  }
})
