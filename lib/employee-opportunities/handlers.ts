import { gateEmployeeSession, type EmployeeSessionResult } from "@/lib/employee-portal/api-gate"
import {
  errorOutcome,
  mapSubmitResult,
  parseOpportunityPayload,
  toFormContext,
  toRpcPayload,
  type FormContext,
  type SubmitOutcome,
} from "@/lib/employee-opportunities/contract"

/**
 * 3.1F-J3 — orquestração PURA (testável) do cadastro de oportunidade do funcionário.
 * Ordem: cliente da sessão → gate (usuário/profile/employee próprios) → origem/content-type →
 * corpo (≤ 8 KB) → validação estrita → exatamente UMA RPC (submit_employee_sales_opportunity).
 * Nunca service role; nunca insert direto; nenhum dado pessoal em log (somente a classe).
 */
export const SUBMIT_RPC = "submit_employee_sales_opportunity" as const
export const FORM_CONTEXT_RPC = "employee_opportunity_form_context" as const
export const MAX_BODY_BYTES = 8192

export type SubmitRequest = {
  readonly url: string
  readonly headers: { get(name: string): string | null }
  text(): Promise<string>
}

/**
 * CSRF: se o navegador enviar Origin, o host dele precisa ser o host público da requisição
 * (Host / X-Forwarded-Host, como visto pelo proxy); sem Origin, vale o content-type JSON (preflight).
 */
function sameOrigin(req: SubmitRequest): boolean {
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

function logClass(cls: string) {
  console.warn(`[employee-opportunity] ${cls}`)
}

export async function runSubmitOpportunity(session: EmployeeSessionResult, req: SubmitRequest): Promise<SubmitOutcome> {
  if (!session.ok) {
    logClass("unavailable")
    return errorOutcome("unavailable")
  }
  const client = session.client
  let gate: Awaited<ReturnType<typeof gateEmployeeSession>>
  try {
    gate = await gateEmployeeSession(client)
  } catch {
    logClass("unavailable")
    return errorOutcome("unavailable")
  }
  if (!gate.ok) {
    if (gate.kind === "unauthenticated") return errorOutcome("unauthenticated")
    if (gate.kind === "unavailable") return errorOutcome("unavailable")
    return errorOutcome("forbidden")
  }
  if (!sameOrigin(req)) return errorOutcome("forbidden")
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return errorOutcome("invalid_payload")
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return errorOutcome("invalid_payload")
  }
  if (raw.length > MAX_BODY_BYTES) return errorOutcome("invalid_payload")
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return errorOutcome("invalid_payload")
  }
  const parsed = parseOpportunityPayload(body)
  if (!parsed.ok) return errorOutcome(parsed.code, parsed.field)
  const { data, error } = await client.rpc(SUBMIT_RPC, { p_payload: toRpcPayload(parsed.value) })
  if (error) {
    logClass(`rpc_error ${error.code ?? "unknown"}`)
    return errorOutcome(error.code === "42501" ? "forbidden" : "unavailable")
  }
  const out = mapSubmitResult(data)
  if (out.status >= 500) logClass("unexpected_result")
  return out
}

export type FormContextResult = { ok: true; data: FormContext } | { ok: false; kind: "unauthenticated" | "forbidden" | "unavailable" }

export async function runLoadFormContext(session: EmployeeSessionResult): Promise<FormContextResult> {
  if (!session.ok) return { ok: false, kind: "unavailable" }
  try {
    const gate = await gateEmployeeSession(session.client)
    if (!gate.ok) return { ok: false, kind: gate.kind === "unauthenticated" || gate.kind === "unavailable" ? gate.kind : "forbidden" }
    const { data, error } = await session.client.rpc(FORM_CONTEXT_RPC, {})
    if (error) return { ok: false, kind: error.code === "42501" ? "forbidden" : "unavailable" }
    const ctx = toFormContext(data)
    return ctx ? { ok: true, data: ctx } : { ok: false, kind: "unavailable" }
  } catch {
    logClass("unavailable")
    return { ok: false, kind: "unavailable" }
  }
}
