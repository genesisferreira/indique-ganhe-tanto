import "server-only"

import { createClient } from "@/lib/supabase/server"
import { authorizeAdminRemuneracao } from "@/lib/admin-remuneracao/guard"
import { runCommissionWrite, type WriteKind, type WriteRequest, type WriteRpcClient } from "@/lib/commission-activation/handlers"
import type { WriteOutcome } from "@/lib/commission-activation/contract"

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>
}

export async function loadCommissionEntitlements(): Promise<unknown> {
  const empty = { entitlements: [], activeRuleCount: 0, schedulerEnabled: false }
  try {
    const supabase = await createClient()
    const { data, error } = await (supabase as unknown as RpcClient).rpc("admin_list_commission_entitlements", { p_payload: {} })
    if (error || data == null) return empty
    return data
  } catch {
    return empty
  }
}

export async function runCommissionRoute(kind: WriteKind, request: WriteRequest): Promise<WriteOutcome> {
  const auth = await authorizeAdminRemuneracao()
  let client: WriteRpcClient | null = null
  if (auth.ok) {
    try {
      client = (await createClient()) as unknown as WriteRpcClient
    } catch {
      client = null
    }
  }
  return runCommissionWrite(kind, auth, client, request)
}
