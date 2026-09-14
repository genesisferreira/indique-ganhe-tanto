import "server-only"

import { awaitQuery, getOpsDb } from "@/lib/collections/db"
import {
  presentFuncionarioSelfProfile,
  sessionBoundProfileUserId,
  type FuncionarioSelfProfileResult,
} from "@/lib/employees/self-profile"

function asString(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

export async function loadFuncionarioSelfProfile(input: {
  sessionUserId: string | null
  requestedEmployeeId?: string | null
  requestedProfileId?: string | null
  requestedId?: string | null
}): Promise<FuncionarioSelfProfileResult> {
  const userId = sessionBoundProfileUserId(input)
  if (!userId) return { kind: "unauthenticated" }

  const db = getOpsDb()
  const { data: profile } = await db
    .from("profiles")
    .select("id, role, is_active, must_change_password, full_name, email, phone, cpf")
    .eq("id", userId)
    .maybeSingle()

  const profileRow = profile
    ? {
        id: String((profile as Record<string, unknown>).id),
        role: asString((profile as Record<string, unknown>).role),
        is_active: (profile as Record<string, unknown>).is_active as boolean | null,
        must_change_password: (profile as Record<string, unknown>)
          .must_change_password as boolean | null,
        full_name: asString((profile as Record<string, unknown>).full_name),
        email: asString((profile as Record<string, unknown>).email),
        phone: asString((profile as Record<string, unknown>).phone),
        cpf: asString((profile as Record<string, unknown>).cpf),
      }
    : null

  const { data: employee } = await db
    .from("employees")
    .select("id, profile_id, status, job_title, birth_date, manager_employee_id")
    .eq("profile_id", userId)
    .maybeSingle()

  const employeeRow = employee
    ? {
        id: String((employee as Record<string, unknown>).id),
        profile_id: String((employee as Record<string, unknown>).profile_id),
        status: asString((employee as Record<string, unknown>).status),
        job_title: asString((employee as Record<string, unknown>).job_title),
        birth_date: asString((employee as Record<string, unknown>).birth_date),
        manager_employee_id: asString(
          (employee as Record<string, unknown>).manager_employee_id
        ),
      }
    : null

  let managerName: string | null = null
  if (employeeRow?.manager_employee_id) {
    const { data: managerEmp } = await db
      .from("employees")
      .select("id, profile_id")
      .eq("id", employeeRow.manager_employee_id)
      .maybeSingle()
    const managerProfileId = asString(
      (managerEmp as Record<string, unknown> | null)?.profile_id
    )
    if (managerProfileId) {
      const { data: managerProfile } = await db
        .from("profiles")
        .select("full_name")
        .eq("id", managerProfileId)
        .maybeSingle()
      managerName = asString(
        (managerProfile as Record<string, unknown> | null)?.full_name
      )
    }
  }

  const memberships: Array<{
    sectorCode: string
    sectorName: string | null
    isActive: boolean
  }> = []
  if (employeeRow) {
    const membershipsRes = await awaitQuery<{
      sector_id: string
      is_active: boolean
    }>(
      db
        .from("employee_sector_memberships")
        .select("sector_id, is_active")
        .eq("employee_id", employeeRow.id)
    )
    const sectorIds = (membershipsRes.data ?? [])
      .map((row) => row.sector_id)
      .filter(Boolean)
    const sectorsRes =
      sectorIds.length > 0
        ? await awaitQuery<{ id: string; code: string; name: string }>(
            db.from("sectors").select("id, code, name").in("id", sectorIds)
          )
        : { data: [] as Array<{ id: string; code: string; name: string }> }
    const sectorMap = new Map(
      (sectorsRes.data ?? []).map((row) => [row.id, row] as const)
    )
    for (const row of membershipsRes.data ?? []) {
      const sector = sectorMap.get(row.sector_id)
      memberships.push({
        sectorCode: sector?.code ?? row.sector_id,
        sectorName: sector?.name ?? null,
        isActive: row.is_active === true,
      })
    }
  }

  return presentFuncionarioSelfProfile({
    profile: profileRow,
    employee: employeeRow,
    managerName,
    memberships,
  })
}
