import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import {
  CONTROLLR_HTTP_ABORT_DOES_NOT_CANCEL_SERVER,
  CONTROLLR_HTTP_SYNC_PARSE_NOT_PREEMPTIVE,
  loginControllr,
  postControllrForm,
  type ControllrHttpFetch,
} from "@/lib/brbyte/admin-http-request"

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error("This operation was aborted")
  error.name = "AbortError"
  return error
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function createTimedFetch(script: {
  headerDelayMs: number
  bodyDelayMs: number
  status?: number
  body?: string
  headers?: Record<string, string>
  throwTransport?: boolean
}): { fetch: ControllrHttpFetch; state: { calls: number; aborts: number } } {
  const state = { calls: 0, aborts: 0 }
  const fetchImpl: ControllrHttpFetch = async (_url, init) => {
    state.calls += 1
    const signal = init?.signal ?? undefined
    const onAbort = () => {
      state.aborts += 1
    }
    signal?.addEventListener("abort", onAbort)
    if (script.throwTransport) {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1")
    }
    await wait(script.headerDelayMs, signal)
    const payload = script.body ?? '{"success":true,"results":[]}'
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await wait(script.bodyDelayMs, signal)
          controller.enqueue(new TextEncoder().encode(payload))
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
    })
    return new Response(stream, {
      status: script.status ?? 200,
      headers: {
        "Content-Type": "application/json",
        ...(script.headers ?? {}),
      },
    })
  }
  return { fetch: fetchImpl, state }
}

function postInput(
  fetchImpl: ControllrHttpFetch,
  timeoutMs: number,
  extra?: Partial<Parameters<typeof postControllrForm>[0]>
) {
  return postControllrForm({
    url: "https://controllr.test/invoice_ctl/invoice/list",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: "BRBOSCookie=test",
    },
    body: new URLSearchParams({ where: "[]", page: "1" }),
    timeoutMs,
    maxAttempts: extra?.maxAttempts ?? 1,
    fetchImpl,
    pathForLog: "/invoice_ctl/invoice/list",
    fieldsForDiagnostics: { where: "[]", page: "1" },
    ...extra,
  })
}

const originalError = console.error
const originalWarn = console.warn
const logs: string[] = []

function captureLogs() {
  logs.length = 0
  const sink = (...args: unknown[]) => {
    logs.push(args.map((value) => JSON.stringify(value)).join(" "))
  }
  console.error = sink
  console.warn = sink
}

afterEach(() => {
  console.error = originalError
  console.warn = originalWarn
})

describe("timeout inclui headers e corpo", () => {
  it("A — timeout antes dos headers não fabrica HTTP 0", async () => {
    captureLogs()
    const timed = createTimedFetch({ headerDelayMs: 80, bodyDelayMs: 0 })
    const result = await postInput(timed.fetch, 25, { maxAttempts: 2 })
    assert.equal(result.ok, false)
    assert.equal(result.status, null)
    assert.equal(result.abortClass, "timeout")
    assert.equal(result.bodyReadComplete, false)
    assert.equal(result.json, null)
    assert.equal(timed.state.calls, 1)
    assert.equal(JSON.stringify(result).includes('"status":0'), false)
    assert.equal(CONTROLLR_HTTP_ABORT_DOES_NOT_CANCEL_SERVER, true)
  })

  it("B — timeout durante a leitura do corpo preserva HTTP real", async () => {
    captureLogs()
    const timed = createTimedFetch({
      headerDelayMs: 20,
      bodyDelayMs: 80,
      status: 200,
    })
    const result = await postInput(timed.fetch, 40)
    assert.equal(result.ok, false)
    assert.equal(result.status, 200)
    assert.equal(result.abortClass, "timeout")
    assert.equal(result.bodyReadComplete, false)
    assert.equal(result.json, null)
  })

  it("C — espera pelos headers reduz o prazo restante do body", async () => {
    captureLogs()
    const timed = createTimedFetch({
      headerDelayMs: 70,
      bodyDelayMs: 70,
      status: 200,
    })
    const started = Date.now()
    const result = await postInput(timed.fetch, 100)
    const elapsed = Date.now() - started
    assert.equal(result.ok, false)
    assert.equal(result.status, 200)
    assert.equal(result.abortClass, "timeout")
    assert.equal(elapsed < 160, true)
  })

  it("D — sucesso limpa o timer e não aborta depois", async () => {
    captureLogs()
    const timed = createTimedFetch({
      headerDelayMs: 10,
      bodyDelayMs: 10,
      body: '{"success":true,"results":[1]}',
    })
    const result = await postInput(timed.fetch, 200)
    assert.equal(result.ok, true)
    assert.equal(result.status, 200)
    assert.equal(result.bodyReadComplete, true)
    await wait(250)
    assert.equal(timed.state.aborts, 0)
  })

  it("E — HTTP 200 com corpo incompleto não vira sucesso", async () => {
    captureLogs()
    const timed = createTimedFetch({
      headerDelayMs: 15,
      bodyDelayMs: 80,
      status: 200,
      body: '{"success":true,"results":[{"invoice_pk":1}]}',
    })
    const result = await postInput(timed.fetch, 40)
    assert.equal(result.ok, false)
    assert.equal(result.status, 200)
    assert.equal(result.abortClass, "timeout")
    assert.equal(result.json, null)
  })

  it("F — cancelamento externo não faz retry", async () => {
    captureLogs()
    const timed = createTimedFetch({ headerDelayMs: 80, bodyDelayMs: 0 })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const result = await postInput(timed.fetch, 500, {
      maxAttempts: 2,
      signal: controller.signal,
    })
    assert.equal(result.ok, false)
    assert.equal(result.abortClass, "external_abort")
    assert.equal(result.status, null)
    assert.equal(timed.state.calls, 1)
  })

  it("G — parse inválido sanitiza logs e não devolve body bruto", async () => {
    captureLogs()
    const timed = createTimedFetch({
      headerDelayMs: 5,
      bodyDelayMs: 5,
      body: "<html>password=super-secret BRBOSCookie=abc123 token=xyz</html>",
    })
    const result = await postInput(timed.fetch, 200)
    assert.equal(result.ok, false)
    assert.equal(result.status, 200)
    assert.equal(result.json, null)
    assert.equal(result.message, "Resposta não JSON do Controllr.")
    const dumped = logs.join("\n")
    assert.equal(dumped.includes("super-secret"), false)
    assert.equal(dumped.includes("abc123"), false)
    assert.equal(JSON.stringify(result).includes("super-secret"), false)
  })

  it("H — timeout menor que o default de 30s é respeitado", async () => {
    captureLogs()
    const timed = createTimedFetch({ headerDelayMs: 80, bodyDelayMs: 0 })
    const result = await postInput(timed.fetch, 30)
    assert.equal(result.ok, false)
    assert.equal(result.abortClass, "timeout")
    assert.equal(result.status, null)
    assert.equal(timed.state.calls, 1)
  })
})

