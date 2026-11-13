/**
 * 3.1F-K1B — Transporte de rede CONTROLADO para testes de cancelamento.
 *
 * Substitui o `fetch` usado pelo supabase-js REAL (`createClient(..., { global: { fetch } })`) e pelo
 * `fetchJsonForLoader`. Comporta-se como o fetch nativo: se o `signal` abortar, a promise é rejeitada
 * com `signal.reason`. Registra por requisição: o objeto `signal` recebido, eventos de abort observados,
 * como terminou (resolved/rejected) e quais continuam em voo. Dados 100% sintéticos (sem PII).
 */

export type TransportMode =
  | { kind: "respond"; status?: number; body?: unknown }
  | { kind: "hang" }
  /** Simula biblioteca que NÃO cancela: ignora o abort e só termina quando `release(id)` é chamado. */
  | { kind: "ignoreAbort"; status?: number; body?: unknown }

export type TransportRule = { match: (req: { url: URL; method: string }) => boolean; mode: TransportMode; times?: number }

export type TransportRequest = {
  id: number
  method: string
  url: URL
  path: string
  signal: AbortSignal | undefined
  abortEvents: number
  settled: null | "resolved" | "rejected"
  rejectName: string | null
}

export const LAB_ADMIN_ID = "99999999-0000-4000-8000-000000000001"
export const LAB_COMERCIAL_1 = "99999999-0000-4000-8000-000000000011"
export const LAB_COMERCIAL_2 = "99999999-0000-4000-8000-000000000012"
export const LAB_INDICADOR_1 = "99999999-0000-4000-8000-000000000021"
export const LAB_PLAN_1 = "99999999-0000-4000-8000-000000000031"
const T0 = "2026-01-01T00:00:00.000Z"

