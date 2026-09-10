/**
 * Predicados de fundação (Sprint 2.1 / 2.1B).
 *
 * NÃO autorizam rotas, RLS nem menus.
 * NÃO substituem profiles.role.
 *
 * Elegibilidade de NOVA atribuição Comercial:
 * role=comercial AND profile ativo AND employee.status=active
 * AND membership commercial ativa AND (assign/pick) settings de fila.
 */

import type { EmployeeStatus } from "@/types/employee"

export const FUTURE_ASSIGNMENT_ELIGIBLE_STATUS: EmployeeStatus = "active"

export function isEmployeeStatus(value: string | null | undefined): value is EmployeeStatus {
  return (
    value === "active" ||
    value === "paused" ||
    value === "vacation" ||
    value === "away" ||
    value === "dismissed"
  )
}

/** Há registro de funcionário para este profile. Não concede acesso. */
export function isEmployee(input: {
  employeeId?: string | null
  profileId?: string | null
}): boolean {
  return Boolean(input.employeeId?.trim() && input.profileId?.trim())
}

export function hasSector(input: {
  memberships: ReadonlyArray<{ sectorCode: string; isActive: boolean }>
  sectorCode: string
}): boolean {
  const code = input.sectorCode.trim()
  if (!code) return false
  return input.memberships.some((m) => m.isActive && m.sectorCode === code)
}

export function hasAnySector(input: {
  memberships: ReadonlyArray<{ sectorCode: string; isActive: boolean }>
  sectorCodes: readonly string[]
}): boolean {
  return input.sectorCodes.some((code) =>
    hasSector({ memberships: input.memberships, sectorCode: code })
  )
}

/**
 * Elegibilidade GLOBAL para NOVAS atribuições.
 * Paused/vacation/away/dismissed: false.
 * Membership inativo: false.
 * No Comercial, assign/pick também exigem commercial_lead_settings.
 * daily_limit aplica-se a assign/pick; claim histórico NÃO usa daily_limit.
 */
export function isEligibleForFutureAssignment(input: {
  employeeStatus: EmployeeStatus | null | undefined
  membershipActive: boolean
}): boolean {
  if (input.employeeStatus !== FUTURE_ASSIGNMENT_ELIGIBLE_STATUS) return false
  return input.membershipActive === true
}

export function commercialBackfillStatusFromProfile(isActive: boolean | null | undefined): EmployeeStatus {
  return isActive === false ? "paused" : "active"
}

/** Espelho de public.is_commercial_employee_assignment_eligible(uuid). */
export type CommercialEmployeeEligibilityInput = {
  profileRole: string | null | undefined
  profileIsActive: boolean | null | undefined
  employeeStatus: EmployeeStatus | null | undefined
  hasActiveCommercialMembership: boolean
}

export function isCommercialEmployeeAssignmentEligible(
  input: CommercialEmployeeEligibilityInput
): boolean {
  if (input.profileRole !== "comercial") return false
  if (input.profileIsActive === false) return false
  if (input.employeeStatus !== "active") return false
  if (!input.hasActiveCommercialMembership) return false
  return true
}

export type CommercialPoolCandidateInput = CommercialEmployeeEligibilityInput & {
  settingsAvailable: boolean | null | undefined
  settingsReceivingLeads: boolean | null | undefined
  totalReceivedToday?: number | null
  dailyLimit?: number | null
  /** assign/pick: true. claim: false (daily_limit nunca se aplicou ao claim). */
  applyDailyLimit: boolean
}

export function isCommercialPoolCandidate(
  input: CommercialPoolCandidateInput
): boolean {
  if (!isCommercialEmployeeAssignmentEligible(input)) return false
  if (input.settingsAvailable !== true) return false
  if (input.settingsReceivingLeads !== true) return false
  if (input.applyDailyLimit) {
    const used = input.totalReceivedToday ?? 0
    const limit = input.dailyLimit ?? 0
    if (used >= limit) return false
  }
  return true
}
