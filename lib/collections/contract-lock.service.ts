import "server-only"

import { getOpsDb } from "@/lib/collections/db"
import {
  CONTRACT_CONTACT_LOCK_TTL_SECONDS,
  interpretContractLockResult,
} from "@/lib/collections/contract-lock"

function missingRpc(error: { message?: string } | null | undefined): boolean {
  return /does not exist|could not find the function|schema cache/i.test(String(error?.message ?? ""))
}

export async function acquireContractContactLock(input: { caseId: string; profileId: string }) {
  const db = getOpsDb()
  const { data, error } = await db.rpc("acquire_collection_contract_lock", {
    p_case_id: input.caseId,
    p_profile_id: input.profileId,
    p_ttl_seconds: CONTRACT_CONTACT_LOCK_TTL_SECONDS,
  })
  if (error && !missingRpc(error)) {
    return { allowed: false, code: "invalid_input" as const, message: "Não foi possível reservar o contrato para contato." }
  }
  return interpretContractLockResult(data, missingRpc(error))
}

export async function transferContractContactLock(input: {
  caseId: string
  fromProfileId: string
  toEmployeeId: string
}): Promise<{ ok: boolean; code: string }> {
  const db = getOpsDb()
  const { data: emp } = await db
    .from("employees")
    .select("profile_id")
    .eq("id", input.toEmployeeId)
    .maybeSingle()
  const toProfileId = emp?.profile_id ? String(emp.profile_id) : null
  if (!toProfileId) return { ok: false, code: "invalid_input" }
  const { data, error } = await db.rpc("transfer_collection_contract_lock", {
    p_case_id: input.caseId,
    p_from_profile_id: input.fromProfileId,
    p_to_profile_id: toProfileId,
    p_force: true,
    p_ttl_seconds: CONTRACT_CONTACT_LOCK_TTL_SECONDS,
  })
  if (missingRpc(error)) return { ok: true, code: "lock_unavailable" }
  const r = data && typeof data === "object" ? (data as Record<string, unknown>) : {}
  return { ok: r.ok === true, code: String(r.code ?? "persist_error") }
}
