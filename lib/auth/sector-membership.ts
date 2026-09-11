import type { UserRole } from "@/types/user"
import type { EmployeeStatus } from "@/types/employee"
import { COLLECTION_SECTOR_CODE, RETENTION_SECTOR_CODE } from "@/types/collections"

export type OperationalSectorCode =
  | typeof COLLECTION_SECTOR_CODE
  | typeof RETENTION_SECTOR_CODE

export type OperationalSectorAction = "read" | "write" | "sync"

export type SectorMembershipAuthOk = {
  ok: true
  profileId: string
  role: UserRole
  kind: "member" | "admin_read" | "admin_master"
  employeeId: string | null
  membershipActive: boolean
}

export type SectorMembershipAuthFail = {
  ok: false
  status: 401 | 403
  message: string
}

export type SectorMembershipAuthResult = SectorMembershipAuthOk | SectorMembershipAuthFail

const ADMIN_READ_ROLES = new Set<UserRole>([
  "admin_consulta",
  "admin_financeiro",
  "admin_master",
])

export function isAdminReadRole(role: string | null | undefined): boolean {
  return (
    role === "admin_consulta" ||
    role === "admin_financeiro" ||
    role === "admin_master"
  )
}

export function isAdminMasterRole(role: string | null | undefined): boolean {
  return role === "admin_master"
}

/**
 * Employee ativo + membership ativa no setor.
 * NÃO concede /admin. NÃO substitui profiles.role.
 */
export function requireActiveSectorMembership(input: {
  sectorCode: OperationalSectorCode
  employeeId?: string | null
  employeeStatus?: EmployeeStatus | string | null
  membershipActive: boolean
  membershipSectorCode?: string | null
}): { ok: true } | { ok: false; reason: string } {
  if (!input.employeeId?.trim()) {
    return { ok: false, reason: "employee ausente" }
  }
  if (input.employeeStatus !== "active") {
    return { ok: false, reason: "employee não está active" }
  }
  if (input.membershipActive !== true) {
    return { ok: false, reason: "membership inativa" }
  }
  if (
    input.membershipSectorCode &&
    input.membershipSectorCode !== input.sectorCode
  ) {
    return { ok: false, reason: "membership de outro setor" }
  }
  return { ok: true }
}

export function canEnterSectorRoundRobin(input: {
  employeeId?: string | null
  employeeStatus?: EmployeeStatus | string | null
  membershipActive: boolean
  role?: string | null
}): boolean {
  if (input.employeeStatus !== "active") return false
  if (!input.employeeId?.trim()) return false
  return input.membershipActive === true
}

/**
 * Autorização de rota/API operacional.
 * Membership autoriza o módulo, não /admin.
 * Admin Master lê/administra sem entrar no RR.
 */
export function authorizeOperationalSectorAccess(input: {
  sectorCode: OperationalSectorCode
  action: OperationalSectorAction
  userId?: string | null
  profileId?: string | null
  role?: UserRole | string | null
  profileIsActive?: boolean | null
  employeeId?: string | null
  employeeStatus?: EmployeeStatus | string | null
  membershipActive: boolean
  membershipSectorCode?: string | null
}): SectorMembershipAuthResult {
  if (!input.userId?.trim()) {
    return { ok: false, status: 401, message: "Sessão não encontrada. Faça login novamente." }
  }
  if (!input.profileId || input.profileId !== input.userId) {
    return { ok: false, status: 403, message: "Perfil não autorizado." }
  }
  if (input.profileIsActive === false) {
    return { ok: false, status: 403, message: "Perfil inativo." }
  }

  const role = input.role as UserRole | null
  if (!role) {
    return { ok: false, status: 403, message: "Perfil sem role." }
  }
  if (role === "indicador") {
    return { ok: false, status: 403, message: "Acesso restrito à operação interna." }
  }

  const membership = requireActiveSectorMembership({
    sectorCode: input.sectorCode,
    employeeId: input.employeeId,
    employeeStatus: input.employeeStatus,
    membershipActive: input.membershipActive,
    membershipSectorCode: input.membershipSectorCode,
  })

  if (input.action === "sync") {
    if (!isAdminMasterRole(role)) {
      return { ok: false, status: 403, message: "Sincronização restrita ao Admin Master." }
    }
    return {
      ok: true,
      profileId: input.profileId,
      role,
      kind: "admin_master",
      employeeId: input.employeeId ?? null,
      membershipActive: membership.ok,
    }
  }

  if (membership.ok) {
    return {
      ok: true,
      profileId: input.profileId,
      role,
      kind: "member",
      employeeId: input.employeeId ?? null,
      membershipActive: true,
    }
  }

  if (input.action === "read" && isAdminReadRole(role)) {
    return {
      ok: true,
      profileId: input.profileId,
      role,
      kind: isAdminMasterRole(role) ? "admin_master" : "admin_read",
      employeeId: input.employeeId ?? null,
      membershipActive: false,
    }
  }

  if (input.action === "write" && isAdminMasterRole(role)) {
    return {
      ok: true,
      profileId: input.profileId,
      role,
      kind: "admin_master",
      employeeId: input.employeeId ?? null,
      membershipActive: false,
    }
  }

  return {
    ok: false,
    status: 403,
    message: `É necessário employee ativo com membership em ${input.sectorCode}.`,
  }
}

export function membershipGrantsAdminRoute(_membershipSectorCode?: string | null): false {
  return false
}
