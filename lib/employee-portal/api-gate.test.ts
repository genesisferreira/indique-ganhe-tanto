import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  EMPLOYEE_API,
  EMPLOYEE_PORTAL_UNAVAILABLE_CLASS,
  evaluateEmployeeEligibility,
  runEmployeeGet,
  type EmployeeApiSpec,
  type EmployeeSessionClient,
  type LazyApiSource,
} from "@/lib/employee-portal/api-gate"

// ---------------------------------------------------------------------------
// Cliente de sessão simulado: registra a ORDEM das chamadas e conta RPCs.
// ---------------------------------------------------------------------------
type Who = "anon" | "funcionario" | "paused" | "vacation" | "away" | "dismissed" | "no_employee" | "inactive_profile" | "admin_master" | "admin_financeiro" | "admin_consulta" | "comercial" | "indicador"

const OWN_SALE = "00000000-0000-4000-8000-0000000000aa"
const THIRD_PARTY_SALE = "00000000-0000-4000-8000-0000000000bb"
const MISSING_SALE = "00000000-0000-4000-8000-0000000000cc"

function fakeClient(who: Who) {
  const log: string[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> | undefined }[] = []
  const profile =
    who === "anon" ? null
    : who === "inactive_profile" ? { role: "funcionario", is_active: false }
    : ["funcionario", "paused", "vacation", "away", "dismissed", "no_employee"].includes(who) ? { role: "funcionario", is_active: true }
    : { role: who, is_active: true }
  const employee =
    who === "funcionario" ? { status: "active" }
    : who === "paused" || who === "vacation" || who === "away" ? { status: who }
    : who === "dismissed" ? { status: "dismissed" }
    : who === "inactive_profile" ? { status: "active" }
    : null
  const client: EmployeeSessionClient = {
    auth: {
      getUser: async () => {
        log.push("auth.getUser")
        return { data: { user: who === "anon" ? null : { id: "u-" + who } } }
      },
    },
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string) => ({
          maybeSingle: async () => {
            log.push(`select:${table}`)
            assert.ok(cols.length > 0)
            assert.ok(col === "id" || col === "profile_id")
            return { data: table === "profiles" ? profile : table === "employees" ? employee : null, error: null }
          },
        }),
      }),
    }),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      log.push(`rpc:${fn}`)
      rpcCalls.push({ fn, args })
      if (fn === "get_employee_sale_detail" && args?.p_opportunity_id !== OWN_SALE) {
        return { data: null, error: { message: "employee_portal_not_found", code: "P0001" } }
      }
      if (fn === "list_employee_competence_lines" && args?.p_competence_month !== "2026-11-01") {
        return { data: null, error: { message: "employee_portal_not_found", code: "P0001" } }
      }
      return { data: {}, error: null }
    },
  }
  return { client, log, rpcCalls }
}

type RouteCase = {
  name: string
  spec: EmployeeApiSpec<any>
  valid: { q: string; path?: string }
  invalid: { label: string; q: string; path?: string }[]
}

