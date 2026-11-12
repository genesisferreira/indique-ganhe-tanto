/**
 * 3.1F-K1 — Loader resiliente para telas administrativas legadas (client-side).
 *
 * Modelo de estado explícito: idle → loading → success | empty | error | timeout.
 * Regras (ver docs/k1-legacy-loaders.md):
 * - `empty` somente após resposta válida com lista realmente vazia;
 * - erro, null inesperado, shape inválido e timeout NUNCA viram lista vazia;
 * - todo carregamento termina (finally limpa timer/estado);
 * - resposta antiga nunca sobrescreve a mais recente (sequência + AbortController);
 * - após dispose (desmontagem) nenhum estado é emitido;
 * - sem retry automático: nova tentativa somente por ação explícita (`run`).
 */

/** Timeout padrão (ms) dos loaders legados. 15 s: acima do p99 observado no lab (~1 s), sem esconder lentidão. */
export const LEGACY_LOADER_TIMEOUT_MS = 15_000

export type LoaderErrorClass =
  | "unauthenticated"
  | "forbidden"
  | "server_error"
  | "invalid_response"
  | "network"
  | "unexpected"

export type LoaderState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "empty"; data: T }
  | { status: "error"; errorClass: LoaderErrorClass }
  | { status: "timeout" }

export type LoadOutcome<T> =
  | { kind: "data"; data: T; empty: boolean }
  | { kind: "error"; errorClass: LoaderErrorClass }

export class LoaderError extends Error {
  readonly errorClass: LoaderErrorClass
  constructor(errorClass: LoaderErrorClass) {
    super(errorClass)
    this.name = "LoaderError"
    this.errorClass = errorClass
  }
}

export function dataOutcome<T>(data: T, empty: boolean): LoadOutcome<T> {
  return { kind: "data", data, empty }
}

export function errorOutcome<T>(errorClass: LoaderErrorClass): LoadOutcome<T> {
  return { kind: "error", errorClass }
}

/** Classe de erro a partir do status HTTP (nunca a partir do texto da mensagem). */
export function classifyHttpStatus(status: number): LoaderErrorClass {
  if (status === 401) return "unauthenticated"
  if (status === 403) return "forbidden"
  if (status >= 500) return "server_error"
  return "invalid_response"
}

/**
 * Lista validada: null/undefined/não-array/item inválido => `invalid_response` (nunca `[]`).
 * Lista vazia válida => `empty`.
 */
export function listOutcome<T>(value: unknown, isItem?: (item: unknown) => boolean): LoadOutcome<T[]> {
  if (!Array.isArray(value)) return errorOutcome("invalid_response")
  if (isItem && !value.every((item) => isItem(item))) return errorOutcome("invalid_response")
  return dataOutcome(value as T[], value.length === 0)
}

export type LoaderRunOptions = {
  /** Não emite `loading` (mantém conteúdo atual na tela até o resultado). */
  silent?: boolean
  /** Cancela o carregamento em andamento e inicia outro (mudança de filtro). */
  supersede?: boolean
}

type TimerHandle = unknown

export type GuardedLoaderOptions<T> = {
  load: (ctx: { signal: AbortSignal; attempt: number }) => Promise<LoadOutcome<T>>
  onState: (state: LoaderState<T>) => void
  timeoutMs?: number
  timers?: {
    set: (fn: () => void, ms: number) => TimerHandle
    clear: (handle: TimerHandle) => void
  }
}

export type GuardedLoader = {
  /** Inicia um carregamento. Chamadas durante um carregamento em andamento são coalescidas (no máximo 1 pendente). */
  run: (opts?: LoaderRunOptions) => Promise<void>
  /** Inicia no próximo microtask; se `dispose` vier antes (StrictMode), nada é carregado. */
  start: () => void
  dispose: () => void
  readonly disposed: boolean
  readonly inFlight: boolean
}

const TIMEOUT_REASON = "k1-loader-timeout"
const SUPERSEDED_REASON = "k1-loader-superseded"
const DISPOSED_REASON = "k1-loader-disposed"

