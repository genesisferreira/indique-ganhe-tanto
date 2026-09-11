import "server-only"

import {
  SECTOR_ASSIGNMENT_RPC,
  buildAssignSectorWorkItemArgs,
  buildClaimSectorWorkItemArgs,
  buildReleaseSectorAssignmentArgs,
  buildTransferSectorAssignmentArgs,
  type SectorEngineResult,
} from "@/lib/assignments/engine"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown
    error: { message: string; code?: string } | null
  }>
}

export function parseSectorEngineResult(data: unknown): SectorEngineResult {
  const obj =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null
  if (!obj) {
    return { ok: false, code: "exception", message: "empty rpc response" }
  }
  const assignmentId =
    typeof obj.assignment_id === "string" ? obj.assignment_id : undefined
  const employeeId =
    typeof obj.employee_id === "string" ? obj.employee_id : undefined
  const previousAssignmentId =
    typeof obj.previous_assignment_id === "string"
      ? obj.previous_assignment_id
      : undefined
  const previousEmployeeId =
    typeof obj.previous_employee_id === "string"
      ? obj.previous_employee_id
      : undefined
  const status = typeof obj.status === "string" ? obj.status : undefined
  const message = typeof obj.message === "string" ? obj.message : undefined
  return {
    ok: obj.ok === true,
    code: String(obj.code ?? "exception"),
    assignmentId,
    employeeId,
    previousAssignmentId,
    previousEmployeeId,
    status,
    message,
  }
}

function getRpc(client?: RpcClient): RpcClient {
  return client ?? (createServiceRoleClient() as unknown as RpcClient)
}

export async function assignSectorWorkItem(input: {
  sectorCode: string
  workType: string
  workId: string
  actorProfileId: string
  metadata?: Record<string, unknown>
  client?: RpcClient
}): Promise<SectorEngineResult> {
  const { data, error } = await getRpc(input.client).rpc(
    SECTOR_ASSIGNMENT_RPC.assign,
    buildAssignSectorWorkItemArgs({
      sectorCode: input.sectorCode,
      workType: input.workType,
      workId: input.workId,
      actorProfileId: input.actorProfileId,
      metadata: input.metadata,
    })
  )
  if (error) {
    return { ok: false, code: "exception", message: error.message }
  }
  return parseSectorEngineResult(data)
}

export async function transferSectorAssignment(input: {
  assignmentId: string
  toEmployeeId: string
  actorProfileId: string
  reason?: string | null
  client?: RpcClient
}): Promise<SectorEngineResult> {
  const { data, error } = await getRpc(input.client).rpc(
    SECTOR_ASSIGNMENT_RPC.transfer,
    buildTransferSectorAssignmentArgs({
      assignmentId: input.assignmentId,
      toEmployeeId: input.toEmployeeId,
      actorProfileId: input.actorProfileId,
      reason: input.reason,
    })
  )
  if (error) {
    return { ok: false, code: "exception", message: error.message }
  }
  return parseSectorEngineResult(data)
}

export async function releaseSectorAssignment(input: {
  assignmentId: string
  closeStatus: "completed" | "released" | "cancelled"
  actorProfileId: string
  reason?: string | null
  client?: RpcClient
}): Promise<SectorEngineResult> {
  const { data, error } = await getRpc(input.client).rpc(
    SECTOR_ASSIGNMENT_RPC.release,
    buildReleaseSectorAssignmentArgs({
      assignmentId: input.assignmentId,
      closeStatus: input.closeStatus,
      actorProfileId: input.actorProfileId,
      reason: input.reason,
    })
  )
  if (error) {
    return { ok: false, code: "exception", message: error.message }
  }
  return parseSectorEngineResult(data)
}

export async function claimSectorWorkItem(input: {
  sectorCode: string
  workType: string
  workId: string
  employeeId: string
  actorProfileId: string
  metadata?: Record<string, unknown>
  client?: RpcClient
}): Promise<SectorEngineResult> {
  const { data, error } = await getRpc(input.client).rpc(
    SECTOR_ASSIGNMENT_RPC.claim,
    buildClaimSectorWorkItemArgs({
      sectorCode: input.sectorCode,
      workType: input.workType,
      workId: input.workId,
      employeeId: input.employeeId,
      actorProfileId: input.actorProfileId,
      metadata: input.metadata,
    })
  )
  if (error) {
    return { ok: false, code: "exception", message: error.message }
  }
  return parseSectorEngineResult(data)
}