const ROUTES: RouteCase[] = [
  {
    name: "GET /api/employee/dashboard",
    spec: EMPLOYEE_API.dashboard,
    valid: { q: "" },
    invalid: [
      { label: "query desconhecida", q: "foo=1" },
      { label: "employee_id", q: "employee_id=x" },
    ],
  },
  {
    name: "GET /api/employee/sales",
    spec: EMPLOYEE_API.sales,
    valid: { q: "limit=10&page=2&sort=updated_desc&from=2026-01-01&to=2026-01-31" },
    invalid: [
      { label: "query desconhecida", q: "foo=1" },
      { label: "limit inválido", q: "limit=51" },
      { label: "limit zero", q: "limit=0" },
      { label: "offset inválido", q: "offset=10001" },
      { label: "offset negativo", q: "offset=-1" },
      { label: "sort inválido", q: "sort=referred_phone" },
      { label: "data inválida", q: "from=2026-02-30" },
      { label: "intervalo invertido", q: "from=2026-03-01&to=2026-02-01" },
      { label: "employee_id", q: "employee_id=x" },
    ],
  },
  {
    name: "GET /api/employee/sales/[id]",
    spec: EMPLOYEE_API.saleDetail,
    valid: { q: "", path: OWN_SALE },
    invalid: [
      { label: "UUID inválido", q: "", path: "not-a-uuid" },
      { label: "injeção no path", q: "", path: "' or 1=1 --" },
      { label: "query desconhecida", q: "foo=1", path: OWN_SALE },
    ],
  },
  {
    name: "GET /api/employee/compensation",
    spec: EMPLOYEE_API.compensation,
    valid: { q: "limit=12&offset=0" },
    invalid: [
      { label: "query desconhecida", q: "foo=1" },
      { label: "limit inválido", q: "limit=25" },
      { label: "offset inválido", q: "offset=-5" },
      { label: "profile_id", q: "profile_id=x" },
    ],
  },
  {
    name: "GET /api/employee/compensation/[competence]",
    spec: EMPLOYEE_API.competence,
    valid: { q: "", path: "2026-11" },
    invalid: [
      { label: "competência fora do primeiro dia", q: "", path: "2026-11-15" },
      { label: "competência com dia", q: "", path: "2026-11-01" },
      { label: "mês inválido", q: "", path: "2026-13" },
      { label: "query desconhecida", q: "foo=1", path: "2026-11" },
    ],
  },
]

const DENIED: Who[] = ["admin_master", "admin_financeiro", "admin_consulta", "comercial", "indicador", "no_employee"]
const INELIGIBLE: Who[] = ["dismissed", "inactive_profile"]

const ALLOWED: Who[] = ["funcionario", "paused", "vacation", "away"]

/**
 * 3.1F-J2C: Request/contexto espiões. Lançam erro se request.url for lido ou context.params
 * acessado/aguardado antes de o gate liberar (funcionário elegível + leitura de employees concluída).
 */
function spySource(spec: EmployeeApiSpec<any>, q: string, path: string | undefined, gatePassed: () => boolean) {
  const counts = { url: 0, params: 0, parse: 0 }
  const request = {
    get url() {
      counts.url++
      if (!gatePassed()) throw new Error("request.url lido antes do gate")
      return `http://lab.local/api/employee/x${q ? "?" + q : ""}`
    },
  }
  const source: LazyApiSource = { request }
  if (spec.pathParam) {
    const key = spec.pathParam
    source.context = {
      get params() {
        counts.params++
        if (!gatePassed()) throw new Error("context.params acessado antes do gate")
        return Promise.resolve({ [key]: path ?? "" })
      },
    }
  }
  const spied: EmployeeApiSpec<any> = { ...spec, parse: (input) => { counts.parse++; return spec.parse(input) } }
  return { source, spied, counts }
}

async function call(who: Who, spec: EmployeeApiSpec<any>, q: string, path?: string, client?: (f: ReturnType<typeof fakeClient>) => EmployeeSessionClient | null) {
  const f = fakeClient(who)
  const gatePassed = () => ALLOWED.includes(who) && f.log.includes("select:employees")
  const { source, spied, counts } = spySource(spec, q, path, gatePassed)
  const out = await runEmployeeGet(client ? client(f) : f.client, spied, source)
  return { ...out, ...f, counts }
}

