/**
 * 3.1F-K1: cliente Supabase simulado (somente leitura) para medir chamadas de auth/dados
 * dos loaders legados. Nenhuma rede, nenhum dado real. Escrita => falha imediata.
 */
export const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1"
export const COMERCIAL_ID = "00000000-0000-4000-8000-0000000000c1"
export const INDICADOR_ID = "00000000-0000-4000-8000-0000000000d1"

export type FakeScenario = {
  role?: string | null
  authError?: boolean
  profilesListError?: boolean
  /** lista de comerciais retorna `data: null` sem erro (resposta inesperada) */
  profilesListNull?: boolean
  referralsError?: boolean
  comerciais?: number
  /** atraso artificial (ms) por consulta */
  delayMs?: number
  /** consulta pendurada para sempre (simula rede travada) */
  hang?: boolean
  /** 3.1F-K1S: auth.getUser() lança o erro do auth-js quando outro pedido rouba o lock (navigator.locks). */
  lockStolen?: boolean
  /** 3.1F-K1S: lista de indicações válida e vazia. */
  referralsEmpty?: boolean
}

export const counters = { getUser: 0, from: 0, writes: 0, signals: 0, tables: [] as string[], queries: [] as string[] }
export const scenario: FakeScenario = {}

export function resetFake(next: FakeScenario = {}): void {
  counters.getUser = 0
  counters.from = 0
  counters.writes = 0
  counters.tables = []
  counters.queries = []
  for (const k of Object.keys(scenario)) delete (scenario as Record<string, unknown>)[k]
  Object.assign(scenario, { role: "admin_master", comerciais: 1 }, next)
  counters.signals = 0
}

const WRITE = new Set(["insert", "update", "upsert", "delete", "rpc"])

function rowsFor(table: string, ops: string[]): { data: unknown; error: unknown } {
  const has = (p: string) => ops.some((o) => o.startsWith(p))
  if (table === "profiles") {
    if (has("eq:\"role\"")) {
      if (scenario.profilesListError) return { data: null, error: { message: "permission denied", code: "42501" } }
      if (scenario.profilesListNull) return { data: null, error: null }
      const n = scenario.comerciais ?? 1
      return {
        data: Array.from({ length: n }, (_, i) => ({
          id: i === 0 ? COMERCIAL_ID : `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
          full_name: `Lab Comercial ${i + 1}`,
          email: `c${i + 1}@lab.invalid`,
          phone: "",
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        })),
        error: null,
      }
    }
    return {
      data: [
        { id: INDICADOR_ID, full_name: "Lab Indicador", email: "i@lab.invalid", phone: "", cpf: null, is_active: true, created_at: "2026-01-01T00:00:00Z" },
        { id: COMERCIAL_ID, full_name: "Lab Comercial 1", email: "c1@lab.invalid", phone: "", cpf: null, is_active: true, created_at: "2026-01-01T00:00:00Z" },
      ],
      error: null,
    }
  }
  if (table === "referrals") {
    if (scenario.referralsError) return { data: null, error: { message: "boom", code: "XX000" } }
    if (scenario.referralsEmpty && !has("select:\"commercial_profile_id, status\"")) return { data: [], error: null }
    if (has("select:\"commercial_profile_id, status\"")) return { data: [{ commercial_profile_id: COMERCIAL_ID, status: "pendente" }], error: null }
    return {
      data: [
        {
          id: "00000000-0000-4000-8000-0000000000e1",
          indicator_profile_id: INDICADOR_ID,
          referred_name: "Lab Indicado",
          referred_phone: "0000",
          referred_email: null,
          referred_address: null,
          plan_id: "00000000-0000-4000-8000-0000000000f1",
          reward_type: "pix",
          reward_amount: 0,
          status: "pendente",
          commercial_profile_id: COMERCIAL_ID,
          notes: null,
          first_invoice_paid: false,
          first_invoice_paid_at: null,
          approved_at: null,
          rejected_at: null,
          rejection_reason: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
    }
  }
  return { data: [], error: null }
}

function single(table: string): { data: unknown; error: unknown } {
  if (table === "profiles") {
    if (scenario.role == null) return { data: null, error: null }
    return {
      data: {
        id: ADMIN_ID,
        role: scenario.role,
        full_name: "Lab Admin",
        email: "a@lab.invalid",
        phone: "",
        avatar_url: null,
        created_at: "2026-01-01T00:00:00Z",
        must_change_password: false,
        is_active: true,
      },
      error: null,
    }
  }
  return { data: null, error: null }
}

async function settle<T>(v: T): Promise<T> {
  if (scenario.hang) return new Promise<T>(() => {})
  if (scenario.delayMs) await new Promise((r) => setTimeout(r, scenario.delayMs))
  return v
}

function builder(table: string) {
  const ops: string[] = []
  let throwOnError = false
  const target = function () {} as unknown as Record<string, unknown>
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") {
        counters.queries.push(`${table}|${ops.join("|")}`)
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          settle(rowsFor(table, ops)).then((r) => {
            if (throwOnError && r.error) throw r.error
            return r
          }).then(res, rej)
      }
      if (prop === "maybeSingle" || prop === "single") return () => { counters.queries.push(`${table}|${ops.join("|")}|single`); return settle(single(table)) }
      if (prop === "throwOnError") return () => { throwOnError = true; return proxy }
      if (WRITE.has(prop)) {
        counters.writes++
        return () => { throw new Error("write attempted in read-only fake") }
      }
      return (...args: unknown[]) => {
        if (prop === "abortSignal") counters.signals++
        ops.push(`${prop}:${JSON.stringify(args[0])}`)
        return proxy
      }
    },
  })
  return proxy
}

export function fakeSupabaseClient() {
  return {
    auth: {
      getUser: async () => {
        counters.getUser++
        if (scenario.lockStolen) {
          // Mesmo erro do auth-js 2.105.1 (lib/locks.js navigatorLock): o detentor perde o lock para um "steal".
          throw Object.assign(new Error('Lock "lock:sb-lab-auth-token" was released because another request stole it'), {
            name: "NavigatorLockAcquireTimeoutError",
            isAcquireTimeout: true,
          })
        }
        if (scenario.hang) return new Promise(() => {})
        if (scenario.delayMs) await new Promise((r) => setTimeout(r, scenario.delayMs))
        if (scenario.authError) return { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" } }
        return { data: { user: { id: ADMIN_ID } }, error: null }
      },
      getSession: async () => { throw new Error("getSession must not be used by K1 loaders") },
    },
    from(table: string) {
      counters.from++
      counters.tables.push(table)
      return builder(table)
    },
    rpc: () => { counters.writes++; throw new Error("rpc not allowed") },
  }
}
