import "server-only"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export type CommercialSlaCronResult = {
  ok: boolean
  checked_count?: number
  overdue_count?: number
  warning_count?: number
  critical_count?: number
  redistribution_ready_count?: number
  redistributed_count?: number
  skipped_count?: number
  error_count?: number
  notifications_created?: number
  history_created?: number
  referrals?: unknown
  code?: string
  message?: string
  source_rpc?: string
  [key: string]: unknown
}

export type CommercialSlaCronBundle = {
  escalation: CommercialSlaCronResult
  redistribution: CommercialSlaCronResult | null
  usedFallback: boolean
  rpcError: string | null
}

export function logCronCommercialSlaStart(): void {
  console.log("[cron:commercial-sla:start]")
}

export function logCronCommercialSlaSuccess(payload: unknown): void {
  console.log("[cron:commercial-sla:success]", payload)
}

export function logCronCommercialSlaError(payload: unknown): void {
  console.error("[cron:commercial-sla:error]", payload)
}

async function callSlaRpc(
  fn: string
): Promise<{
  result: CommercialSlaCronResult
  rpcError: string | null
}> {
  const supabase = createServiceRoleClient()
  const dbRpc = supabase as unknown as {
    rpc: (name: string) => Promise<{
      data: CommercialSlaCronResult | null
      error: { message: string; code?: string } | null
    }>
  }

  const { data, error } = await dbRpc.rpc(fn)

  if (error) {
    return {
      result: { ok: false, message: error.message, source_rpc: fn },
      rpcError: error.message,
    }
  }

  const result = (data ?? {
    ok: false,
    message: "empty rpc response",
    source_rpc: fn,
  }) as CommercialSlaCronResult

  return { result: { ...result, source_rpc: fn }, rpcError: null }
}

function isRpcMissing(message: string, fn: string): boolean {
  const m = message.toLowerCase()
  const fnLower = fn.toLowerCase()
  return (
    m.includes(fnLower) &&
    (m.includes("does not exist") ||
      m.includes("could not find") ||
      m.includes("42883"))
  )
}

/**
 * Cron SLA: escalonamento + redistribuição automática.
 */
export async function runCommercialSlaCron(): Promise<CommercialSlaCronBundle> {
  let escalation = await callSlaRpc("detect_commercial_sla_escalations")
  let usedFallback = false

  if (escalation.rpcError || escalation.result.ok === false) {
    if (
      escalation.rpcError &&
      isRpcMissing(escalation.rpcError, "detect_commercial_sla_escalations")
    ) {
      const legacy = await callSlaRpc("detect_overdue_commercial_leads")
      escalation = {
        result: {
          ...legacy.result,
          source_rpc:
            legacy.result.source_rpc ?? "detect_overdue_commercial_leads",
          fallback_from: "detect_commercial_sla_escalations",
          escalation_error:
            escalation.rpcError ?? escalation.result.message,
        },
        rpcError: legacy.rpcError,
      }
      usedFallback = true
    }
  }

  const redistribution = await callSlaRpc("redistribute_overdue_commercial_leads")
  const redistributionMissing =
    redistribution.rpcError &&
    isRpcMissing(redistribution.rpcError, "redistribute_overdue_commercial_leads")

  const redistributionResult =
    redistributionMissing || redistribution.rpcError
      ? null
      : redistribution.result

  const rpcError =
    escalation.rpcError ??
    (redistribution.rpcError && !redistributionMissing
      ? redistribution.rpcError
      : null)

  return {
    escalation: escalation.result,
    redistribution: redistributionResult,
    usedFallback,
    rpcError,
  }
}

/** @deprecated Use runCommercialSlaCron */
export async function runDetectOverdueCommercialLeads(): Promise<{
  result: CommercialSlaCronResult
  rpcError: string | null
}> {
  const out = await runCommercialSlaCron()
  return {
    result: {
      ...out.escalation,
      redistribution: out.redistribution ?? undefined,
    },
    rpcError: out.rpcError,
  }
}
