import "server-only"

import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import {
  buildSanitizedControllrHttpDiagnostics,
  type SanitizedControllrHttpDiagnostics,
} from "@/lib/brbyte/http-error-diagnostics"

const LOG_TAG = "[brbyte:create-interest:http]"

export type BrbyteAdminPostResult = {
  ok: boolean
  status: number | null
  json: unknown
  message?: string
  /** Presente em falhas HTTP — sem PII/credenciais. */
  diagnostics?: SanitizedControllrHttpDiagnostics
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseBrbosCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null
  const match = setCookieHeader.match(/BRBOSCookie=([^;]+)/i)
  return match ? `BRBOSCookie=${match[1]}` : null
}

export async function brbyteAdminLogin(
  config: BrbyteCreateInterestConfig
): Promise<
  | { cookie: string; httpStatus: number }
  | { error: string; httpStatus: number | null }
> {
  const base = config.apiUrl.replace(/\/$/, "")
  const url = `${base}/login`
  const body = new URLSearchParams({
    username: config.apiUser,
    password: config.apiPassword,
  })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    })

    clearTimeout(timeout)

    if (!res.ok) {
      return { error: `Login BRByte HTTP ${res.status}`, httpStatus: res.status }
    }

    const cookie = parseBrbosCookie(res.headers.get("set-cookie"))
    if (!cookie) {
      return {
        error: "Cookie BRBOSCookie não retornado no login BRByte.",
        httpStatus: res.status,
      }
    }

    return { cookie, httpStatus: res.status }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(LOG_TAG, { step: "login", message })
    return { error: message, httpStatus: null }
  }
}

export async function brbyteAdminPostForm(
  config: BrbyteCreateInterestConfig,
  cookie: string,
  path: string,
  fields: Record<string, string>,
  options?: { maxAttempts?: number }
): Promise<BrbyteAdminPostResult> {
  const base = config.apiUrl.replace(/\/$/, "")
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`
  const body = new URLSearchParams()
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 2)

  for (const [key, value] of Object.entries(fields)) {
    if (value !== "") body.set(key, value)
  }

  let lastMessage: string | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      })

      clearTimeout(timeout)

      const text = await res.text().catch(() => "")
      let json: unknown = null
      if (text) {
        try {
          json = JSON.parse(text) as unknown
        } catch {
          json = { raw: text }
        }
      }

      if (!res.ok) {
        lastMessage = `HTTP ${res.status}`
        const diagnostics = buildSanitizedControllrHttpDiagnostics({
          path,
          status: res.status,
          attempt,
          fields,
          bodyText: text,
          json,
        })
        // Sanitizado: não logar body cru (pode conter PII).
        console.warn(LOG_TAG, {
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
          status: res.status,
          json,
          message: lastMessage,
          diagnostics,
        }
      }

      return { ok: true, status: res.status, json }
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e)
      console.error(LOG_TAG, { path, attempt, message: lastMessage })
      if (attempt < maxAttempts) {
        await sleep(400 * attempt)
        continue
      }
    }
  }

  return { ok: false, status: null, json: null, message: lastMessage }
}
