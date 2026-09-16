import {
  buildSanitizedControllrHttpDiagnostics,
  type SanitizedControllrHttpDiagnostics,
} from "@/lib/brbyte/http-error-diagnostics"

/** AbortSignal só deixa de aguardar no cliente; não cancela o ERP remoto. */
export const CONTROLLR_HTTP_ABORT_DOES_NOT_CANCEL_SERVER = true
/** JSON.parse síncrono não é interrompido pelo timer durante o event loop. */
export const CONTROLLR_HTTP_SYNC_PARSE_NOT_PREEMPTIVE = true

export type ControllrHttpAbortClass = "timeout" | "external_abort" | "transport"

export type ControllrHttpPostResult = {
  ok: boolean
  status: number | null
  json: unknown
  message?: string
  abortClass?: ControllrHttpAbortClass
  bodyReadComplete: boolean
  deadlineExceededDuringParse: boolean
  diagnostics?: SanitizedControllrHttpDiagnostics
}

export type ControllrHttpFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

export type ControllrHttpPostInput = {
  url: string
  headers: Record<string, string>
  body: URLSearchParams
  timeoutMs: number
  maxAttempts?: number
  signal?: AbortSignal
  fetchImpl?: ControllrHttpFetch
  pathForLog?: string
  fieldsForDiagnostics?: Record<string, string>
}

type DeadlineRequestResult =
  | {
      ok: true
      status: number
      text: string
      headers: Headers
      bodyReadComplete: true
      elapsedMs: number
    }
  | {
      ok: false
      status: number | null
      text: null
      headers: null
      bodyReadComplete: boolean
      abortClass: ControllrHttpAbortClass
      message: string
    }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const name = (error as { name?: string }).name
  return name === "AbortError" || name === "TimeoutError"
}

function sanitizeLogMessage(message: string): string {
  if (/cookie|password|authorization|bearer|secret/i.test(message)) {
    return "sanitized_error"
  }
  return message.slice(0, 240)
}

function combineSignals(internal: AbortSignal, external?: AbortSignal): AbortSignal {
  if (!external) return internal
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([internal, external])
  }
  if (external.aborted) return external
  const combined = new AbortController()
  const abortCombined = () => combined.abort()
  internal.addEventListener("abort", abortCombined, { once: true })
  external.addEventListener("abort", abortCombined, { once: true })
  return combined.signal
}

function classifyAbort(input: {
  timedOut: boolean
  externalSignal?: AbortSignal
}): ControllrHttpAbortClass {
  if (input.externalSignal?.aborted && !input.timedOut) return "external_abort"
  return "timeout"
}

function abortMessage(abortClass: ControllrHttpAbortClass): string {
  if (abortClass === "external_abort") {
    return "Operação cancelada pelo chamador."
  }
  if (abortClass === "transport") {
    return "Falha de transporte na chamada Controllr."
  }
  return "Operação abortada pelo timeout local do CRM."
}

/**
 * Timeout único da chamada: espera pelos headers e leitura do corpo.
 * O timer não reinicia quando os headers chegam.
 */
