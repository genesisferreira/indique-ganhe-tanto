import assert from "node:assert/strict"
import { before, beforeEach, describe, it, mock } from "node:test"
import { ADMIN_ID, COMERCIAL_ID, counters, fakeSupabaseClient, resetFake, type FakeScenario } from "./fake-supabase.test-helper"
import { createControlledTransport, fakeTimers, instrumentedControllers, waitFor } from "./controlled-transport.test-helper"

/**
 * 3.1F-K1S — /admin/comerciais e /admin/indicacoes travando/sem lista em produção (b905589 e 71bb71e).
 *
 * Causa raiz reproduzida no lab real (scripts/k1-local-visual/k1s-latency-repro.mjs, Auth com 600 ms):
 * o app shell (K2) dispara ~33 auth.getUser concorrentes; no navegador cada chamada do supabase-js passa
 * pelo lock de auth (navigator.locks, acquireTimeout 5 s). O pedido que espera > 5 s ROUBA o lock e o
 * detentor recebe `NavigatorLockAcquireTimeoutError` — lançado de dentro de auth.getUser(). Quando a vítima
 * é o getUser do loader da página: comerciais => erro genérico SEM disparar a lista; indicações => erro sem
 * consultar referrals. /admin/funcionarios não sofre: carrega por rota de API (sem lock do navegador).
 *
 * Correção: as duas páginas carregam via /api/admin/comerciais e /api/admin/indicacoes (mesmos loaders no
 * servidor, sessão do próprio usuário, RLS inalterada, sem service_role).
 * Requer --experimental-test-module-mocks (sem a flag: skip explícito, nunca "pass").
 */
const hasModuleMocks = typeof (mock as unknown as { module?: unknown }).module === "function"

type Loader = typeof import("@/lib/client/guarded-loader")
type PageLoaders = typeof import("@/lib/admin-legacy/page-loaders")
type Bundle = typeof import("@/lib/admin-legacy/indicacoes-loader")
type ApiLoaders = typeof import("@/lib/admin-legacy/api-page-loaders")
type ServerApi = typeof import("@/lib/admin-legacy/admin-list-api")
let gl: Loader, pages: PageLoaders, bundle: Bundle, apiLoaders: ApiLoaders, server: ServerApi

let browserClientCalls = 0
const transport = createControlledTransport()
const never = () => new AbortController().signal

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const o = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug }
  console.log = console.error = console.warn = console.info = console.debug = () => {}
  try { return await fn() } finally { Object.assign(console, o) }
}

/** Corpo real da rota (handler de servidor + fake), serializado como no fio. */
async function serverBody(kind: "comerciais" | "indicacoes", s: FakeScenario = {}) {
  resetFake(s)
  const r = await quiet(() =>
    kind === "comerciais" ? server.adminComerciaisHttp(fakeSupabaseClient() as never, never()) : server.adminIndicacoesHttp(fakeSupabaseClient() as never, never())
  )
  return { status: r.status, body: JSON.parse(JSON.stringify(r.body)) as Record<string, unknown> }
}

const isPath = (p: string) => ({ url }: { url: URL }) => url.pathname === p

