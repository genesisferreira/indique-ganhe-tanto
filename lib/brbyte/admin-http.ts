import "server-only"

import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import {
  loginControllr,
  postControllrForm,
  type ControllrHttpAbortClass,
  type ControllrHttpPostResult,
} from "@/lib/brbyte/admin-http-request"

export type BrbyteAdminPostResult = ControllrHttpPostResult
export type { ControllrHttpAbortClass }

export async function brbyteAdminLogin(
  config: BrbyteCreateInterestConfig,
  options?: { signal?: AbortSignal }
): Promise<
  | { cookie: string; httpStatus: number }
  | {
      error: string
      httpStatus: number | null
      abortClass?: ControllrHttpAbortClass
    }
> {
  const base = config.apiUrl.replace(/\/$/, "")
  return loginControllr({
    url: `${base}/login`,
    username: config.apiUser,
    password: config.apiPassword,
    timeoutMs: config.timeoutMs,
    signal: options?.signal,
  })
}

export async function brbyteAdminPostForm(
  config: BrbyteCreateInterestConfig,
  cookie: string,
  path: string,
  fields: Record<string, string>,
  options?: { maxAttempts?: number; timeoutMs?: number; signal?: AbortSignal }
): Promise<BrbyteAdminPostResult> {
  const base = config.apiUrl.replace(/\/$/, "")
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== "") body.set(key, value)
  }

  return postControllrForm({
    url,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body,
    timeoutMs: options?.timeoutMs ?? config.timeoutMs,
    maxAttempts: options?.maxAttempts,
    signal: options?.signal,
    pathForLog: path,
    fieldsForDiagnostics: fields,
  })
}
