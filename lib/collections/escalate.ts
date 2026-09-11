import "server-only"

import { parseSectorEngineResult } from "@/lib/assignments/sector-rpc.service"
import { getOpsDb } from "@/lib/collections/db"
import { isIdempotentEscalation } from "@/lib/collections/escalate-policy"

export { isIdempotentEscalation }

export type EscalateCollectionResult = {
  ok: boolean
  code: string
  collectionCaseId?: string
  retentionCaseId?: string
  assignmentId?: string
  employeeId?: string
  message?: string
}

export async function escalateCollectionToRetention(input: {
  collectionCaseId: string
  actorProfileId: string
  reason?: string | null
}): Promise<EscalateCollectionResult> {
  const db = getOpsDb()
  const { data, error } = await db.rpc("escalate_collection_to_retention", {
    p_collection_case_id: input.collectionCaseId,
    p_actor_profile_id: input.actorProfileId,
    p_reason: input.reason ?? null,
  })
  if (error) {
    return { ok: false, code: "exception", message: error.message }
  }
  const parsed = parseSectorEngineResult(data)
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null
  return {
    ok: parsed.ok === true,
    code: parsed.code,
    collectionCaseId:
      typeof obj?.collection_case_id === "string"
        ? obj.collection_case_id
        : input.collectionCaseId,
    retentionCaseId:
      typeof obj?.retention_case_id === "string" ? obj.retention_case_id : undefined,
    assignmentId: parsed.assignmentId,
    employeeId: parsed.employeeId,
    message: parsed.message,
  }
}
