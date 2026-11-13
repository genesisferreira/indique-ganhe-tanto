import assert from "node:assert/strict"
import { before, beforeEach, describe, it, mock } from "node:test"
import {
  LAB_ADMIN_ID,
  createControlledTransport,
  fakeTimers,
  instrumentedControllers,
  labJwt,
  quiesce,
  syntheticFixture,
  waitFor,
  type TransportRule,
} from "./controlled-transport.test-helper"

/**
 * 3.1F-K1B — propagação REAL do AbortSignal até a chamada de rede.
 *
 * Cadeia exercitada (a mesma da produção; o hook repassa `ctx` sem alteração):
 *   createGuardedLoader (1 AbortController por carregamento)
 *   → loader da página (lib/admin-legacy/page-loaders | indicacoes-loader)
 *   → service (supabase-data.service: `.abortSignal(signal)`) | fetchJsonForLoader (`fetch(url, { signal })`)
 *   → supabase-js / postgrest-js REAIS → transporte controlado (no lugar da rede).
 *
 * O transporte observa o objeto `signal` recebido, o evento `abort`, a rejeição da promise e o que
 * permanece em voo. Requer --experimental-test-module-mocks (sem a flag: skip explícito, nunca "pass").
 */
const hasModuleMocks = typeof (mock as unknown as { module?: unknown }).module === "function"

type Loader = typeof import("@/lib/client/guarded-loader")
type PageLoaders = typeof import("@/lib/admin-legacy/page-loaders")
type Bundle = typeof import("@/lib/admin-legacy/indicacoes-loader")
type Svc = typeof import("@/lib/services/supabase-data.service")
let gl: Loader, pages: PageLoaders, bundle: Bundle, svc: Svc

const transport = createControlledTransport()

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const o = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug }
  console.log = console.error = console.warn = console.info = console.debug = () => {}
  try { return await fn() } finally { Object.assign(console, o) }
}

const isRest = (table: string, extra?: (u: URL) => boolean): TransportRule["match"] => ({ url }) =>
  url.pathname === `/rest/v1/${table}` && (!extra || extra(url))
const comerciaisList = isRest("profiles", (u) => u.searchParams.get("role") === "eq.comercial")
const referralsList = isRest("referrals", (u) => /referred_name/.test(u.searchParams.get("select") ?? ""))

