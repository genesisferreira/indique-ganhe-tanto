/**
 * Round-robin genérico (espelho de pick_next_sector_employee).
 * Ordenação: lastAssignmentAt ASC NULLS FIRST, totalReceivedToday ASC, employeeId ASC.
 */

import { isSectorQueueCandidate } from "@/lib/assignments/eligibility"
import type { EmployeeStatus } from "@/types/employee"

export type SectorQueueCandidate = {
  employeeId: string
  membershipId?: string
  employeeStatus: EmployeeStatus
  membershipActive: boolean
  sectorActive: boolean
  profileIsActive?: boolean | null
  queueEnabled: boolean
  receivingAssignments: boolean
  isAvailable: boolean
  totalReceivedToday: number
  employeeDailyLimit?: number | null
  sectorDailyLimitDefault: number
  activeAssignments: number
  employeeMaxActive?: number | null
  sectorMaxActiveDefault?: number | null
  lastAssignmentAt: string | null
}

export function compareRoundRobinCandidates(
  a: Pick<SectorQueueCandidate, "lastAssignmentAt" | "totalReceivedToday" | "employeeId">,
  b: Pick<SectorQueueCandidate, "lastAssignmentAt" | "totalReceivedToday" | "employeeId">
): number {
  if (a.lastAssignmentAt == null && b.lastAssignmentAt != null) return -1
  if (a.lastAssignmentAt != null && b.lastAssignmentAt == null) return 1
  if (a.lastAssignmentAt != null && b.lastAssignmentAt != null) {
    if (a.lastAssignmentAt < b.lastAssignmentAt) return -1
    if (a.lastAssignmentAt > b.lastAssignmentAt) return 1
  }
  if (a.totalReceivedToday !== b.totalReceivedToday) {
    return a.totalReceivedToday - b.totalReceivedToday
  }
  if (a.employeeId < b.employeeId) return -1
  if (a.employeeId > b.employeeId) return 1
  return 0
}

export function pickNextSectorEmployee(
  candidates: readonly SectorQueueCandidate[],
  excludeEmployeeId?: string | null
): SectorQueueCandidate | null {
  const eligible = candidates.filter((c) => {
    if (excludeEmployeeId && c.employeeId === excludeEmployeeId) return false
    return isSectorQueueCandidate(c)
  })
  if (eligible.length === 0) return null
  return [...eligible].sort(compareRoundRobinCandidates)[0] ?? null
}