export async function requestControllrWithDeadline(input: {
  url: string
  headers: Record<string, string>
  body: URLSearchParams
  timeoutMs: number
  signal?: AbortSignal
  fetchImpl?: ControllrHttpFetch
}): Promise<DeadlineRequestResult> {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs))
  const fetchImpl = input.fetchImpl ?? fetch
  const startedAt = Date.now()
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const signal = combineSignals(controller.signal, input.signal)
  let status: number | null = null

  try {
    const res = await fetchImpl(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      signal,
      cache: "no-store",
    })
    status = res.status
    const text = await res.text()
    return {
      ok: true,
      status: res.status,
      text,
      headers: res.headers,
      bodyReadComplete: true,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    const aborted =
      isAbortError(error) || timedOut || Boolean(input.signal?.aborted)
    if (aborted) {
      const abortClass = classifyAbort({
        timedOut,
        externalSignal: input.signal,
      })
      return {
        ok: false,
        status,
        text: null,
        headers: null,
        bodyReadComplete: false,
        abortClass,
        message: abortMessage(abortClass),
      }
    }
    return {
      ok: false,
      status,
      text: null,
      headers: null,
      bodyReadComplete: false,
      abortClass: "transport",
      message: sanitizeLogMessage(
        error instanceof Error ? error.message : String(error)
      ),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function postControllrForm(
  input: ControllrHttpPostInput
): Promise<ControllrHttpPostResult> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2)
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs))
  const path = input.pathForLog ?? "controllr"
  let lastMessage: string | undefined
  let lastStatus: number | null = null
  let lastAbort: ControllrHttpAbortClass | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now()
    const fetched = await requestControllrWithDeadline({
      url: input.url,
      headers: input.headers,
      body: input.body,
      timeoutMs,
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    })

    if (!fetched.ok) {
      lastStatus = fetched.status
      lastAbort = fetched.abortClass
      lastMessage = fetched.message
      console.error("[brbyte:create-interest:http]", {
        path,
        attempt,
        abortClass: fetched.abortClass,
        status: fetched.status,
        message: fetched.message,
      })
      if (fetched.abortClass === "transport" && attempt < maxAttempts) {
        await sleep(400 * attempt)
        continue
      }
      return {
        ok: false,
        status: fetched.status,
        json: null,
        message: fetched.message,
        abortClass: fetched.abortClass,
        bodyReadComplete: fetched.bodyReadComplete,
        deadlineExceededDuringParse: false,
      }
    }

    lastStatus = fetched.status
    let json: unknown = null
    let parseFailed = false
    if (fetched.text) {
      try {
        json = JSON.parse(fetched.text) as unknown
      } catch {
        json = null
        parseFailed = true
      }
    }
    const deadlineExceededDuringParse = Date.now() - startedAt > timeoutMs
    if (deadlineExceededDuringParse) {
      return {
        ok: false,
        status: fetched.status,
        json: null,
        message: abortMessage("timeout"),
        abortClass: "timeout",
        bodyReadComplete: true,
        deadlineExceededDuringParse: true,
      }
    }

    if (parseFailed) {
      lastMessage = "Resposta não JSON do Controllr."
      const diagnostics = buildSanitizedControllrHttpDiagnostics({
        path,
        status: fetched.status,
        attempt,
        fields: input.fieldsForDiagnostics,
        bodyText: "",
        json: null,
      })
      return {
        ok: false,
        status: fetched.status,
        json: null,
        message: lastMessage,
        bodyReadComplete: true,
        deadlineExceededDuringParse: false,
        diagnostics,
      }
    }

    if (fetched.status < 200 || fetched.status >= 300) {
      lastMessage = `HTTP ${fetched.status}`
      const diagnostics = buildSanitizedControllrHttpDiagnostics({
        path,
        status: fetched.status,
        attempt,
        fields: input.fieldsForDiagnostics,
        bodyText: fetched.text,
        json,
      })
      console.warn("[brbyte:create-interest:http]", {
        path: diagnostics.path,
        attempt: diagnostics.attempt,
        status: diagnostics.status,
        errorClass: diagnostics.errorClass,
        fieldCount: diagnostics.fieldCount,
        fieldKeysSent: diagnostics.fieldKeysSent,
        omittedEmptyFieldCount: diagnostics.omittedEmptyFieldCount,
        responseContentTypeHint: diagnostics.responseContentTypeHint,
        responseKeys: diagnostics.responseKeys,
        responseMessageHint: diagnostics.responseMessageHint,
        bodyByteLength: diagnostics.bodyByteLength,
      })
      if (attempt < maxAttempts) {
        await sleep(400 * attempt)
        continue
      }
      return {
        ok: false,
        status: fetched.status,
        json,
        message: lastMessage,
        bodyReadComplete: true,
        deadlineExceededDuringParse: false,
        diagnostics,
      }
    }

    return {
      ok: true,
      status: fetched.status,
      json,
      bodyReadComplete: true,
      deadlineExceededDuringParse: false,
    }
  }

  return {
    ok: false,
    status: lastStatus,
    json: null,
    message: lastMessage,
    abortClass: lastAbort,
    bodyReadComplete: false,
    deadlineExceededDuringParse: false,
  }
}

export function parseBrbosCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null
  const match = setCookieHeader.match(/BRBOSCookie=([^;]+)/i)
  return match ? `BRBOSCookie=${match[1]}` : null
}

export async function loginControllr(input: {
  url: string
  username: string
  password: string
  timeoutMs: number
  signal?: AbortSignal
  fetchImpl?: ControllrHttpFetch
}): Promise<
  | { cookie: string; httpStatus: number }
  | {
      error: string
      httpStatus: number | null
      abortClass?: ControllrHttpAbortClass
    }
> {
  const fetched = await requestControllrWithDeadline({
    url: input.url,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      username: input.username,
      password: input.password,
    }),
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  })

  if (!fetched.ok) {
    console.error("[brbyte:create-interest:http]", {
      step: "login",
      abortClass: fetched.abortClass,
      status: fetched.status,
      message: fetched.message,
    })
    return {
      error: fetched.message,
      httpStatus: fetched.status,
      abortClass: fetched.abortClass,
    }
  }

  if (fetched.status < 200 || fetched.status >= 300) {
    return {
      error: `Login BRByte HTTP ${fetched.status}`,
      httpStatus: fetched.status,
    }
  }

  const cookie = parseBrbosCookie(fetched.headers.get("set-cookie"))
  if (!cookie) {
    return {
      error: "Cookie BRBOSCookie não retornado no login BRByte.",
      httpStatus: fetched.status,
    }
  }
  return { cookie, httpStatus: fetched.status }
}