describe("K1B — AbortSignal real até o transporte", { skip: !hasModuleMocks && "requer --experimental-test-module-mocks" }, () => {
  before(async () => {
    const { createClient } = await import("@supabase/supabase-js")
    const client = createClient("http://127.0.0.1:54329", "lab-anon-key-not-a-secret", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: transport.fetch },
    })
    // Sessão sintética local: setSession valida via GET /auth/v1/user no transporte (sem rede real).
    const { error } = await client.auth.setSession({ access_token: labJwt(LAB_ADMIN_ID), refresh_token: "lab-refresh-token" })
    assert.equal(error, null)
    ;(mock as unknown as { module: (s: string, o: unknown) => void }).module("@/lib/supabase/client", {
      namedExports: { getSupabaseClient: () => client, resetSupabaseBrowserClient: () => {}, getSupabaseAuthNetworkHint: () => null },
    })
    await quiet(async () => {
      gl = await import("@/lib/client/guarded-loader")
      pages = await import("@/lib/admin-legacy/page-loaders")
      bundle = await import("@/lib/admin-legacy/indicacoes-loader")
      svc = await import("@/lib/services/supabase-data.service")
    })
  })
  beforeEach(() => transport.reset())

  /** Monta o loader exatamente como o hook: `load: (ctx) => pageLoad(ctx)`. */
  function harness<T>(pageLoad: (ctx: { signal: AbortSignal }) => Promise<import("@/lib/client/guarded-loader").LoadOutcome<T>>) {
    const timers = fakeTimers()
    const ctrls = instrumentedControllers()
    const states: Array<{ status: string; data?: T; errorClass?: string }> = []
    const loads: AbortSignal[] = []
    const loader = gl.createGuardedLoader<T>({
      load: (ctx) => { loads.push(ctx.signal); return pageLoad(ctx) },
      onState: (s) => states.push(s as never),
      timers,
      createController: ctrls.factory,
    })
    return { loader, timers, ctrls, states, loads, statuses: () => states.map((s) => s.status) }
  }
  const comerciaisHarness = () => harness((ctx) => pages.loadComerciaisPageOutcome(ctx.signal))
  const indicacoesHarness = () => harness((ctx) => bundle.loadAdminIndicacoesBundle(ctx.signal))
  const employeesHarness = () => harness((ctx) => pages.loadEmployeesPageOutcome("status=active", ctx.signal, transport.fetch))

  describe("B1 — o request recebe exatamente o signal criado", () => {
    it("comerciais: as 4 consultas REST recebem o MESMO signal do AbortController do carregamento", async () => {
      const h = comerciaisHarness()
      await quiet(() => h.loader.run())
      assert.deepEqual(h.statuses(), ["loading", "success"])
      assert.equal(h.ctrls.created.length, 1)
      const signal = h.ctrls.created[0]!.controller.signal
      assert.equal(h.loads[0], signal)
      const rest = transport.rest()
      assert.deepEqual(rest.map((r) => r.path), ["/rest/v1/profiles", "/rest/v1/profiles", "/rest/v1/commercial_availability", "/rest/v1/referrals"])
      for (const r of rest) assert.equal(r.signal, signal, `${r.path} sem o signal do carregamento`)
      // Limitação documentada: auth-js getUser() não aceita AbortSignal (não reivindicamos cancelamento do Auth).
      const auth = transport.requests.filter((r) => r.path === "/auth/v1/user")
      assert.equal(auth.length, 1)
      assert.equal(auth[0]!.signal, undefined)
    })
    it("indicações: as 7 consultas REST do carregamento lógico recebem o MESMO signal (1 getUser)", async () => {
      const h = indicacoesHarness()
      await quiet(() => h.loader.run())
      assert.deepEqual(h.statuses(), ["loading", "success"])
      const signal = h.ctrls.created[0]!.controller.signal
      const rest = transport.rest()
      assert.equal(rest.length, 7)
      for (const r of rest) assert.equal(r.signal, signal, `${r.path}?${r.url.searchParams.get("select")?.slice(0, 30)} sem signal`)
      assert.equal(transport.requests.filter((r) => r.path === "/auth/v1/user").length, 1)
      const data = h.states.at(-1)!.data as { lista: unknown[]; comerciais: unknown[] }
      assert.equal(data.lista.length, 3)
      assert.equal(data.comerciais.length, 2)
    })
    it("funcionários: fetch recebe o MESMO signal ({ signal }) e no-store", async () => {
      transport.setRules([{ match: ({ url }) => url.pathname === "/api/admin/employees", mode: { kind: "respond", status: 200, body: { ok: true, items: [], canWrite: false } } }])
      const h = employeesHarness()
      await h.loader.run()
      assert.deepEqual(h.statuses(), ["loading", "empty"])
      assert.equal(transport.requests.length, 1)
      assert.equal(transport.requests[0]!.signal, h.ctrls.created[0]!.controller.signal)
    })
  })

  describe("B2–B5, B9, B13 — timeout aborta o request real", () => {
    for (const [name, mk, rule] of [
      ["comerciais (lista pendurada)", comerciaisHarness, comerciaisList],
      ["indicações (referrals pendurado)", indicacoesHarness, referralsList],
      ["funcionários (fetch pendurado)", employeesHarness, ({ url }: { url: URL }) => url.pathname === "/api/admin/employees"],
    ] as const) {
      it(`${name}: signal.aborted, transporte observa abort, promise rejeitada, nada em voo, estado timeout, timer limpo`, async () => {
        transport.setRules([{ match: rule, mode: { kind: "hang" } }])
        const h = (mk as () => ReturnType<typeof comerciaisHarness>)()
        const p = quiet(() => h.loader.run())
        await waitFor(() => transport.requests.some((r) => r.settled === null && rule({ url: r.url, method: r.method })))
        await quiesce(transport)
        assert.equal(transport.inflight.size, 1)
        const hung = transport.requests.find((r) => r.settled === null)!
        const signal = h.ctrls.created[0]!.controller.signal
        assert.equal(hung.signal, signal) // B1 no request pendurado
        assert.equal(signal.aborted, false)
        const before = transport.requests.length
        h.timers.fireAll() // B2: o timer chama controller.abort()
        await p
        assert.equal(signal.aborted, true)
        assert.equal(gl.loaderAbortKind(signal), "timeout")
        assert.equal(hung.abortEvents, 1) // B3
        assert.equal(hung.settled, "rejected") // B4
        assert.equal(hung.rejectName, "AbortError")
        assert.equal(transport.inflight.size, 0) // B5
        assert.equal(transport.requests.length, before, "nenhuma consulta nova após o abort")
        assert.deepEqual(h.statuses(), ["loading", "timeout"]) // B9: nunca empty/success
        assert.equal(h.timers.active, 0) // B13
        assert.equal(h.ctrls.liveListeners(), 0)
      })
    }
  })

  describe("B6, B10 — desmontagem aborta sem alerta", () => {
    for (const [name, mk, rule] of [
      ["comerciais", comerciaisHarness, comerciaisList],
      ["indicações", indicacoesHarness, referralsList],
      ["funcionários", employeesHarness, ({ url }: { url: URL }) => url.pathname === "/api/admin/employees"],
    ] as const) {
      it(`${name}: dispose => abort(disposed) observado no transporte; nenhum estado de erro/timeout emitido`, async () => {
        transport.setRules([{ match: rule, mode: { kind: "hang" } }])
        const h = (mk as () => ReturnType<typeof comerciaisHarness>)()
        const p = quiet(() => h.loader.run())
        await waitFor(() => transport.requests.some((r) => r.settled === null))
        await quiesce(transport)
        const hung = transport.requests.find((r) => r.settled === null)!
        h.loader.dispose()
        await p
        const signal = h.ctrls.created[0]!.controller.signal
        assert.equal(gl.loaderAbortKind(signal), "disposed") // distinguível de timeout
        assert.equal(hung.abortEvents, 1)
        assert.equal(hung.settled, "rejected")
        assert.equal(transport.inflight.size, 0)
        assert.deepEqual(h.statuses(), ["loading"]) // sem alerta após desmontar
        assert.equal(h.timers.active, 0)
      })
    }
  })

  describe("B7, B8 — retry e resposta antiga", () => {
    it("retry manual aborta o request anterior ANTES de iniciar o próximo", async () => {
      transport.setRules([{ match: comerciaisList, mode: { kind: "hang" }, times: 1 }])
      const h = comerciaisHarness()
      const p1 = quiet(() => h.loader.run())
      await waitFor(() => transport.requests.some((r) => r.settled === null))
      const hung = transport.requests.find((r) => r.settled === null)!
      const reqsBefore = transport.requests.length
      const p2 = quiet(() => h.loader.retry())
      await p2
      const first = h.ctrls.created[0]!.controller.signal
      assert.equal(gl.loaderAbortKind(first), "superseded", "retry deve abortar o request anterior")
      assert.equal(hung.abortEvents, 1, "transporte deve observar o abort do request anterior")
      await p1
      const abortAt = transport.events.indexOf(`abort:${hung.id}`)
      const nextReqAt = transport.events.indexOf(`req:${reqsBefore + 1}:${transport.requests[reqsBefore]!.path}`)
      assert.ok(abortAt >= 0 && abortAt < nextReqAt, `abort (${abortAt}) deve preceder o novo request (${nextReqAt})`)
      assert.equal(hung.settled, "rejected")
      for (const r of transport.requests.slice(reqsBefore).filter((x) => x.path.startsWith("/rest/"))) {
        assert.equal(r.signal, h.ctrls.created[1]!.controller.signal)
      }
      assert.deepEqual(h.statuses(), ["loading", "loading", "success"])
      assert.equal(transport.inflight.size, 0)
      assert.equal(h.timers.active, 0)
    })
    it("biblioteca que não cancela (abort ignorado): a resposta antiga NÃO sobrescreve a nova", async () => {
      const old = syntheticFixture()
      transport.setRules([{ match: comerciaisList, mode: { kind: "ignoreAbort", status: 200, body: [{ ...old.comerciais[0], id: "99999999-0000-4000-8000-0000000000ff", full_name: "Resposta Antiga" }] }, times: 1 }])
      const h = comerciaisHarness()
      const p1 = quiet(() => h.loader.run())
      await waitFor(() => transport.requests.some((r) => r.settled === null))
      const stale = transport.requests.find((r) => r.settled === null)!
      const p2 = quiet(() => h.loader.retry())
      await p2
      assert.equal(stale.abortEvents, 1) // o abort chegou, mas o transporte o ignora
      transport.release(stale.id) // resposta antiga chega depois
      await p1
      await waitFor(() => transport.inflight.size === 0)
      const last = h.states.at(-1)!
      assert.equal(last.status, "success")
      assert.ok((last.data as Array<{ nome: string }>).every((c) => c.nome !== "Resposta Antiga"))
      assert.deepEqual(h.statuses(), ["loading", "loading", "success"])
    })
  })

  describe("B11, B12 — timer limpo em sucesso e erro", () => {
    it("sucesso limpa o timer", async () => {
      const h = comerciaisHarness()
      await quiet(() => h.loader.run())
      assert.equal(h.timers.created, 1)
      assert.equal(h.timers.active, 0)
    })
    it("erro HTTP 500 => error server_error (nunca vazio) e timer limpo", async () => {
      transport.setRules([{ match: comerciaisList, mode: { kind: "respond", status: 500, body: { code: "XX000", message: "lab", details: null, hint: null } } }])
      const h = comerciaisHarness()
      await quiet(() => h.loader.run())
      assert.deepEqual(h.states.at(-1), { status: "error", errorClass: "server_error" })
      assert.equal(h.timers.active, 0)
    })
  })

  describe("B14 — múltiplos retries não acumulam listeners/timers/requests", () => {
    it("10 retries com request pendurado + sucesso final: 1 controller por carregamento, todos abortados, 0 listeners vivos, 0 timers, 0 em voo", async () => {
      transport.setRules([{ match: comerciaisList, mode: { kind: "hang" }, times: 10 }])
      const h = comerciaisHarness()
      const runs: Promise<void>[] = [quiet(() => h.loader.run())]
      for (let i = 0; i < 10; i++) {
        await waitFor(() => transport.requests.some((r) => r.settled === null))
        runs.push(quiet(() => h.loader.retry()))
      }
      await Promise.all(runs)
      assert.equal(h.ctrls.created.length, 11)
      for (const c of h.ctrls.created.slice(0, 10)) assert.equal(gl.loaderAbortKind(c.controller.signal), "superseded")
      assert.equal(h.ctrls.created[10]!.controller.signal.aborted, false)
      const hung = transport.requests.filter((r) => comerciaisList({ url: r.url, method: r.method }) && r.rejectName === "AbortError")
      assert.equal(hung.length, 10)
      assert.ok(hung.every((r) => r.abortEvents === 1))
      assert.equal(transport.inflight.size, 0)
      assert.equal(h.ctrls.liveListeners(), 0)
      assert.equal(h.timers.active, 0)
      assert.equal(h.timers.created, 11)
      assert.equal(h.states.at(-1)!.status, "success")
    })
  })

  describe("Services — abort nunca vira vazio nem sucesso parcial", () => {
    const identity = { userId: LAB_ADMIN_ID, role: "admin_master" as const }
    for (const [name, rule] of [
      ["planos", isRest("plans")],
      ["perfis relacionados", isRest("profiles", (u) => (u.searchParams.get("id") ?? "").startsWith("in."))],
      ["lista de indicações", referralsList],
    ] as const) {
      it(`indicações: abort durante ${name} => { ok:false, errorClass:"aborted" }`, async () => {
        transport.setRules([{ match: rule, mode: { kind: "hang" } }])
        const controller = new AbortController()
        const p = quiet(() => svc.loadAdminReferralsFromSupabase({ identity, signal: controller.signal }))
        await waitFor(() => transport.requests.some((r) => r.settled === null))
        controller.abort()
        const r = await p
        assert.equal(r.ok, false)
        assert.equal(!r.ok && r.errorClass, "aborted")
        assert.equal(transport.inflight.size, 0)
      })
    }
    it("comerciais: abort durante disponibilidade => aborted (não segue para estatísticas)", async () => {
      transport.setRules([{ match: isRest("commercial_availability"), mode: { kind: "hang" } }])
      const controller = new AbortController()
      const p = quiet(() => svc.loadAdminComerciaisResultFromSupabase({ identity, signal: controller.signal }))
      await waitFor(() => transport.requests.some((r) => r.settled === null))
      controller.abort()
      assert.deepEqual(await p, { ok: false, errorClass: "aborted" })
      assert.equal(transport.rest().filter((r) => r.path === "/rest/v1/referrals").length, 0)
    })
    it("sem signal: consultas idênticas às de antes (nenhum signal anexado, shape de sucesso igual)", async () => {
      const r = await quiet(() => svc.loadAdminComerciaisResultFromSupabase({ identity }))
      assert.equal(r.ok, true)
      assert.ok(transport.rest().every((x) => x.signal === undefined))
      assert.deepEqual(Object.keys((r as { data: object[] }).data[0]!).sort(), [
        "ativo", "createdAt", "disponibilidade", "email", "id", "leadsAtivos", "nome", "role", "telefone", "tempoMedioPrimeiroContato", "updatedAt", "vendasRealizadas",
      ])
    })
  })
})
