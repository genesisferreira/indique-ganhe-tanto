/**
 * Predicados de fundação (Sprint 2.1).
 *
 * NÃO autorizam rotas, RLS nem menus.
 * NÃO substituem profiles.role.
 * NÃO alteram o round-robin Comercial atual.
 *
 * Elegibilidade aqui é a regra GLOBAL futura:
 * employee.status = active AND membership ativo no setor.
 * O Comercial continua usando commercial_lead_settings + profiles.role.
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
 * Elegibilidade GLOBAL futura para NOVAS distribuições.
 * Paused/vacation/away/dismissed: false.
 * Membership inativo: false.
 * Não inspeciona commercial_lead_settings (setor Comercial legado).
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
