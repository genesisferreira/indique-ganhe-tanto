import {
  mapWriteResult,
  parseApprovePayload,
  parseCompetenceAction,
  parseManualPayload,
  parseOpenPayload,
  parseWorkedDaysPayload,
  writeError,
  type WriteOutcome,
} from "@/lib/payroll-competence/contract"

export const WRITE_RPC = {
  approve: "admin_approve_employee_compensation",
  days_save: "admin_save_employee_worked_days",
  open: "admin_open_payroll_competence",
  calculate: "admin_calculate_payroll_competence",
  review: "admin_review_payroll_competence",
  adjust: "admin_add_payroll_manual_line",
  close: "admin_close_payroll_competence",
  reopen: "admin_reopen_payroll_competence",
} as const
export type WriteKind = keyof typeof WRITE_RPC
export const MAX_BODY_BYTES = 8192

export type AdminAuth = { ok: true } | { ok: false; status: 401 | 403 }
export type WriteRpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>
}
export type WriteRequest = {
  readonly url: string
  readonly headers: { get(name: string): string | null }
  text(): Promise<string>
}

export function sameOrigin(req: WriteRequest): boolean {
  const origin = req.headers.get("origin")
  if (!origin) return true
  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return false
  }
  const allowed = new Set<string>()
  for (const h of [req.headers.get("x-forwarded-host"), req.headers.get("host")]) {
    const first = h?.split(",")[0]?.trim().toLowerCase()
    if (first) allowed.add(first)
  }
  if (allowed.size === 0) {
    try {
      allowed.add(new URL(req.url).host.toLowerCase())
    } catch {
      return false
    }
  }
  return allowed.has(originHost)
}

function logClass(kind: WriteKind, cls: string) {
  console.warn(`[payroll-competence] ${kind} ${cls}`)
}

function toRpcPayload(kind: WriteKind, body: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; out: WriteOutcome } {
  if (kind === "approve") {
    const p = parseApprovePayload(body)
    return p.ok ? { ok: true, payload: { ...p.value } } : { ok: false, out: writeError(p.code, p.field) }
  }
  if (kind === "days_save") {
    const p = parseWorkedDaysPayload(body)
    return p.ok ? { ok: true, payload: { ...p.value } } : { ok: false, out: writeError(p.code, p.field) }
  }
  if (kind === "open") {
    const p = parseOpenPayload(body)
    return p.ok ? { ok: true, payload: { ...p.value } } : { ok: false, out: writeError(p.code, p.field) }
  }
  if (kind === "adjust") {
    const p = parseManualPayload(body)
    return p.ok ? { ok: true, payload: { ...p.value } } : { ok: false, out: writeError(p.code, p.field) }
  }
  const withReason = kind === "close" || kind === "reopen"
  const p = parseCompetenceAction(body, withReason)
  return p.ok ? { ok: true, payload: { ...p.value } } : { ok: false, out: writeError(p.code, p.field) }
}

export async function runPayrollWrite(
  kind: WriteKind,
  auth: AdminAuth,
  client: WriteRpcClient | null,
  req: WriteRequest
): Promise<WriteOutcome> {
  if (!auth.ok) return writeError(auth.status === 401 ? "unauthenticated" : "forbidden")
  if (!client) {
    logClass(kind, "unavailable")
    return writeError("unavailable")
  }
  if (!sameOrigin(req)) return writeError("forbidden")
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return writeError("invalid_payload")
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return writeError("invalid_payload")
  }
  if (raw.length > MAX_BODY_BYTES) return writeError("invalid_payload")
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return writeError("invalid_payload")
  }
  const parsed = toRpcPayload(kind, body)
  if (!parsed.ok) return parsed.out
  let res: { data: unknown; error: { code?: string } | null }
  try {
    res = await client.rpc(WRITE_RPC[kind], { p_payload: parsed.payload })
  } catch {
    logClass(kind, "unavailable")
    return writeError("unavailable")
  }
  if (res.error) {
    logClass(kind, `rpc_error ${res.error.code ?? "unknown"}`)
    return writeError(res.error.code === "42501" ? "forbidden" : "unavailable")
  }
  const out = mapWriteResult(res.data)
  if (out.status >= 500) logClass(kind, "unexpected_result")
  return out
}