export function labJwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 86400 })}.bGFiLW9ubHk`
}

type Fixture = { comerciais: Array<Record<string, unknown>>; referrals: Array<Record<string, unknown>> }

export function syntheticFixture(): Fixture {
  return {
    comerciais: [
      { id: LAB_COMERCIAL_1, full_name: "Comercial Sintético Um", email: "c1@lab.invalid", phone: "00000000000", is_active: true, created_at: T0, updated_at: T0, role: "comercial", cpf: null },
      { id: LAB_COMERCIAL_2, full_name: "Comercial Sintético Dois", email: "c2@lab.invalid", phone: "00000000000", is_active: true, created_at: T0, updated_at: T0, role: "comercial", cpf: null },
    ],
    referrals: [1, 2, 3].map((n) => ({
      id: `99999999-0000-4000-8000-00000000010${n}`,
      indicator_profile_id: LAB_INDICADOR_1,
      referred_name: `Cliente Sintético ${n}`,
      referred_phone: "00000000000",
      referred_email: null,
      referred_address: null,
      plan_id: LAB_PLAN_1,
      reward_type: "pix",
      reward_amount: 50,
      status: n === 1 ? "pendente" : n === 2 ? "em_andamento" : "aprovada",
      commercial_profile_id: n === 3 ? LAB_COMERCIAL_2 : LAB_COMERCIAL_1,
      notes: null,
      first_invoice_paid: false,
      first_invoice_paid_at: null,
      approved_at: null,
      rejected_at: null,
      rejection_reason: null,
      created_at: T0,
      updated_at: T0,
    })),
  }
}

export function createControlledTransport() {
  const requests: TransportRequest[] = []
  const events: string[] = []
  const inflight = new Set<number>()
  const releases = new Map<number, () => void>()
  let rules: TransportRule[] = []
  let fixture = syntheticFixture()

  const json = (status: number, body: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "content-range": "0-0/*" },
    })

  function fixtureResponse(url: URL, method: string, accept: string): Response {
    if (url.pathname === "/auth/v1/user") {
      return json(200, { id: LAB_ADMIN_ID, aud: "authenticated", role: "authenticated", email: "admin@lab.invalid", app_metadata: {}, user_metadata: {}, created_at: T0 })
    }
    if (method !== "GET" && method !== "HEAD") return json(405, { code: "LAB_READ_ONLY", message: "read only" })
    const table = url.pathname.replace("/rest/v1/", "")
    const q = url.searchParams
    const select = q.get("select") ?? "*"
    let rows: Array<Record<string, unknown>> = []
    if (table === "profiles") {
      if (q.get("id") === `eq.${LAB_ADMIN_ID}`) {
        rows = [{ id: LAB_ADMIN_ID, role: "admin_master", full_name: "Admin Sintético", email: "admin@lab.invalid", phone: "00000000000", avatar_url: null, created_at: T0, must_change_password: false, is_active: true }]
      } else if (q.get("role") === "eq.comercial") {
        rows = fixture.comerciais
      } else if (q.get("id")?.startsWith("in.")) {
        rows = [...fixture.comerciais, { id: LAB_INDICADOR_1, full_name: "Indicador Sintético", email: "i1@lab.invalid", phone: "00000000000", cpf: null, is_active: true, created_at: T0 }]
      }
    } else if (table === "commercial_availability") {
      rows = [{ commercial_profile_id: LAB_COMERCIAL_1, availability_status: "disponivel", updated_at: T0 }]
    } else if (table === "referrals") {
      rows = /referred_name/.test(select) ? fixture.referrals : fixture.referrals.map((r) => ({ commercial_profile_id: r.commercial_profile_id, status: r.status }))
    } else if (table === "plans") {
      rows = [{ id: LAB_PLAN_1, name: "Plano Sintético", speed_label: "100 Mega", price: 99.9, description: null, reward_amount: 50, is_active: true, sort_order: 0 }]
    }
    if (accept.includes("vnd.pgrst.object")) {
      return rows.length === 1 ? json(200, rows[0]) : json(406, { code: "PGRST116", message: "not single", details: null, hint: null })
    }
    return json(200, rows)
  }

  const transportFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href, "http://127.0.0.1:3000")
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase()
    const signal = init?.signal ?? (typeof input === "object" && "signal" in input ? (input as Request).signal : undefined) ?? undefined
    const headers = new Headers(init?.headers)
    const req: TransportRequest = { id: requests.length + 1, method, url, path: url.pathname, signal, abortEvents: 0, settled: null, rejectName: null }
    requests.push(req)
    events.push(`req:${req.id}:${url.pathname}`)

    const ruleIdx = rules.findIndex((r) => (r.times === undefined || r.times > 0) && r.match({ url, method }))
    const rule = ruleIdx >= 0 ? rules[ruleIdx] : undefined
    if (rule && rule.times !== undefined) rule.times -= 1
    const mode: TransportMode = rule?.mode ?? { kind: "respond" }

    return new Promise<Response>((resolve, reject) => {
      inflight.add(req.id)
      const finish = (how: "resolved" | "rejected", value: unknown) => {
        if (req.settled) return
        req.settled = how
        inflight.delete(req.id)
        releases.delete(req.id)
        signal?.removeEventListener("abort", onAbort)
        events.push(`settle:${req.id}:${how}`)
        if (how === "resolved") resolve(value as Response)
        else {
          req.rejectName = (value as { name?: string } | null)?.name ?? String(value)
          reject(value)
        }
      }
      const respond = (m: { status?: number; body?: unknown }) =>
        m.body === undefined && (m.status ?? 200) === 200 ? fixtureResponse(url, method, headers.get("accept") ?? "") : json(m.status ?? 200, m.body)
      function onAbort() {
        req.abortEvents += 1
        events.push(`abort:${req.id}`)
        if (mode.kind === "ignoreAbort") return
        finish("rejected", signal?.reason ?? new DOMException("aborted", "AbortError"))
      }
      if (signal?.aborted) {
        events.push(`pre-aborted:${req.id}`)
        if (mode.kind !== "ignoreAbort") return finish("rejected", signal.reason ?? new DOMException("aborted", "AbortError"))
      } else signal?.addEventListener("abort", onAbort)

      if (mode.kind === "respond") queueMicrotask(() => finish("resolved", respond(mode)))
      else if (mode.kind === "ignoreAbort") releases.set(req.id, () => finish("resolved", respond(mode)))
      // hang: só termina por abort
    })
  }

  return {
    fetch: transportFetch as typeof fetch,
    requests,
    events,
    inflight,
    setRules(next: TransportRule[]) { rules = next },
    setFixture(next: Fixture) { fixture = next },
    release(id: number) { releases.get(id)?.() },
    reset() { requests.length = 0; events.length = 0; inflight.clear(); releases.clear(); rules = []; fixture = syntheticFixture() },
    rest() { return requests.filter((r) => r.path.startsWith("/rest/v1/")) },
  }
}

export type ControlledTransport = ReturnType<typeof createControlledTransport>

/** Timers falsos com contagem de ativos (timer limpo em todos os caminhos). */
export function fakeTimers() {
  let next = 1
  const active = new Map<number, () => void>()
  let created = 0
  return {
    set: (fn: () => void) => { const id = next++; created++; active.set(id, fn); return id },
    clear: (h: unknown) => { active.delete(h as number) },
    fireAll() { for (const [id, fn] of [...active]) { active.delete(id); fn() } },
    get active() { return active.size },
    get created() { return created },
  }
}

/** AbortController instrumentado: listeners vivos por signal (detecta acúmulo entre tentativas). */
export function instrumentedControllers() {
  const created: Array<{ controller: AbortController; live: Set<unknown> }> = []
  const factory = () => {
    const controller = new AbortController()
    const live = new Set<unknown>()
    const sig = controller.signal
    const add = sig.addEventListener.bind(sig)
    const rem = sig.removeEventListener.bind(sig)
    const wrappers = new Map<unknown, EventListenerOrEventListenerObject>()
    sig.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
      const once = typeof opts === "object" && opts?.once
      const wrapped: EventListenerOrEventListenerObject = once
        ? (ev: Event) => { live.delete(fn); wrappers.delete(fn); typeof fn === "function" ? fn(ev) : fn.handleEvent(ev) }
        : fn
      wrappers.set(fn, wrapped)
      live.add(fn)
      add(type, wrapped, opts)
    }) as typeof sig.addEventListener
    sig.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions) => {
      rem(type, wrappers.get(fn) ?? fn, opts)
      wrappers.delete(fn)
      live.delete(fn)
    }) as typeof sig.removeEventListener
    created.push({ controller, live })
    return controller
  }
  return {
    factory,
    created,
    signals: () => created.map((c) => c.controller.signal),
    liveListeners: () => created.reduce((n, c) => n + c.live.size, 0),
  }
}

export async function waitFor(cond: () => boolean, ticks = 400): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    if (cond()) return
    await new Promise((r) => setImmediate(r))
  }
  if (!cond()) throw new Error("waitFor: condição não atingida")
}

/** Espera o transporte ficar estável (nenhum request novo/encerrado por N ticks). */
export async function quiesce(t: { requests: TransportRequest[]; inflight: Set<number> }, stableTicks = 60, max = 3000): Promise<void> {
  let last = ""
  let stable = 0
  for (let i = 0; i < max; i++) {
    const sig = `${t.requests.length}:${t.inflight.size}:${t.requests.filter((r) => r.settled).length}`
    stable = sig === last ? stable + 1 : 0
    last = sig
    if (stable >= stableTicks) return
    await new Promise((r) => setImmediate(r))
  }
  throw new Error("quiesce: transporte não estabilizou")
}
