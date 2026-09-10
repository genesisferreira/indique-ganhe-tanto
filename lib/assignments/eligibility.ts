/**
 * Predicados do motor genérico de atribuição por setor (Sprint 2.2).
 *
 * NÃO autorizam rotas, RLS nem menus.
 * NÃO substituem profiles.role.
 * NÃO usam commercial_lead_settings.
 */

import type { EmployeeStatus } from "@/types/employee"

export function isSectorEmployeeAssignmentEligible(input: {
  employeeStatus: EmployeeStatus | null | undefined
  membershipActive: boolean
  sectorActive: boolean
  profileIsActive?: boolean | null
}): boolean {
  if (input.employeeStatus !== "active") return false
  if (input.membershipActive !== true) return false
  if (input.sectorActive !== true) return false
  if (input.profileIsActive === false) return false
  return true
}

export function effectiveDailyLimit(input: {
  employeeDailyLimit: number | null | undefined
  sectorDailyLimitDefault: number
}): number {
  return input.employeeDailyLimit ?? input.sectorDailyLimitDefault
}

export function effectiveMaxActiveAssignments(input: {
  employeeMaxActive: number | null | undefined
  sectorMaxActiveDefault: number | null | undefined
}): number | null {
  const value = input.employeeMaxActive ?? input.sectorMaxActiveDefault ?? null
  return value == null ? null : value
}

export function isSectorQueueCandidate(input: {
  employeeStatus: EmployeeStatus | null | undefined
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
}): boolean {
  if (!isSectorEmployeeAssignmentEligible(input)) return false
  if (input.queueEnabled !== true) return false
  if (input.receivingAssignments !== true) return false
  if (input.isAvailable !== true) return false
  const dailyLimit = effectiveDailyLimit({
    employeeDailyLimit: input.employeeDailyLimit,
    sectorDailyLimitDefault: input.sectorDailyLimitDefault,
  })
  if (input.totalReceivedToday >= dailyLimit) return false
  const maxActive = effectiveMaxActiveAssignments({
    employeeMaxActive: input.employeeMaxActive,
    sectorMaxActiveDefault: input.sectorMaxActiveDefault,
  })
  if (maxActive != null && input.activeAssignments >= maxActive) return false
  return true
}
