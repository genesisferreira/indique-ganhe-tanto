import assert from "node:assert/strict"
import { before, describe, it, mock } from "node:test"
import { ADMIN_ID, COMERCIAL_ID, counters, fakeSupabaseClient, resetFake } from "./fake-supabase.test-helper"

/**
 * 3.1F-K1: loaders REAIS (supabase-data.service + orquestrador de indicações) contra um cliente
 * Supabase simulado e somente leitura. Mede auth.getUser e consultas por carregamento lógico.
 * Requer --experimental-test-module-mocks; sem a flag a suíte é ignorada (skip), nunca aprovada em silêncio.
 */
const hasModuleMocks = typeof (mock as unknown as { module?: unknown }).module === "function"

type Svc = typeof import("@/lib/services/supabase-data.service")
type Bundle = typeof import("@/lib/admin-legacy/indicacoes-loader")
type Loader = typeof import("@/lib/client/guarded-loader")
let svc: Svc, bundle: Bundle, gl: Loader

const quiet = () => {
  const o = { log: console.log, error: console.error, warn: console.warn, info: console.info }
  const logs: string[] = []
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")) }
  console.error = (...a: unknown[]) => { logs.push(JSON.stringify(a)) }
  console.warn = () => {}
  console.info = () => {}
  return { logs, restore: () => Object.assign(console, o) }
}

