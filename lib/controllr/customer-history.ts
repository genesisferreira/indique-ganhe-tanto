import "server-only"

import type { OperationalHistoryItem } from "@/lib/operational/history"
import { CONTROLLR_HISTORY_WRITE_ENABLED } from "@/lib/operational/history"

/**
 * Adapter READ-ONLY. Auditoria 3.1C: nenhum endpoint de histórico ERP
 * (client/info, history, occurrence, attendance) existe no repositório.
 * Não inventar path. Não gravar no Controllr.
 */
export async function getControllrCustomerHistory(_input: {
  clientPk?: string | null
  contractPk?: string | null
  documentDigits?: string | null
}): Promise<{
  available: false
  items: OperationalHistoryItem[]
  reason: "not_found"
}> {
  return { available: false, items: [], reason: "not_found" }
}

/** Interface reservada. NÃO chamar na Sprint 3.1C. */
export function writeControllrCustomerHistory(_input: unknown): {
  ok: false
  enabled: false
  code: "controllr_history_write_disabled"
} {
  void _input
  return {
    ok: false,
    enabled: CONTROLLR_HISTORY_WRITE_ENABLED,
    code: "controllr_history_write_disabled",
  }
}
