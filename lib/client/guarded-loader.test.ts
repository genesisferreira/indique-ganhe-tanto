import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  LEGACY_LOADER_TIMEOUT_MS,
  LoaderError,
  classifyHttpStatus,
  createGuardedLoader,
  dataOutcome,
  errorOutcome,
  fetchJsonForLoader,
  listOutcome,
  loaderErrorMessage,
  type LoadOutcome,
  type LoaderState,
} from "./guarded-loader"

/** Timers manuais: controle total de timeout, contagem de set/clear. */
function manualTimers() {
  let nextId = 1
  const active = new Map<number, () => void>()
  const stats = { set: 0, clear: 0 }
  return {
    stats,
    active,
    timers: {
      set: (fn: () => void) => { stats.set++; const id = nextId++; active.set(id, fn); return id },
      clear: (h: unknown) => { stats.clear++; active.delete(h as number) },
    },
    fireAll() { for (const [id, fn] of [...active]) { active.delete(id); fn() } },
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setImmediate(r))

function harness<T>(load: (ctx: { signal: AbortSignal; attempt: number }) => Promise<LoadOutcome<T>>) {
  const t = manualTimers()
  const states: LoaderState<T>[] = []
  const loader = createGuardedLoader<T>({ load, onState: (s) => states.push(s), timers: t.timers })
  return { loader, states, t }
}

describe("K1 guarded loader — estados", () => {
  it("sucesso: loading → success; timer limpo", async () => {
    const h = harness(async () => dataOutcome([1, 2], false))
    await h.loader.run()
    assert.deepEqual(h.states.map((s) => s.status), ["loading", "success"])
    assert.equal(h.t.stats.set, 1)
    assert.equal(h.t.stats.clear, 1)
    assert.equal(h.t.active.size, 0)
  })

  it("vazio real somente com lista válida vazia", async () => {
    const h = harness(async () => listOutcome<number>([]))
    await h.loader.run()
    assert.deepEqual(h.states.at(-1), { status: "empty", data: [] })
  })

  for (const [name, value] of [["null", null], ["undefined", undefined], ["objeto", { items: [] }], ["string", "[]"]] as const) {
    it(`resposta ${name} => error invalid_response (nunca vazio)`, async () => {
      const h = harness(async () => listOutcome<number>(value))
      await h.loader.run()
      assert.deepEqual(h.states.at(-1), { status: "error", errorClass: "invalid_response" })
    })
  }

  it("item com shape inválido => invalid_response", async () => {
    const h = harness(async () => listOutcome<{ id: string }>([{ id: "a" }, { nope: 1 }], (x) => typeof (x as { id?: unknown }).id === "string"))
    await h.loader.run()
    assert.deepEqual(h.states.at(-1), { status: "error", errorClass: "invalid_response" })
  })

  it("load que resolve null/forma inesperada => invalid_response", async () => {
    const h = harness(async () => null as unknown as LoadOutcome<number>)
    await h.loader.run()
    assert.deepEqual(h.states.at(-1), { status: "error", errorClass: "invalid_response" })
  })

  for (const [status, cls] of [[401, "unauthenticated"], [403, "forbidden"], [500, "server_error"], [502, "server_error"], [400, "invalid_response"]] as const) {
    it(`HTTP ${status} => ${cls}`, async () => {
      assert.equal(classifyHttpStatus(status), cls)
      const h = harness(async () => errorOutcome<number[]>(classifyHttpStatus(status)))
      await h.loader.run()
      assert.deepEqual(h.states.at(-1), { status: "error", errorClass: cls })
    })
  }

  it("exceção sem classe => error unexpected; LoaderError mantém a classe; finally limpa timer", async () => {
    const h = harness<number>(async () => { throw new Error("SECRET detail jwt=eyJ") })
    await h.loader.run()
    assert.deepEqual(h.states.at(-1), { status: "error", errorClass: "unexpected" })
    assert.equal(h.t.active.size, 0)
    const h2 = harness<number>(async () => { throw new LoaderError("network") })
    await h2.loader.run()
    assert.deepEqual(h2.states.at(-1), { status: "error", errorClass: "network" })
    assert.equal(h2.t.stats.clear, 1)
  })

  it("mensagens amigáveis não expõem texto técnico", () => {
    for (const c of ["unauthenticated", "forbidden", "server_error", "invalid_response", "network", "unexpected"] as const) {
      const m = loaderErrorMessage(c)
      assert.ok(m.length > 10)
      assert.doesNotMatch(m, /SECRET|jwt|stack|code=|undefined|null/i)
    }
  })
})

describe("K1 guarded loader — timeout, abort, desmontagem", () => {
  it("timeout padrão documentado = 15 s", () => {
    assert.equal(LEGACY_LOADER_TIMEOUT_MS, 15_000)
  })

  it("timeout => status timeout (distinto de erro), signal abortado, loading termina", async () => {
    let seen: AbortSignal | null = null
    const h = harness<number[]>(({ signal }) => { seen = signal; return new Promise(() => {}) })
    const p = h.loader.run()
    await tick()
    assert.deepEqual(h.states.map((s) => s.status), ["loading"])
    h.t.fireAll()
    await p
    assert.deepEqual(h.states.at(-1), { status: "timeout" })
    assert.equal(seen!.aborted, true)
    assert.equal(h.loader.inFlight, false)
  })

  it("dispose durante carregamento: aborta e não emite mais nada", async () => {
    let seen: AbortSignal | null = null
    const d = deferred<LoadOutcome<number[]>>()
    const h = harness<number[]>(({ signal }) => { seen = signal; return d.promise })
    const p = h.loader.run()
    await tick()
    h.loader.dispose()
    d.resolve(dataOutcome([1], false))
    await p
    assert.equal(seen!.aborted, true)
    assert.deepEqual(h.states.map((s) => s.status), ["loading"])
    await h.loader.run()
    assert.equal(h.states.length, 1, "run após dispose é ignorado")
    assert.equal(h.t.active.size, 0)
  })

  it("StrictMode (start → dispose → novo start): load chamado exatamente 1×", async () => {
    let calls = 0
    const load = async () => { calls++; return dataOutcome([1], false) }
    const t = manualTimers()
    const first = createGuardedLoader<number[]>({ load, onState: () => {}, timers: t.timers })
    first.start()
    first.dispose()
    const states: LoaderState<number[]>[] = []
    const second = createGuardedLoader<number[]>({ load, onState: (s) => states.push(s), timers: t.timers })
    second.start()
    await tick(); await tick()
    assert.equal(calls, 1)
    assert.equal(states.at(-1)?.status, "success")
  })
})

describe("K1 guarded loader — ordem, refresh e retry", () => {
  it("resposta fora de ordem: a antiga (substituída) nunca sobrescreve a mais recente", async () => {
    const slow = deferred<LoadOutcome<string>>()
    const fast = deferred<LoadOutcome<string>>()
    let n = 0
    const signals: AbortSignal[] = []
    const h = harness<string>(({ signal }) => { signals.push(signal); return ++n === 1 ? slow.promise : fast.promise })
    const p1 = h.loader.run()
    await tick()
    const p2 = h.loader.run({ supersede: true })
    await tick()
    fast.resolve(dataOutcome("novo", false))
    await p2
    slow.resolve(dataOutcome("antigo", false))
    await p1
    const finals = h.states.filter((s) => s.status === "success")
    assert.deepEqual(finals, [{ status: "success", data: "novo" }])
    assert.equal(signals[0]!.aborted, true)
    assert.equal(h.t.active.size, 0)
  })

  it("refresh manual durante carregamento não duplica chamadas (coalesce: no máximo 1 pendente)", async () => {
    const gates: Array<{ promise: Promise<LoadOutcome<number>>; resolve: (v: LoadOutcome<number>) => void }> = []
    const h = harness<number>(() => { const d = deferred<LoadOutcome<number>>(); gates.push(d); return d.promise })
    const p = h.loader.run()
    await tick()
    void h.loader.run(); void h.loader.run(); void h.loader.run()
    assert.equal(gates.length, 1)
    gates[0]!.resolve(dataOutcome(1, false))
    await tick(); await tick()
    assert.equal(gates.length, 2, "exatamente um recarregamento pendente")
    gates[1]!.resolve(dataOutcome(2, false))
    await p
    await tick()
    assert.equal(gates.length, 2)
    assert.deepEqual(h.states.at(-1), { status: "success", data: 2 })
  })

  it("silent: não emite loading (conteúdo atual permanece)", async () => {
    const h = harness(async () => dataOutcome(1, false))
    await h.loader.run()
    await h.loader.run({ silent: true })
    assert.deepEqual(h.states.map((s) => s.status), ["loading", "success", "success"])
  })

  it("retry manual: uma ação = uma nova tentativa; sem retry automático", async () => {
    let calls = 0
    const h = harness<number>(async () => { calls++; return calls === 1 ? errorOutcome("server_error") : dataOutcome(7, false) })
    await h.loader.run()
    assert.equal(h.states.at(-1)?.status, "error")
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(calls, 1, "nenhuma nova chamada sem ação do usuário")
    assert.equal(h.t.active.size, 0, "nenhum timer pendente (sem setInterval/loop)")
    await h.loader.run()
    assert.equal(calls, 2)
    assert.deepEqual(h.states.at(-1), { status: "success", data: 7 })
  })

  it("loading sempre termina: todos os caminhos chegam a um estado final e limpam o timer", async () => {
    const cases: Array<() => Promise<LoadOutcome<number>>> = [
      async () => dataOutcome(1, false),
      async () => dataOutcome(0, true),
      async () => errorOutcome("forbidden"),
      async () => { throw new Error("x") },
      async () => null as unknown as LoadOutcome<number>,
    ]
    for (const c of cases) {
      const h = harness(c)
      await h.loader.run()
      assert.notEqual(h.states.at(-1)?.status, "loading")
      assert.equal(h.t.stats.set, h.t.stats.clear)
      assert.equal(h.loader.inFlight, false)
    }
  })
})

describe("K1 fetchJsonForLoader", () => {
  it("falha de rede => LoaderError network (sem texto original)", async () => {
    const ctrl = new AbortController()
    await assert.rejects(
      fetchJsonForLoader("/x", ctrl.signal, (async () => { throw new TypeError("Failed to fetch SECRET") }) as typeof fetch),
      (e: unknown) => e instanceof LoaderError && e.errorClass === "network" && !String(e.message).includes("SECRET")
    )
  })
  it("abort é propagado (controlador decide timeout/substituição)", async () => {
    const ctrl = new AbortController()
    ctrl.abort("k1")
    await assert.rejects(fetchJsonForLoader("/x", ctrl.signal, (async () => { throw new DOMException("aborted", "AbortError") }) as typeof fetch))
  })
  it("JSON inválido => json null; status preservado; usa no-store + signal", async () => {
    const ctrl = new AbortController()
    let init: RequestInit | undefined
    const r = await fetchJsonForLoader("/x", ctrl.signal, (async (_u: unknown, i?: RequestInit) => { init = i; return new Response("not json", { status: 500 }) }) as typeof fetch)
    assert.deepEqual(r, { status: 500, ok: false, json: null })
    assert.equal(init?.cache, "no-store")
    assert.equal(init?.signal, ctrl.signal)
  })
})