describe("K1 loaders legados (Supabase simulado)", { skip: !hasModuleMocks && "requer --experimental-test-module-mocks" }, () => {
  before(async () => {
    ;(mock as unknown as { module: (s: string, o: unknown) => void }).module("@/lib/supabase/client", {
      namedExports: { getSupabaseClient: () => fakeSupabaseClient(), resetSupabaseBrowserClient: () => {}, getSupabaseAuthNetworkHint: () => null },
    })
    const q = quiet()
    try {
      svc = await import("@/lib/services/supabase-data.service")
      bundle = await import("@/lib/admin-legacy/indicacoes-loader")
      gl = await import("@/lib/client/guarded-loader")
    } finally { q.restore() }
  })

  const legacyIndicacoesLoad = () => Promise.all([svc.loadAdminReferralsFromSupabase(), svc.loadAdminComerciaisFromSupabase(), svc.getAuthProfileBasicsFromSupabase()])

  describe("/admin/comerciais — causa do vazio falso", () => {
    it("baseline b905589: qualquer falha => null (a página fazia `remote ?? []` => 'Nenhum comercial encontrado')", async () => {
      const q = quiet()
      try {
        for (const s of [{ authError: true }, { role: "indicador" }, { referralsError: true }, { profilesListError: true }]) {
          resetFake(s)
          assert.equal(await svc.loadAdminComerciaisFromSupabase(), null)
        }
      } finally { q.restore() }
    })
    it("1 comercial ativo => lista com 1 (Admin Master)", async () => {
      resetFake({ comerciais: 1 })
      const r = await svc.loadAdminComerciaisResultFromSupabase()
      assert.equal(r.ok, true)
      assert.equal(r.ok && r.data.length, 1)
      assert.equal(r.ok && r.data[0]!.id, COMERCIAL_ID)
      assert.equal(r.ok && r.data[0]!.disponibilidade, "disponivel")
      assert.equal(counters.writes, 0)
    })
    it("zero comerciais => ok [] (vazio real)", async () => {
      resetFake({ comerciais: 0 })
      const r = await svc.loadAdminComerciaisResultFromSupabase()
      assert.deepEqual(r, { ok: true, data: [] })
      const outcome = gl.listOutcome(r.ok ? r.data : null)
      assert.equal(outcome.kind === "data" && outcome.empty, true)
    })
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["sessão ausente (401)", { authError: true }, "unauthenticated"],
      ["papel sem acesso (403)", { role: "indicador" }, "forbidden"],
      ["perfil inexistente", { role: null }, "forbidden"],
      ["erro na consulta de perfis (500)", { profilesListError: true }, "query_failed"],
      ["erro na consulta de estatísticas", { referralsError: true }, "query_failed"],
      ["data null sem erro", { profilesListNull: true }, "invalid_response"],
    ]
    for (const [name, s, cls] of cases) {
      it(`${name} => erro ${cls} (nunca lista vazia)`, async () => {
        resetFake(s)
        const r = await svc.loadAdminComerciaisResultFromSupabase()
        assert.deepEqual(r, { ok: false, errorClass: cls })
      })
    }
    it("signal repassado às consultas principais (cancelamento por timeout/desmontagem)", async () => {
      resetFake({ comerciais: 1 })
      await svc.loadAdminComerciaisResultFromSupabase({ signal: new AbortController().signal })
      assert.equal(counters.signals, 2)
    })
    it("timeout: consulta pendurada => estado timeout (não vazio)", async () => {
      resetFake({ hang: true })
      const states: string[] = []
      let fire: (() => void) | null = null
      const loader = gl.createGuardedLoader({
        load: async ({ signal }) => {
          const r = await svc.loadAdminComerciaisResultFromSupabase({ signal })
          return r.ok ? gl.listOutcome(r.data) : gl.errorOutcome(r.errorClass === "forbidden" ? "forbidden" : "server_error")
        },
        onState: (s) => states.push(s.status),
        timers: { set: (fn) => { fire = fn; return 1 }, clear: () => { fire = null } },
      })
      const p = loader.run()
      await new Promise((r) => setImmediate(r))
      fire!()
      await p
      assert.deepEqual(states, ["loading", "timeout"])
    })
    it("refresh e resposta fora de ordem: somente a última vence", async () => {
      resetFake({ comerciais: 1 })
      const seen: number[] = []
      let call = 0
      const loader = gl.createGuardedLoader({
        load: async () => {
          const mine = ++call
          const r = await svc.loadAdminComerciaisResultFromSupabase()
          if (!r.ok) return gl.errorOutcome("server_error")
          if (mine === 1) {
            await new Promise((res) => setTimeout(res, 40))
            return gl.listOutcome([...r.data, ...r.data]) // resposta antiga (2 itens) chega depois
          }
          return gl.listOutcome(r.data)
        },
        onState: (s) => { if (s.status === "success") seen.push((s.data as unknown[]).length) },
      })
      const p1 = loader.run()
      await new Promise((res) => setTimeout(res, 5))
      const p2 = loader.run({ supersede: true })
      await Promise.all([p1, p2])
      await new Promise((res) => setTimeout(res, 50))
      loader.dispose()
      assert.deepEqual(seen, [1])
    })
  })

  describe("/admin/indicacoes — auth.getUser por carregamento lógico", () => {
    it("ANTES (composição de b905589): 3 getUser e 9 consultas por carregamento; 33/99 com 10 eventos realtime", async () => {
      const q = quiet()
      try {
        resetFake()
        await legacyIndicacoesLoad()
        assert.equal(counters.getUser, 3)
        assert.equal(counters.from, 9)
        resetFake()
        await legacyIndicacoesLoad()
        await Promise.all(Array.from({ length: 10 }, () => legacyIndicacoesLoad()))
        assert.equal(counters.getUser, 33)
        assert.equal(counters.from, 99)
      } finally { q.restore() }
    })

    it("DEPOIS: 1 getUser e 7 consultas por carregamento; nenhuma escrita; getSession nunca usado", async () => {
      resetFake()
      const q = quiet()
      let r
      try { r = await bundle.loadAdminIndicacoesBundle() } finally { q.restore() }
      assert.equal(counters.getUser, 1)
      assert.equal(counters.from, 7)
      assert.equal(counters.writes, 0)
      assert.equal(r.kind, "data")
      assert.equal(r.kind === "data" && r.data.lista.length, 1)
      assert.equal(r.kind === "data" && r.data.comerciais.length, 1)
      assert.equal(r.kind === "data" && r.data.role, "admin_master")
    })

    it("StrictMode (start → dispose → start): 1 getUser no total", async () => {
      resetFake()
      const q = quiet()
      try {
        const first = gl.createGuardedLoader({ load: ({ signal }) => bundle.loadAdminIndicacoesBundle(signal), onState: () => {} })
        first.start(); first.dispose()
        const states: string[] = []
        const second = gl.createGuardedLoader({ load: ({ signal }) => bundle.loadAdminIndicacoesBundle(signal), onState: (s) => states.push(s.status) })
        second.start()
        await new Promise((r) => setTimeout(r, 20))
        second.dispose()
        assert.equal(counters.getUser, 1)
        assert.equal(states.at(-1), "success")
      } finally { q.restore() }
    })

    it("10 eventos realtime durante o carregamento => coalescidos: 2 getUser no total (antes: 33)", async () => {
      resetFake({ delayMs: 5 })
      const q = quiet()
      try {
        const loader = gl.createGuardedLoader({ load: ({ signal }) => bundle.loadAdminIndicacoesBundle(signal), onState: () => {} })
        const p = loader.run()
        for (let i = 0; i < 10; i++) void loader.run({ silent: true })
        await p
        await new Promise((r) => setTimeout(r, 60))
        loader.dispose()
        assert.equal(counters.getUser, 2)
        assert.equal(counters.from, 14)
      } finally { q.restore() }
    })

    it("refresh manual explícito => nova resolução de identidade (1 por ação)", async () => {
      resetFake()
      const q = quiet()
      try {
        const loader = gl.createGuardedLoader({ load: ({ signal }) => bundle.loadAdminIndicacoesBundle(signal), onState: () => {} })
        await loader.run()
        await loader.run()
        loader.dispose()
        assert.equal(counters.getUser, 2)
      } finally { q.restore() }
    })

    it("papel negado => forbidden com 1 getUser e sem consultar referrals", async () => {
      resetFake({ role: "indicador" })
      const r = await bundle.loadAdminIndicacoesBundle()
      assert.deepEqual(r, { kind: "error", errorClass: "forbidden" })
      assert.equal(counters.getUser, 1)
      assert.ok(!counters.tables.includes("referrals"))
    })

    it("sessão ausente => unauthenticated", async () => {
      resetFake({ authError: true })
      assert.deepEqual(await bundle.loadAdminIndicacoesBundle(), { kind: "error", errorClass: "unauthenticated" })
    })

    it("erro em referrals => server_error (nunca 'zero indicações')", async () => {
      resetFake({ referralsError: true })
      const q = quiet()
      let r
      try { r = await bundle.loadAdminIndicacoesBundle() } finally { q.restore() }
      assert.deepEqual(r, { kind: "error", errorClass: "server_error" })
    })

    it("falha só nos comerciais => indicações exibidas e comerciais marcados como indisponíveis", async () => {
      resetFake({ profilesListError: true })
      const q = quiet()
      let r
      try { r = await bundle.loadAdminIndicacoesBundle() } finally { q.restore() }
      assert.equal(r.kind, "data")
      assert.equal(r.kind === "data" && r.data.lista.length, 1)
      assert.equal(r.kind === "data" && r.data.comerciaisDisponiveis, false)
    })

    it("logs de produção sem identificadores (authUserId/profileId somente em development)", async () => {
      resetFake({ referralsError: true })
      const q = quiet()
      try { await bundle.loadAdminIndicacoesBundle(); await svc.loadAdminReferralsFromSupabase() } finally { q.restore() }
      const joined = q.logs.join("\n")
      assert.ok(!joined.includes(ADMIN_ID), "nenhum UUID do usuário em log")
      assert.ok(!/admin-indicacoes:session/.test(joined))
    })
  })
})
