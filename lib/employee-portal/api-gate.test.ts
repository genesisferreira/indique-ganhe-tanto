import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  EMPLOYEE_API,
  evaluateEmployeeEligibility,
  runEmployeeGet,
  type EmployeeApiSpec,
  type EmployeeSessionClient,
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

const qs = (s: string) => new URLSearchParams(s)

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

async function call(who: Who, spec: EmployeeApiSpec<any>, q: string, path?: string) {
  const f = fakeClient(who)
  const out = await runEmployeeGet(f.client, spec, { searchParams: qs(q), path })
  return { ...out, ...f }
}

for (const route of ROUTES) {
  describe(`3.1F-J2B ${route.name}: auth → papel → validação → RPC`, () => {
    it("sem cliente de sessão => 401, 0 RPC", async () => {
      const out = await runEmployeeGet(null, route.spec, { searchParams: qs(route.valid.q), path: route.valid.path })
      assert.equal(out.status, 401)
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
    const out = await runEmployeeGet(broken, EMPLOYEE_API.dashboard, { searchParams: qs("") })
    assert.equal(out.status, 503)
    assert.equal(f.rpcCalls.length, 0)
  })
})