describe("K1S — loaders de comerciais/indicações via rota de API", { skip: !hasModuleMocks && "requer --experimental-test-module-mocks" }, () => {
  before(async () => {
    ;(mock as unknown as { module: (s: string, o: unknown) => void }).module("@/lib/supabase/client", {
      namedExports: {
        getSupabaseClient: () => { browserClientCalls++; return fakeSupabaseClient() },
        resetSupabaseBrowserClient: () => {},
        getSupabaseAuthNetworkHint: () => null,
      },
    })
    await quiet(async () => {
      gl = await import("@/lib/client/guarded-loader")
      pages = await import("@/lib/admin-legacy/page-loaders")
      bundle = await import("@/lib/admin-legacy/indicacoes-loader")
      apiLoaders = await import("@/lib/admin-legacy/api-page-loaders")
      server = await import("@/lib/admin-legacy/admin-list-api")
    })
  })
  beforeEach(() => { transport.reset(); browserClientCalls = 0 })

  function harness<T>(pageLoad: (signal: AbortSignal) => Promise<import("@/lib/client/guarded-loader").LoadOutcome<T>>) {
    const timers = fakeTimers()
    const ctrls = instrumentedControllers()
    const states: Array<{ status: string; data?: T; errorClass?: string }> = []
    const loads: AbortSignal[] = []
    const loader = gl.createGuardedLoader<T>({
      load: (ctx) => { loads.push(ctx.signal); return pageLoad(ctx.signal) },
      onState: (s) => states.push(s as never),
      timers,
      createController: ctrls.factory,
    })
    return { loader, timers, ctrls, states, loads, statuses: () => states.map((s) => s.status), last: () => states.at(-1)! }
  }
  // Exatamente o que as páginas passam ao useGuardedLoader (fetch real substituído pelo transporte controlado).
  const comerciaisPage = () => harness((signal) => apiLoaders.fetchComerciaisPageOutcome(signal, transport.fetch))
  const indicacoesPage = () => harness((signal) => apiLoaders.fetchIndicacoesPageOutcome(signal, transport.fetch))

  describe("causa raiz — lock de auth roubado (caminho antigo, cliente do navegador)", () => {
    it("comerciais (71bb71e): getUser lança NavigatorLockAcquireTimeoutError => 'Não foi possível carregar os dados.' e a LISTA NUNCA É CONSULTADA", async () => {
      resetFake({ lockStolen: true, comerciais: 2 })
      const out = await quiet(() => pages.loadComerciaisPageOutcome(never()))
      assert.deepEqual(out, { kind: "error", errorClass: "unexpected" })
      assert.equal(gl.loaderErrorMessage("unexpected"), "Não foi possível carregar os dados.")
      assert.equal(counters.getUser, 1)
      assert.equal(counters.from, 0) // nenhuma consulta: nem papel, nem lista role=comercial
    })
    it("indicações (71bb71e): getUser roubado => erro e referrals NUNCA consultadas", async () => {
      resetFake({ lockStolen: true })
      const out = await quiet(() => bundle.loadAdminIndicacoesBundle(never()))
      assert.equal(out.kind, "error")
      assert.ok(!counters.tables.includes("referrals"))
    })
    it("caminho K1S: o loader da página não toca o cliente Supabase do navegador (imune ao lock) e busca /api/admin/comerciais com o signal do carregamento", async () => {
      resetFake({ lockStolen: true })
      const ok = await serverBody("comerciais", { comerciais: 2 })
      resetFake({ lockStolen: true })
      browserClientCalls = 0
      transport.setRules([{ match: isPath("/api/admin/comerciais"), mode: { kind: "respond", status: 200, body: ok.body } }])
      const h = comerciaisPage()
      await quiet(() => h.loader.run())
      assert.equal(browserClientCalls, 0)
      assert.equal(counters.getUser, 0)
      assert.equal(transport.requests.length, 1)
      assert.equal(transport.requests[0]!.path, "/api/admin/comerciais")
      assert.equal(transport.requests[0]!.signal, h.loads[0]) // MESMO signal do AbortController do carregamento
      assert.equal(h.last().status, "success")
      assert.equal((h.last().data as unknown[]).length, 2)
    })
  })

  describe("servidor — /api/admin/comerciais (sessão do usuário, prova da consulta principal)", () => {
    it("Admin Master autorizado: a consulta da lista (profiles role=comercial) É executada, com signal, 1 getUser, 0 escrita", async () => {
      const r = await serverBody("comerciais", { comerciais: 2 })
      assert.equal(r.status, 200)
      assert.equal(r.body.ok, true)
      assert.equal((r.body.items as Array<{ id: string }>)[0]!.id, COMERCIAL_ID)
      assert.equal((r.body.items as unknown[]).length, 2)
      assert.ok(counters.queries.some((q) => q.startsWith("profiles|") && q.includes('eq:"role"') && !q.endsWith("|single")), counters.queries.join("\n"))
      assert.equal(counters.getUser, 1)
      assert.equal(counters.signals, counters.from) // toda consulta recebeu o request.signal
      assert.equal(counters.writes, 0)
    })
    it("vazio real => 200 com lista vazia", async () => {
      const r = await serverBody("comerciais", { comerciais: 0 })
      assert.deepEqual([r.status, r.body], [200, { ok: true, items: [] }])
    })
    it("erros => status HTTP + classe, sem detalhes técnicos no corpo", async () => {
      assert.deepEqual(await serverBody("comerciais", { authError: true }), { status: 401, body: { ok: false, errorClass: "unauthenticated" } })
      assert.deepEqual(await serverBody("comerciais", { role: "indicador" }), { status: 403, body: { ok: false, errorClass: "forbidden" } })
      const rls = await serverBody("comerciais", { profilesListError: true })
      assert.deepEqual(rls, { status: 502, body: { ok: false, errorClass: "server_error" } }) // mapeamento K1 existente (inalterado)
      assert.ok(!JSON.stringify(rls.body).includes("permission denied"))
      assert.deepEqual(await serverBody("comerciais", { profilesListNull: true }), { status: 502, body: { ok: false, errorClass: "invalid_response" } })
    })
  })

  describe("servidor — /api/admin/indicacoes", () => {
    it("dados: a consulta principal (referrals) É executada e o bundle volta completo", async () => {
      const r = await serverBody("indicacoes")
      assert.equal(r.status, 200)
      const b = r.body.bundle as { lista: unknown[]; comerciais: unknown[]; comerciaisDisponiveis: boolean; role: string }
      assert.equal(b.lista.length, 1)
      assert.equal(b.comerciais.length, 1)
      assert.equal(b.comerciaisDisponiveis, true)
      assert.equal(b.role, "admin_master")
      assert.ok(counters.tables.includes("referrals"))
      assert.equal(counters.getUser, 1)
      assert.equal(counters.writes, 0)
    })
    it("vazio real => 200 com lista vazia", async () => {
      const r = await serverBody("indicacoes", { referralsEmpty: true })
      assert.equal(r.status, 200)
      assert.deepEqual((r.body.bundle as { lista: unknown[] }).lista, [])
    })
    it("erro da consulta principal => 502 server_error", async () => {
      assert.deepEqual(await serverBody("indicacoes", { referralsError: true }), { status: 502, body: { ok: false, errorClass: "server_error" } })
    })
    it("falha da consulta OPCIONAL (comerciais) não bloqueia a lista principal", async () => {
      const r = await serverBody("indicacoes", { profilesListError: true })
      assert.equal(r.status, 200)
      const b = r.body.bundle as { lista: unknown[]; comerciaisDisponiveis: boolean }
      assert.equal(b.lista.length, 1)
      assert.equal(b.comerciaisDisponiveis, false)
    })
    it("consulta OPCIONAL pendurada: a lista principal é entregue após a carência (sem esperar o timeout global), mesmo signal", async () => {
      const t = fakeTimers()
      const seen: Array<AbortSignal | undefined> = []
      const sig = never()
      const p = bundle.loadAdminIndicacoesBundle(sig, {
        getBasics: async (o) => { seen.push(o?.signal); return { id: ADMIN_ID, role: "admin_master", isActive: true } as never },
        loadReferrals: async (o) => { seen.push(o?.signal); return { ok: true, data: [{ id: "r1" }] } as never },
        loadComerciais: (o) => { seen.push(o?.signal); return new Promise(() => {}) },
      }, { timers: t })
      await waitFor(() => t.active === 1)
      assert.equal(t.created, 1)
      t.fireAll() // carência expirou
      const out = await p
      assert.equal(out.kind, "data")
      assert.equal(out.kind === "data" && out.data.comerciaisDisponiveis, false)
      assert.equal(out.kind === "data" && out.data.lista.length, 1)
      assert.ok(seen.every((s) => s === sig))
    })
    it("consulta OPCIONAL rápida: timer da carência é limpo (nenhum timer vivo)", async () => {
      const t = fakeTimers()
      const out = await bundle.loadAdminIndicacoesBundle(never(), {
        getBasics: async () => ({ id: ADMIN_ID, role: "admin_master", isActive: true }) as never,
        loadReferrals: async () => ({ ok: true, data: [] }) as never,
        loadComerciais: async () => ({ ok: true, data: [{ id: "c1" }] }) as never,
      }, { timers: t })
      assert.equal(out.kind === "data" && out.empty, true)
      assert.equal(out.kind === "data" && out.data.comerciaisDisponiveis, true)
      assert.equal(t.active, 0)
    })
  })

  describe("página /admin/comerciais (fetch + guarded loader)", () => {
    it("dados => success com Date restaurado; vazio real => empty", async () => {
      const ok = await serverBody("comerciais", { comerciais: 2 })
      transport.setRules([{ match: isPath("/api/admin/comerciais"), mode: { kind: "respond", status: 200, body: ok.body } }])
      const h = comerciaisPage()
      await quiet(() => h.loader.run())
      assert.deepEqual(h.statuses(), ["loading", "success"])
      assert.ok((h.last().data as Array<{ createdAt: unknown }>)[0]!.createdAt instanceof Date)
      const empty = await serverBody("comerciais", { comerciais: 0 })
      transport.setRules([{ match: isPath("/api/admin/comerciais"), mode: { kind: "respond", status: 200, body: empty.body } }])
      const h2 = comerciaisPage()
      await quiet(() => h2.loader.run())
      assert.deepEqual(h2.statuses(), ["loading", "empty"])
    })
    it("erros (401/403/500/corpo inválido) => error, nunca vazio", async () => {
      for (const [status, body, cls] of [
        [401, { ok: false, errorClass: "unauthenticated" }, "unauthenticated"],
        [403, { ok: false, errorClass: "forbidden" }, "forbidden"],
        [502, { ok: false, errorClass: "server_error" }, "server_error"],
        [500, { ok: false, errorClass: "unexpected" }, "server_error"],
        [200, { ok: true, items: "x" }, "invalid_response"],
        [200, { ok: true }, "invalid_response"],
      ] as const) {
        transport.reset()
        transport.setRules([{ match: isPath("/api/admin/comerciais"), mode: { kind: "respond", status, body } }])
        const h = comerciaisPage()
        await quiet(() => h.loader.run())
        assert.equal(h.last().status, "error", `${status}`)
        assert.equal(h.last().errorClass, cls)
        assert.ok(!h.statuses().includes("empty"))
      }
    })
    it("timeout => estado timeout (não vazio), request realmente abortado, 0 em voo, 0 timers", async () => {
      transport.setRules([{ match: isPath("/api/admin/comerciais"), mode: { kind: "hang" } }])
      const h = comerciaisPage()
      const p = quiet(() => h.loader.run())
      await waitFor(() => transport.inflight.size === 1)
      h.timers.fireAll()
      await p
      assert.deepEqual(h.statuses(), ["loading", "timeout"])
      assert.equal(transport.requests[0]!.abortEvents, 1)
      assert.equal(transport.inflight.size, 0)
      assert.equal(h.timers.active, 0)
    })
    it("Tentar novamente após timeout => success; resposta antiga (abort ignorado) não sobrescreve", async () => {
      const ok = await serverBody("comerciais", { comerciais: 2 })
      transport.setRules([
        { match: isPath("/api/admin/comerciais"), mode: { kind: "ignoreAbort", status: 200, body: { ok: true, items: [{ id: "stale", nome: "Resposta Antiga" }] } }, times: 1 },
        { match: isPath("/api/admin/comerciais"), mode: { kind: "respond", status: 200, body: ok.body } },
      ])
      const h = comerciaisPage()
      const p1 = quiet(() => h.loader.run())
      await waitFor(() => transport.inflight.size === 1)
      await quiet(() => h.loader.retry())
      transport.release(transport.requests[0]!.id)
      await p1
      assert.equal(h.last().status, "success")
      assert.ok((h.last().data as Array<{ id: string }>).every((c) => c.id !== "stale"))
      assert.deepEqual(h.statuses(), ["loading", "loading", "success"])
    })
    it("desmontagem durante o carregamento => request abortado e nenhum estado depois (nunca vazio)", async () => {
      transport.setRules([{ match: isPath("/api/admin/comerciais"), mode: { kind: "hang" } }])
      const h = comerciaisPage()
      const p = quiet(() => h.loader.run())
      await waitFor(() => transport.inflight.size === 1)
      h.loader.dispose()
      await p
      assert.deepEqual(h.statuses(), ["loading"])
      assert.equal(transport.inflight.size, 0)
    })
  })

  describe("página /admin/indicacoes (fetch + guarded loader)", () => {
    const route = isPath("/api/admin/indicacoes")
    it("dados => success; vazio real => empty; Date restaurado", async () => {
      const ok = await serverBody("indicacoes")
      transport.setRules([{ match: route, mode: { kind: "respond", status: 200, body: ok.body } }])
      const h = indicacoesPage()
      await quiet(() => h.loader.run())
      assert.deepEqual(h.statuses(), ["loading", "success"])
      const data = h.last().data as { lista: Array<{ createdAt: unknown }>; comerciaisDisponiveis: boolean }
      assert.ok(data.lista[0]!.createdAt instanceof Date)
      assert.equal(data.comerciaisDisponiveis, true)
      const empty = await serverBody("indicacoes", { referralsEmpty: true })
      transport.setRules([{ match: route, mode: { kind: "respond", status: 200, body: empty.body } }])
      const h2 = indicacoesPage()
      await quiet(() => h2.loader.run())
      assert.deepEqual(h2.statuses(), ["loading", "empty"])
    })
    it("erro / corpo inválido => error (o carregamento sempre termina)", async () => {
      for (const [status, body] of [[502, { ok: false, errorClass: "server_error" }], [200, { ok: true, bundle: { lista: null } }]] as const) {
        transport.reset()
        transport.setRules([{ match: route, mode: { kind: "respond", status, body } }])
        const h = indicacoesPage()
        await quiet(() => h.loader.run())
        assert.equal(h.last().status, "error")
      }
    })
    it("timeout => timeout + retry => success", async () => {
      const ok = await serverBody("indicacoes")
      transport.setRules([{ match: route, mode: { kind: "hang" }, times: 1 }, { match: route, mode: { kind: "respond", status: 200, body: ok.body } }])
      const h = indicacoesPage()
      const p = quiet(() => h.loader.run())
      await waitFor(() => transport.inflight.size === 1)
      h.timers.fireAll()
      await p
      assert.equal(h.last().status, "timeout")
      await quiet(() => h.loader.retry())
      assert.deepEqual(h.statuses(), ["loading", "timeout", "loading", "success"])
      assert.equal(transport.inflight.size, 0)
    })
    it("realtime concorrente: 5 recargas silenciosas durante o carregamento => coalescidas (2 requests), loading termina em success", async () => {
      const ok = await serverBody("indicacoes")
      transport.setRules([{ match: route, mode: { kind: "respond", status: 200, body: ok.body } }])
      const h = indicacoesPage()
      const first = quiet(() => h.loader.run())
      const silent = Array.from({ length: 5 }, () => quiet(() => h.loader.run({ silent: true })))
      await Promise.all([first, ...silent])
      await waitFor(() => !h.loader.inFlight && transport.inflight.size === 0)
      assert.equal(transport.requests.length, 2)
      assert.equal(h.statuses().filter((s) => s === "loading").length, 1)
      assert.equal(h.last().status, "success")
      assert.equal(h.timers.active, 0)
    })
  })
})