for (const route of ROUTES) {
  describe(`3.1F-J2B ${route.name}: auth → papel → validação → RPC`, () => {
    it("sem cliente de sessão => 401, 0 RPC", async () => {
      const r = await call("anon", route.spec, route.valid.q, route.valid.path, () => null)
      assert.equal(r.status, 401)
      assert.deepEqual(r.counts, { url: 0, params: 0, parse: 0 })
    })
    it("ausente + válido => 401, 0 RPC, nenhuma leitura", async () => {
      const r = await call("anon", route.spec, route.valid.q, route.valid.path)
      assert.equal(r.status, 401)
      assert.equal(r.rpcCalls.length, 0)
      assert.deepEqual(r.log, ["auth.getUser"])
    })
    for (const bad of route.invalid) {
      it(`ausente + inválido (${bad.label}) => 401 sem mensagem de validação, 0 RPC`, async () => {
        const r = await call("anon", route.spec, bad.q, bad.path)
        assert.equal(r.status, 401)
        assert.equal(r.rpcCalls.length, 0)
        assert.equal(r.body.message, "Sessão não encontrada. Faça login novamente.")
      })
    }
    for (const who of DENIED) {
      it(`papel recusado (${who}) + válido => 403, 0 RPC`, async () => {
        const r = await call(who, route.spec, route.valid.q, route.valid.path)
        assert.equal(r.status, 403)
        assert.equal(r.rpcCalls.length, 0)
      })
      for (const bad of route.invalid) {
        it(`papel recusado (${who}) + inválido (${bad.label}) => 403, 0 RPC`, async () => {
          const r = await call(who, route.spec, bad.q, bad.path)
          assert.equal(r.status, 403)
          assert.equal(r.rpcCalls.length, 0)
          assert.equal(r.body.message, "Acesso não permitido para este perfil.")
        })
      }
    }
    for (const who of INELIGIBLE) {
      it(`funcionário inelegível (${who}) + inválido => 403, 0 RPC`, async () => {
        const r = await call(who, route.spec, route.invalid[0].q, route.invalid[0].path)
        assert.equal(r.status, 403)
        assert.equal(r.rpcCalls.length, 0)
      })
    }
    for (const bad of route.invalid) {
      it(`autorizado + inválido (${bad.label}) => 400, 0 RPC, gate antes do parser`, async () => {
        const r = await call("funcionario", route.spec, bad.q, bad.path)
        assert.equal(r.status, 400)
        assert.equal(r.rpcCalls.length, 0)
        assert.deepEqual(r.log, ["auth.getUser", "select:profiles", "select:employees"])
      })
    }
    for (const who of ["funcionario", "paused", "vacation", "away"] as Who[]) {
      it(`autorizado (${who}) + válido => 200, exatamente 1 RPC (${route.spec.rpc}) após o gate`, async () => {
        const r = await call(who, route.spec, route.valid.q, route.valid.path)
        assert.equal(r.status, 200)
        assert.equal(r.body.ok, true)
        assert.deepEqual(Object.keys(r.body).sort(), ["data", "ok"])
        assert.equal(r.rpcCalls.length, 1)
        assert.equal(r.rpcCalls[0].fn, route.spec.rpc)
        assert.deepEqual(r.log, ["auth.getUser", "select:profiles", "select:employees", `rpc:${route.spec.rpc}`])
        for (const k of Object.keys(r.rpcCalls[0].args ?? {})) assert.equal(/employee_id|profile_id|user_id/.test(k), false)
      })
    }
  })
}

describe("3.1F-J2B registro de terceiro / inexistente (mesmo 404)", () => {
  it("venda de terceiro e venda inexistente => 404 com corpo idêntico, 1 RPC cada", async () => {
    const third = await call("funcionario", EMPLOYEE_API.saleDetail, "", THIRD_PARTY_SALE)
    const missing = await call("funcionario", EMPLOYEE_API.saleDetail, "", MISSING_SALE)
    assert.equal(third.status, 404)
    assert.equal(missing.status, 404)
    assert.deepEqual(third.body, missing.body)
    assert.equal(third.rpcCalls.length, 1)
    assert.equal(missing.rpcCalls.length, 1)
  })
  it("competência própria inexistente => 404", async () => {
    const r = await call("funcionario", EMPLOYEE_API.competence, "", "2026-10")
    assert.equal(r.status, 404)
    assert.equal(r.rpcCalls.length, 1)
  })
})

