import { isIdempotentAssignResult } from "@/lib/assignments/engine"

export const RETENTION_ASSIGN_SUCCESS_CODES = ["assigned", "already_assigned"] as const

export type EscalationAssignOutcome = {
  ok: boolean
  mutateCollection: boolean
  releaseCollections: boolean
  persistRetention: boolean
  code: string
}

export function isIdempotentEscalation(code: string | null | undefined): boolean {
  return code === "escalated" || code === "already_escalated"
}

export function isRetentionAssignSuccess(code: string | null | undefined): boolean {
  return isIdempotentAssignResult(code)
}

export function mapRetentionAssignFailure(code: string | null | undefined): string {
  if (code === "no_employee_available") return "no_retention_employee_available"
  const trimmed = code?.trim()
  return trimmed ? trimmed : "retention_assign_failed"
}

/**
 * Decisão pura da escalada 3.1B.
 * Collection só muda depois de assign retention com assigned/already_assigned.
 * Falha ⇒ rollback (não persistir retention operacional nem soltar Cobrança).
 */
export function decideEscalationAfterAssign(input: {
  collectionStatus: string
  assignOk: boolean
  assignCode: string | null | undefined
}): EscalationAssignOutcome {
  const success =
    input.assignOk === true && isRetentionAssignSuccess(input.assignCode)

  if (input.collectionStatus === "paid" || input.collectionStatus === "closed") {
    return {
      ok: false,
      mutateCollection: false,
      releaseCollections: false,
      persistRetention: false,
      code: "invalid_status",
    }
  }

  if (input.collectionStatus === "escalated_retention") {
    if (!success) {
      return {
        ok: false,
        mutateCollection: false,
        releaseCollections: false,
        persistRetention: true,
        code: mapRetentionAssignFailure(input.assignCode),
      }
    }
    return {
      ok: true,
      mutateCollection: false,
      releaseCollections: true,
      persistRetention: true,
      code: "already_escalated",
    }
  }

  if (!success) {
    return {
      ok: false,
      mutateCollection: false,
      releaseCollections: false,
      persistRetention: false,
      code: mapRetentionAssignFailure(input.assignCode),
    }
  }

  return {
    ok: true,
    mutateCollection: true,
    releaseCollections: true,
    persistRetention: true,
    code: "escalated",
  }
}
