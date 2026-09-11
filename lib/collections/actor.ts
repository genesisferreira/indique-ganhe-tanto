import "server-only"

import { createClient } from "@/lib/supabase/server"
import { awaitQuery, getOpsDb } from "@/lib/collections/db"
import {
  authorizeOperationalSectorAccess,
  requireOperationalCaseWriteAccess,
  type OperationalSectorAction,
  type OperationalSectorCode,
  type SectorMembershipAuthResult,
} from "@/lib/auth/sector-membership"
import { findActiveAssignment } from "@/lib/collections/cases.service"
import type { UserRole } from "@/types/user"

export type OperationalActorContext = {
  userId: string
  profileId: string
  role: UserRole
  profileIsActive: boolean | null
  employeeId: string | null
  employeeStatus: string | null
  membershipActive: boolean
  membershipSectorCode: string | null
  membershipCodes: string[]
}

async function loadMembershipCodes(employeeId: string): Promise<string[]> {
  const db = getOpsDb()
  const membershipsRes = await awaitQuery<{ sector_id: string; is_active: boolean }>(
    db
      .from("employee_sector_memberships")
      .select("sector_id, is_active")
      .eq("employee_id", employeeId)
      .eq("is_active", true)
  )
  const sectorIds = (membershipsRes.data ?? [])
    .map((row) => row.sector_id)
    .filter(Boolean)
  if (sectorIds.length === 0) return []

  const sectorsRes = await awaitQuery<{ id: string; code: string }>(
    db.from("sectors").select("id, code").in("id", sectorIds)
  )
  return (sectorsRes.data ?? []).map((row) => row.code).filter(Boolean)
}

export async function loadOperationalActorContext(
  userId: string
): Promise<OperationalActorContext | null> {
  const db = getOpsDb()
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userId)
    .maybeSingle()

  if (profileError || !profile) return null

  const { data: employee } = await db
    .from("employees")
    .select("id, status")
    .eq("profile_id", userId)
    .maybeSingle()

  const employeeId = employee?.id ? String(employee.id) : null
  const membershipCodes = employeeId ? await loadMembershipCodes(employeeId) : []

  return {
    userId,
    profileId: String(profile.id),
    role: profile.role as UserRole,
    profileIsActive: (profile.is_active as boolean | null) ?? null,
    employeeId,
    employeeStatus: employee?.status ? String(employee.status) : null,
    membershipActive: membershipCodes.length > 0,
    membershipSectorCode: membershipCodes[0] ?? null,
    membershipCodes,
  }
}

export async function authorizeOperationalRequest(input: {
  sectorCode: OperationalSectorCode
  action: OperationalSectorAction
}): Promise<SectorMembershipAuthResult & { context?: OperationalActorContext }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return {
      ok: false,
      status: 401,
      message: "Sessão não encontrada. Faça login novamente.",
    }
  }

  const context = await loadOperationalActorContext(user.id)
  if (!context) {
    return { ok: false, status: 403, message: "Perfil não autorizado." }
  }

  const membershipForSector = context.membershipCodes.includes(input.sectorCode)

  const auth = authorizeOperationalSectorAccess({
    sectorCode: input.sectorCode,
    action: input.action,
    userId: context.userId,
    profileId: context.profileId,
    role: context.role,
    profileIsActive: context.profileIsActive,
    employeeId: context.employeeId,
    employeeStatus: context.employeeStatus,
    membershipActive: membershipForSector,
    membershipSectorCode: membershipForSector ? input.sectorCode : null,
  })

  if (!auth.ok) return auth
  return {
    ...auth,
    context: {
      ...context,
      membershipActive: membershipForSector,
      membershipSectorCode: membershipForSector ? input.sectorCode : context.membershipSectorCode,
    },
  }
}

export async function authorizeOperationalCaseWrite(input: {
  sectorCode: OperationalSectorCode
  workType: string
  workId: string
}): Promise<SectorMembershipAuthResult & { context?: OperationalActorContext }> {
  const auth = await authorizeOperationalRequest({
    sectorCode: input.sectorCode,
    action: "write",
  })
  if (!auth.ok) return auth

  const active = await findActiveAssignment({
    workType: input.workType,
    workId: input.workId,
  })

  const ownership = requireOperationalCaseWriteAccess({
    sectorCode: input.sectorCode,
    workType: input.workType,
    workId: input.workId,
    role: auth.role,
    employeeId: auth.context?.employeeId ?? auth.employeeId,
    employeeStatus: auth.context?.employeeStatus ?? null,
    membershipActive: auth.context?.membershipActive ?? auth.membershipActive,
    membershipSectorCode: input.sectorCode,
    activeAssignmentEmployeeId: active?.employeeId ?? null,
  })

  if (!ownership.ok) {
    return { ok: false, status: ownership.status, message: ownership.message }
  }

  return auth
}