export function createGuardedLoader<T>(options: GuardedLoaderOptions<T>): GuardedLoader {
  const timeoutMs = options.timeoutMs ?? LEGACY_LOADER_TIMEOUT_MS
  const timers = options.timers ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
  let seq = 0
  let disposed = false
  let current: AbortController | null = null
  let pending: LoaderRunOptions | null = null

  const emit = (state: LoaderState<T>, mySeq: number) => {
    if (disposed || mySeq !== seq) return
    options.onState(state)
  }

  async function run(opts: LoaderRunOptions = {}): Promise<void> {
    if (disposed) return
    if (current && !opts.supersede) {
      // Coalescência: um único recarregamento pendente, sem duplicar chamadas.
      pending = { silent: (pending?.silent ?? true) && Boolean(opts.silent) }
      return
    }
    if (current && opts.supersede) {
      current.abort(SUPERSEDED_REASON)
      pending = null
    }
    const mySeq = ++seq
    const controller = new AbortController()
    current = controller
    let timedOut = false
    const timer = timers.set(() => {
      timedOut = true
      controller.abort(TIMEOUT_REASON)
    }, timeoutMs)

    if (!opts.silent) emit({ status: "loading" }, mySeq)

    let final: LoaderState<T> | null = null
    try {
      const aborted = new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new LoaderError("unexpected"))
        controller.signal.addEventListener("abort", () => reject(new LoaderError("unexpected")), { once: true })
      })
      const outcome = await Promise.race([options.load({ signal: controller.signal, attempt: mySeq }), aborted])
      if (!outcome || typeof outcome !== "object" || !("kind" in outcome)) {
        final = { status: "error", errorClass: "invalid_response" }
      } else if (outcome.kind === "error") {
        final = { status: "error", errorClass: outcome.errorClass }
      } else {
        final = outcome.empty ? { status: "empty", data: outcome.data } : { status: "success", data: outcome.data }
      }
      if (timedOut) final = { status: "timeout" }
    } catch (thrown) {
      if (timedOut) final = { status: "timeout" }
      else if (controller.signal.aborted) final = null // substituído ou desmontado: descartado
      else final = { status: "error", errorClass: thrown instanceof LoaderError ? thrown.errorClass : "unexpected" }
    } finally {
      timers.clear(timer)
      if (current === controller) current = null
    }

    if (final) emit(final, mySeq)

    if (!disposed && current === null && pending) {
      const next = pending
      pending = null
      await run(next)
    }
  }

  let startQueued = false
  return {
    run,
    start() {
      if (startQueued || disposed) return
      startQueued = true
      queueMicrotask(() => {
        if (!disposed) void run()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      pending = null
      current?.abort(DISPOSED_REASON)
      current = null
    },
    get disposed() {
      return disposed
    },
    get inFlight() {
      return current !== null
    },
  }
}

/** Mensagem amigável por estado (sem detalhes técnicos, sem texto original de erro). */
export function loaderErrorMessage(errorClass: LoaderErrorClass): string {
  switch (errorClass) {
    case "unauthenticated":
      return "Sua sessão expirou. Entre novamente para continuar."
    case "forbidden":
      return "Seu perfil não tem acesso a esta lista."
    case "network":
      return "Não foi possível conectar ao servidor. Verifique sua conexão."
    default:
      return "Não foi possível carregar os dados."
  }
}

export const LOADER_TIMEOUT_MESSAGE = "A consulta demorou mais do que o esperado e foi interrompida."

/**
 * fetch + JSON com AbortSignal. Falha de rede => LoaderError("network"); abort é propagado
 * (o controlador decide entre timeout e substituição). Nunca lê o texto do erro.
 */
export async function fetchJsonForLoader(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<{ status: number; ok: boolean; json: unknown }> {
  let res: Response
  try {
    res = await fetchImpl(url, { cache: "no-store", signal, credentials: "same-origin" })
  } catch (thrown) {
    if (signal.aborted) throw thrown
    throw new LoaderError("network")
  }
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    if (signal.aborted) throw new LoaderError("unexpected")
    json = null
  }
  return { status: res.status, ok: res.ok, json }
}