describe("3.1F-J2B política de elegibilidade igual à RPC", () => {
  it("matriz", () => {
    const p = { role: "funcionario", is_active: true }
    for (const s of ["active", "paused", "vacation", "away"]) assert.equal(evaluateEmployeeEligibility(p, { status: s }), "ok")
    for (const s of ["dismissed", "", null, "unknown"]) assert.equal(evaluateEmployeeEligibility(p, { status: s }), "forbidden")
    assert.equal(evaluateEmployeeEligibility(p, null), "forbidden")
    assert.equal(evaluateEmployeeEligibility(null, { status: "active" }), "forbidden")
    assert.equal(evaluateEmployeeEligibility({ role: "funcionario", is_active: false }, { status: "active" }), "forbidden")
    for (const role of ["admin_master", "admin_financeiro", "admin_consulta", "comercial", "indicador"]) {
      assert.equal(evaluateEmployeeEligibility({ role, is_active: true }, { status: "active" }), "forbidden")
    }
  })
  it("erro de leitura do gate => 503 sem RPC", async () => {
    const f = fakeClient("funcionario")
    const broken: EmployeeSessionClient = {
      ...f.client,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x", code: "57014" } }) }) }) }),
    }
    const out = await runEmployeeGet(broken, EMPLOYEE_API.dashboard, { request: { url: "http://lab.local/api/employee/dashboard" } })
    assert.equal(out.status, 503)
    assert.equal(f.rpcCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// 3.1F-J2C — F1 (entrada preguiçosa) e F2 (exceção => 503 fechado)
// ---------------------------------------------------------------------------
type Throwing = "getUser" | "profiles" | "employees"

function throwingClient(f: ReturnType<typeof fakeClient>, at: Throwing): EmployeeSessionClient {
  return {
    ...f.client,
    auth: {
      getUser: async () => {
        f.log.push("auth.getUser")
        if (at === "getUser") throw new Error("SECRET_AUTH_DETAIL jwt=eyJ.x.y user=u-1")
        return f.client.auth.getUser()
      },
    },
    from: (table: string) => {
      if (table === at) {
        return { select: () => ({ eq: () => ({ maybeSingle: () => { throw new Error(`SECRET_DB_DETAIL relation ${table} stack`) } }) }) }
      }
      return f.client.from(table)
    },
  }
}

async function captureWarn<T>(fn: () => Promise<T>): Promise<{ value: T; warns: unknown[][] }> {
  const original = console.warn
  const warns: unknown[][] = []
  console.warn = (...args: unknown[]) => { warns.push(args) }
  try { return { value: await fn(), warns } } finally { console.warn = original }
}

function assertClosedUnavailable(body: Record<string, unknown>) {
  assert.deepEqual(Object.keys(body).sort(), ["errorClass", "message", "ok"])
  assert.equal(body.ok, false)
  assert.equal(body.errorClass, EMPLOYEE_PORTAL_UNAVAILABLE_CLASS)
  assert.equal(body.errorClass, "employee_portal_unavailable")
  assert.equal(body.message, "Não foi possível carregar os dados agora. Tente novamente.")
  const text = JSON.stringify(body).replace('"errorClass":"employee_portal_unavailable"', "")
  assert.equal(/SECRET|jwt|eyJ|u-1|stack|relation|profiles|employees|auth|getUser|error|57014/i.test(text), false, text)
}

for (const route of ROUTES) {
  const hasParams = Boolean(route.spec.pathParam)
  describe(`3.1F-J2C ${route.name}: matriz D (URL/params/parse/RPC)`, () => {
    it("anônimo => 401, URL 0, params 0, parse 0, RPC 0", async () => {
      const r = await call("anon", route.spec, route.valid.q, route.valid.path)
      assert.equal(r.status, 401)
      assert.deepEqual(r.counts, { url: 0, params: 0, parse: 0 })
      assert.equal(r.rpcCalls.length, 0)
    })
    for (const who of [...DENIED, ...INELIGIBLE]) {
      it(`papel/vínculo negado (${who}) => 403, URL 0, params 0, parse 0, RPC 0`, async () => {
        const r = await call(who, route.spec, route.valid.q, route.valid.path)
        assert.equal(r.status, 403)
        assert.deepEqual(r.counts, { url: 0, params: 0, parse: 0 })
        assert.equal(r.rpcCalls.length, 0)
      })
    }
    for (const at of ["getUser", "profiles", "employees"] as Throwing[]) {
      it(`${at} lança => 503 fechado, URL 0, params 0, parse 0, RPC 0, log só com a classe`, async () => {
        const { value: r, warns } = await captureWarn(() => call("funcionario", route.spec, route.valid.q, route.valid.path, (f) => throwingClient(f, at)))
        assert.equal(r.status, 503)
        assertClosedUnavailable(r.body)
        assert.deepEqual(r.counts, { url: 0, params: 0, parse: 0 })
        assert.equal(r.rpcCalls.length, 0)
        assert.deepEqual(warns, [["[employee-portal] employee_portal_unavailable"]])
      })
    }
    it(`autorizado inválido => 400, URL 1, params ${hasParams ? 1 : "N/A"}, parse 1, RPC 0`, async () => {
      const bad = route.invalid[0]
      const r = await call("funcionario", route.spec, bad.q, bad.path)
      assert.equal(r.status, 400)
      assert.deepEqual(r.counts, { url: 1, params: hasParams ? 1 : 0, parse: 1 })
      assert.equal(r.rpcCalls.length, 0)
    })
    it(`autorizado válido => 200, URL 1, params ${hasParams ? 1 : "N/A"}, parse 1, RPC 1; schema de sucesso idêntico`, async () => {
      const r = await call("funcionario", route.spec, route.valid.q, route.valid.path)
      assert.equal(r.status, 200)
      assert.deepEqual(r.counts, { url: 1, params: hasParams ? 1 : 0, parse: 1 })
      assert.equal(r.rpcCalls.length, 1)
      assert.deepEqual(r.body, { ok: true, data: route.spec.map({}) })
    })
  })
}

describe("3.1F-J2C erros RETORNADOS (sem exceção): fail-closed sem ausência silenciosa", () => {
  const withAuth = (error: Record<string, unknown> | null) => (f: ReturnType<typeof fakeClient>): EmployeeSessionClient => ({
    ...f.client,
    auth: { getUser: async () => { f.log.push("auth.getUser"); return { data: { user: null }, error } } },
  })
  it("sem sessão normal (AuthSessionMissingError 400) => 401, não 503", async () => {
    const r = await call("funcionario", EMPLOYEE_API.dashboard, "", undefined, withAuth({ name: "AuthSessionMissingError", status: 400, message: "x" }))
    assert.equal(r.status, 401)
    assert.deepEqual(r.counts, { url: 0, params: 0, parse: 0 })
  })
  it("JWT inválido (401/403) => 401", async () => {
    for (const status of [401, 403]) {
      const r = await call("funcionario", EMPLOYEE_API.dashboard, "", undefined, withAuth({ name: "AuthApiError", status, message: "x" }))
      assert.equal(r.status, 401)
    }
  })
  it("Auth indisponível (rede status 0, 5xx, AuthRetryableFetchError) => 503 fechado", async () => {
    for (const error of [{ name: "AuthRetryableFetchError", status: 0 }, { name: "AuthUnknownError", status: 500 }, { name: "AuthApiError", status: 503 }]) {
      const r = await call("funcionario", EMPLOYEE_API.saleDetail, "", OWN_SALE, withAuth(error))
      assert.equal(r.status, 503)
      assertClosedUnavailable(r.body)
      assert.deepEqual(r.counts, { url: 0, params: 0, parse: 0 })
      assert.equal(r.rpcCalls.length, 0)
    }
  })
  for (const table of ["profiles", "employees"]) {
    it(`${table} retorna erro => 503 fechado (não 403), 0 parse/RPC`, async () => {
      const r = await call("funcionario", EMPLOYEE_API.competence, "", "2026-11", (f) => ({
        ...f.client,
        from: (t: string) => t === table
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "SECRET timeout", code: "57014" } }) }) }) }
          : f.client.from(t),
      }))
      assert.equal(r.status, 503)
      assertClosedUnavailable(r.body)
      assert.deepEqual(r.counts, { url: 0, params: 0, parse: 0 })
      assert.equal(r.rpcCalls.length, 0)
    })
  }
  it("ausência comprovada (sem erro, sem linha) => 403", async () => {
    const r = await call("no_employee", EMPLOYEE_API.competence, "", "2026-11")
    assert.equal(r.status, 403)
    assert.equal(r.body.message, "Acesso não permitido para este perfil.")
  })
  it("401/403 normais mantêm o corpo anterior (sem errorClass)", async () => {
    const a = await call("anon", EMPLOYEE_API.dashboard, "")
    const d = await call("admin_master", EMPLOYEE_API.dashboard, "")
    assert.deepEqual(a.body, { ok: false, message: "Sessão não encontrada. Faça login novamente." })
    assert.deepEqual(d.body, { ok: false, message: "Acesso não permitido para este perfil." })
  })
})
