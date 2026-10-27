/**
 * Sprint 3.1E-AU — trava de contato POR CONTRATO (puro, sem I/O).
 * Nunca por cliente; nunca por PII. A garantia real é transacional no banco
 * (acquire/release/transfer_collection_contract_lock sob advisory lock).
 */
export const CONTRACT_CONTACT_LOCK_TTL_SECONDS = 900

export type ContractLockCode =
  | "acquired"
  | "renewed"
  | "recovered_expired"
  | "no_contract_scope"
  | "locked_by_other"
  | "lock_unavailable"
  | "not_found"
  | "invalid_input"

export function interpretContractLockResult(
  payload: unknown,
  rpcMissing: boolean
): { allowed: boolean; code: ContractLockCode; message: string | null } {
  if (rpcMissing) {
    // migration 3.1E-AU ainda não aplicada: comportamento legado (documentado).
    return { allowed: true, code: "lock_unavailable", message: null }
  }
  const r = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const code = String(r.code ?? "invalid_input") as ContractLockCode
  if (r.ok === true) return { allowed: true, code, message: null }
  if (code === "locked_by_other") {
    return {
      allowed: false,
      code,
      message: "Outro atendente está em contato com este contrato. Aguarde ou solicite transferência.",
    }
  }
  return { allowed: false, code, message: "Não foi possível reservar o contrato para contato." }
}
