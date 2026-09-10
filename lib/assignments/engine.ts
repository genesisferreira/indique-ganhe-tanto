/**
 * Contratos server-side do motor genérico.
 * Sem cliente browser. RPCs só via service_role após auth no caller.
 * actorProfileId é auditoria — NÃO é autorização.
 */

import type { SectorAssignmentStatus } from "@/types/assignment"

export const SECTOR_ASSIGNMENT_RPC = {
  isEligible: "is_sector_employee_assignment_eligible",
  pick: "pick_next_sector_employee",
  assign: "assign_sector_work_item",
  transfer: "transfer_sector_assignment",
  release: "release_sector_assignment",
  claim: "claim_sector_work_item",
} as const

export type SectorEngineCode =
  | "assigned"
  | "already_assigned"
  | "already_claimed"
  | "already_closed"
  | "claimed"
  | "transferred"
  | "same_employee"
  | "completed"
  | "released"
  | "cancelled"
  | "no_employee_available"
  | "not_eligible"
  | "not_found"
  | "not_active"
  | "invalid_input"
  | "invalid_sector"
  | "queue_disabled"
  | "transfer_disabled"
  | "claim_disabled"
  | "unique_violation"
  | "exception"

export type SectorEngineResult = {
  ok: boolean
  code: SectorEngineCode | string
  assignmentId?: string
  employeeId?: string
  previousAssignmentId?: string
  previousEmployeeId?: string
  status?: string
  message?: string
}

export function isIdempotentAssignResult(code: string | null | undefined): boolean {
  return code === "already_assigned" || code === "assigned"
}

export function resolveConcurrentAssignWinner(input: {
  firstInserted: boolean
  existingActiveAssignmentId: string | null
}): "first" | "existing" {
  if (input.existingActiveAssignmentId) return "existing"
  if (input.firstInserted) return "first"
  return "existing"
}

export function transferClosesPreviousAs(): Extract<SectorAssignmentStatus, "released"> {
  return "released"
}

export function isAllowedCloseStatus(
  status: string | null | undefined
): status is Extract<SectorAssignmentStatus, "completed" | "released" | "cancelled"> {
  return status === "completed" || status === "released" || status === "cancelled"
}

export function buildAssignSectorWorkItemArgs(input: {
  sectorCode: string
  workType: string
  workId: string
  actorProfileId?: string | null
  metadata?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    p_sector_code: input.sectorCode,
    p_work_type: input.workType,
    p_work_id: input.workId,
    p_actor_profile_id: input.actorProfileId ?? null,
    p_metadata: input.metadata ?? {},
  }
}

export function buildTransferSectorAssignmentArgs(input: {
  assignmentId: string
  toEmployeeId: string
  actorProfileId?: string | null
  reason?: string | null
}): Record<string, unknown> {
  return {
    p_assignment_id: input.assignmentId,
    p_to_employee_id: input.toEmployeeId,
    p_actor_profile_id: input.actorProfileId ?? null,
    p_reason: input.reason ?? null,
  }
}

export function buildReleaseSectorAssignmentArgs(input: {
  assignmentId: string
  closeStatus: "completed" | "released" | "cancelled"
  actorProfileId?: string | null
  reason?: string | null
}): Record<string, unknown> {
  return {
    p_assignment_id: input.assignmentId,
    p_close_status: input.closeStatus,
    p_actor_profile_id: input.actorProfileId ?? null,
    p_reason: input.reason ?? null,
  }
}

export function buildClaimSectorWorkItemArgs(input: {
  sectorCode: string
  workType: string
  workId: string
  employeeId: string
  actorProfileId?: string | null
  metadata?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    p_sector_code: input.sectorCode,
    p_work_type: input.workType,
    p_work_id: input.workId,
    p_employee_id: input.employeeId,
    p_actor_profile_id: input.actorProfileId ?? null,
    p_metadata: input.metadata ?? {},
  }
}