describe("login drena o corpo dentro do mesmo deadline", () => {
  it("sucesso lê Set-Cookie após o corpo", async () => {
    captureLogs()
    const timed = createTimedFetch({
      headerDelayMs: 10,
      bodyDelayMs: 10,
      body: '{"ok":true}',
      headers: { "set-cookie": "BRBOSCookie=session" },
    })
    const result = await loginControllr({
      url: "https://controllr.test/login",
      username: "operador",
      password: "secret-password",
      timeoutMs: 200,
      fetchImpl: timed.fetch,
    })
    assert.equal("cookie" in result, true)
    if ("cookie" in result) {
      assert.equal(result.cookie, "BRBOSCookie=session")
      assert.equal(result.httpStatus, 200)
    }
    assert.equal(logs.join("\n").includes("secret-password"), false)
  })

  it("timeout no corpo preserva HTTP e não inventa cookie", async () => {
    captureLogs()
    const timed = createTimedFetch({
      headerDelayMs: 15,
      bodyDelayMs: 80,
      status: 200,
      headers: { "set-cookie": "BRBOSCookie=session" },
    })
    const result = await loginControllr({
      url: "https://controllr.test/login",
      username: "operador",
      password: "secret-password",
      timeoutMs: 40,
      fetchImpl: timed.fetch,
    })
    assert.equal("error" in result, true)
    if ("error" in result) {
      assert.equal(result.httpStatus, 200)
      assert.equal(result.abortClass, "timeout")
    }
    assert.equal("cookie" in result, false)
  })
})

describe("limitações de abort e parse", () => {
  it("não garante cancelamento no servidor e parse não é preemptivo", () => {
    assert.equal(CONTROLLR_HTTP_ABORT_DOES_NOT_CANCEL_SERVER, true)
    assert.equal(CONTROLLR_HTTP_SYNC_PARSE_NOT_PREEMPTIVE, true)
  })

  it("erro de transporte pode retry; timeout não", async () => {
    captureLogs()
    const transport = createTimedFetch({
      headerDelayMs: 0,
      bodyDelayMs: 0,
      throwTransport: true,
    })
    const failed = await postInput(transport.fetch, 100, { maxAttempts: 2 })
    assert.equal(failed.abortClass, "transport")
    assert.equal(transport.state.calls, 2)

    const timed = createTimedFetch({ headerDelayMs: 80, bodyDelayMs: 0 })
    const timeout = await postInput(timed.fetch, 20, { maxAttempts: 2 })
    assert.equal(timeout.abortClass, "timeout")
    assert.equal(timed.state.calls, 1)
  })
})
