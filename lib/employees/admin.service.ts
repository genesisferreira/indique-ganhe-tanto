import "server-only"

import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { asString } from "@/lib/collections/db"
import { isEligibleForFutureAssignment } from "@/lib/employees/foundation"
import {
  EMPLOYEE_ADMIN_EVENT_SOURCE,
  canDeactivateMembership,
  commercialMembershipDoesNotBypassLegacy,
  decideMembershipChange,
  matchesEmployeeSearch,
  parseRequestedEmployeeStatus,
} from "@/lib/employees/admin-policy"
import {
  disableAuthUserLogin,
  enableAuthUserLogin,
  shouldInactivateProfileOnEmployeeStatus,
} from "@/lib/auth/account-lifecycle"
import type { EmployeeStatus } from "@/types/employee"

function db() {
  return createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string, opts?: { count?: "exact"; head?: boolean }) => any
      insert: (values: unknown) => any
      update: (values: unknown) => any
    }
  }
}

export type AdminSector = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  activeMemberCount: number
}

export type AdminEmployeeMembership = {
  id: string
  sectorId: string
  sectorCode: string
  sectorName: string
  isActive: boolean
  joinedAt: string
  leftAt: string | null
  receivingAssignments: boolean | null
  isAvailable: boolean | null
  activeAssignments: number
}

export type AdminEmployeeListItem = {
  id: string
  profileId: string
  name: string
  email: string
  phone: string | null
  status: EmployeeStatus
  legacyRole: string
  sectors: Array<{ code: string; name: string; isActive: boolean }>
  updatedAt: string
  assignmentEligible: boolean
}

export type AdminEmployeeDetail = AdminEmployeeListItem & {
  notes: string | null
  hiredAt: string | null
  dismissedAt: string | null
  createdAt: string
  memberships: AdminEmployeeMembership[]
  events: Array<{
    id: string
    eventType: string
    sectorName: string | null
    actorName: string | null
    oldValue: Record<string, unknown> | null
    newValue: Record<string, unknown> | null
    createdAt: string
  }>
  commercialLegacy: {
    profileRole: string
    hasCommercialMembership: boolean
    hasLeadSettings: boolean
    distributionReady: boolean
    message: string
  }
}

export type ProfileSearchHit = {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  isActive: boolean
  employeeId: string | null
}

function asStatus(value: unknown): EmployeeStatus {
  const parsed = parseRequestedEmployeeStatus(value)
  return parsed ?? "paused"
}

async function recordAdminEvent(input: {
  employeeId: string
  eventType: string
  actorProfileId: string
  sectorId?: string | null
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}) {
  const client = db()
  await client.from("employee_events" as never).insert({
    employee_id: input.employeeId,
    event_type: input.eventType,
    sector_id: input.sectorId ?? null,
    actor_profile_id: input.actorProfileId,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    metadata: {
      source: EMPLOYEE_ADMIN_EVENT_SOURCE,
      ...(input.metadata ?? {}),
    },
  } as never)
}

export async function listSectorsWithMemberCounts(): Promise<AdminSector[]> {
  const client = db()
  const { data: sectors, error } = await client
    .from("sectors" as never)
    .select("id, code, name, description, is_active, created_at, updated_at")
    .order("name", { ascending: true })
  if (error) throw new Error(error.message)

  const { data: memberships } = await client
    .from("employee_sector_memberships" as never)
    .select("sector_id, is_active")
    .eq("is_active", true)

  const counts = new Map<string, number>()
  for (const row of memberships ?? []) {
    const id = asString((row as { sector_id?: string }).sector_id)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return ((sectors ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    description: asString(row.description),
    isActive: row.is_active !== false,
    activeMemberCount: counts.get(String(row.id)) ?? 0,
  }))
}

async function loadSectorMap() {
  const sectors = await listSectorsWithMemberCounts()
  return new Map(sectors.map((sector) => [sector.id, sector]))
}

export async function listAdminEmployees(input: {
  search?: string
  status?: string
  sectorCode?: string
}): Promise<AdminEmployeeListItem[]> {
  const client = db()
  const { data: employees, error } = await client
    .from("employees" as never)
    .select("id, profile_id, status, notes, hired_at, dismissed_at, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)

  const rows = (employees ?? []) as Array<Record<string, unknown>>
  const profileIds = rows.map((row) => String(row.profile_id)).filter(Boolean)
  const employeeIds = rows.map((row) => String(row.id)).filter(Boolean)

  const [{ data: profiles }, { data: memberships }, sectorMap] = await Promise.all([
    profileIds.length
      ? client
          .from("profiles")
          .select("id, full_name, email, phone, role, is_active")
          .in("id", profileIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    employeeIds.length
      ? client
          .from("employee_sector_memberships" as never)
          .select("id, employee_id, sector_id, is_active")
          .in("employee_id", employeeIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    loadSectorMap(),
  ])

  const profileMap = new Map(
    ((profiles ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  )
  const membershipsByEmployee = new Map<string, Array<Record<string, unknown>>>()
  for (const row of (memberships ?? []) as Array<Record<string, unknown>>) {
    const employeeId = String(row.employee_id)
    const list = membershipsByEmployee.get(employeeId) ?? []
    list.push(row)
    membershipsByEmployee.set(employeeId, list)
  }

  const search = input.search ?? ""
  const statusFilter = parseRequestedEmployeeStatus(input.status)
  const sectorFilter = (input.sectorCode ?? "").trim()

  const items: AdminEmployeeListItem[] = []
  for (const row of rows) {
    const profile = profileMap.get(String(row.profile_id))
    if (!profile) continue
    const status = asStatus(row.status)
    const membershipRows = membershipsByEmployee.get(String(row.id)) ?? []
    const sectors = membershipRows.map((membership) => {
      const sector = sectorMap.get(String(membership.sector_id))
      return {
        code: sector?.code ?? String(membership.sector_id),
        name: sector?.name ?? "Setor",
        isActive: membership.is_active === true,
      }
    })
    if (statusFilter && status !== statusFilter) continue
    if (sectorFilter && sectorFilter !== "all") {
      const hasSector = sectors.some((sector) => sector.isActive && sector.code === sectorFilter)
      if (!hasSector) continue
    }
    const name = asString(profile.full_name) ?? "Sem nome"
    const email = asString(profile.email) ?? ""
    const phone = asString(profile.phone)
    if (!matchesEmployeeSearch({ name, email, phone, query: search })) continue

    items.push({
      id: String(row.id),
      profileId: String(row.profile_id),
      name,
      email,
      phone,
      status,
      legacyRole: String(profile.role ?? ""),
      sectors,
      updatedAt: String(row.updated_at ?? row.created_at ?? ""),
      assignmentEligible: isEligibleForFutureAssignment({
        employeeStatus: status,
        membershipActive: sectors.some((sector) => sector.isActive),
      }),
    })
  }
  return items
}

export async function getAdminEmployee(employeeId: string): Promise<AdminEmployeeDetail | null> {
  const client = db()
  const { data: employee } = await client
    .from("employees" as never)
    .select("id, profile_id, status, notes, hired_at, dismissed_at, created_at, updated_at")
    .eq("id", employeeId)
    .maybeSingle()
  if (!employee?.id) return null

  const emp = employee as Record<string, unknown>
  const [{ data: profile }, { data: memberships }, { data: events }, sectorMap, { data: leadSettings }] =
    await Promise.all([
      client
        .from("profiles")
        .select("id, full_name, email, phone, role, is_active")
        .eq("id", String(emp.profile_id))
        .maybeSingle(),
      client
        .from("employee_sector_memberships" as never)
        .select("id, employee_id, sector_id, is_active, joined_at, left_at, created_at, updated_at")
        .eq("employee_id", employeeId)
        .order("joined_at", { ascending: false }),
      client
        .from("employee_events" as never)
        .select("id, event_type, sector_id, actor_profile_id, old_value, new_value, metadata, created_at")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false })
        .limit(80),
      loadSectorMap(),
      client
        .from("commercial_lead_settings" as never)
        .select("id")
        .eq("commercial_profile_id", String(emp.profile_id))
        .maybeSingle(),
    ])

  if (!profile) return null

  const membershipRows = (memberships ?? []) as Array<Record<string, unknown>>
  const membershipIds = membershipRows.map((row) => String(row.id))
  const [{ data: settings }, { data: assignments }] = await Promise.all([
    membershipIds.length
      ? client
          .from("employee_sector_assignment_settings" as never)
          .select("membership_id, receiving_assignments, is_available, active_assignments")
          .in("membership_id", membershipIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    client
      .from("sector_work_assignments" as never)
      .select("id, sector_id, membership_id")
      .eq("employee_id", employeeId)
      .eq("status", "active"),
  ])

  const settingsMap = new Map(
    ((settings ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.membership_id), row])
  )
  const assignmentCount = new Map<string, number>()
  for (const row of (assignments ?? []) as Array<Record<string, unknown>>) {
    const membershipId = asString(row.membership_id)
    if (!membershipId) continue
    assignmentCount.set(membershipId, (assignmentCount.get(membershipId) ?? 0) + 1)
  }

  const mappedMemberships: AdminEmployeeMembership[] = membershipRows.map((row) => {
    const sector = sectorMap.get(String(row.sector_id))
    const setting = settingsMap.get(String(row.id))
    return {
      id: String(row.id),
      sectorId: String(row.sector_id),
      sectorCode: sector?.code ?? "",
      sectorName: sector?.name ?? "Setor",
      isActive: row.is_active === true,
      joinedAt: String(row.joined_at ?? ""),
      leftAt: asString(row.left_at),
      receivingAssignments:
        typeof setting?.receiving_assignments === "boolean" ? setting.receiving_assignments : null,
      isAvailable: typeof setting?.is_available === "boolean" ? setting.is_available : null,
      activeAssignments: assignmentCount.get(String(row.id)) ?? 0,
    }
  })

  const actorIds = [
    ...new Set(
      ((events ?? []) as Array<Record<string, unknown>>)
        .map((row) => asString(row.actor_profile_id))
        .filter((id): id is string => Boolean(id))
    ),
  ]
  const { data: actors } = actorIds.length
    ? await client.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] as Array<Record<string, unknown>> }
  const actorMap = new Map(
    ((actors ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), asString(row.full_name)])
  )

  const visibleEvents = ((events ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>
    return metadata.source === EMPLOYEE_ADMIN_EVENT_SOURCE || asString(row.actor_profile_id)
  })

  const status = asStatus(emp.status)
  const activeSectors = mappedMemberships.filter((item) => item.isActive)
  const hasCommercialMembership = activeSectors.some((item) => item.sectorCode === "commercial")
  const hasLeadSettings = Boolean((leadSettings as { id?: string } | null)?.id)
  const commercial = commercialMembershipDoesNotBypassLegacy({
    profileRole: String((profile as Record<string, unknown>).role ?? ""),
    hasCommercialLeadSettings: hasLeadSettings,
  })

  return {
    id: String(emp.id),
    profileId: String(emp.profile_id),
    name: asString((profile as Record<string, unknown>).full_name) ?? "Sem nome",
    email: asString((profile as Record<string, unknown>).email) ?? "",
    phone: asString((profile as Record<string, unknown>).phone),
    status,
    legacyRole: String((profile as Record<string, unknown>).role ?? ""),
    sectors: mappedMemberships.map((item) => ({
      code: item.sectorCode,
      name: item.sectorName,
      isActive: item.isActive,
    })),
    updatedAt: String(emp.updated_at ?? ""),
    assignmentEligible: isEligibleForFutureAssignment({
      employeeStatus: status,
      membershipActive: activeSectors.length > 0,
    }),
    notes: asString(emp.notes),
    hiredAt: asString(emp.hired_at),
    dismissedAt: asString(emp.dismissed_at),
    createdAt: String(emp.created_at ?? ""),
    memberships: mappedMemberships,
    events: visibleEvents.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      sectorName: sectorMap.get(String(row.sector_id ?? ""))?.name ?? null,
      actorName: actorMap.get(String(row.actor_profile_id ?? "")) ?? null,
      oldValue: (row.old_value as Record<string, unknown> | null) ?? null,
      newValue: (row.new_value as Record<string, unknown> | null) ?? null,
      createdAt: String(row.created_at ?? ""),
    })),
    commercialLegacy: {
      profileRole: String((profile as Record<string, unknown>).role ?? ""),
      hasCommercialMembership,
      hasLeadSettings,
      distributionReady: commercial.commercialDistributionReady,
      message: commercial.message,
    },
  }
}

export async function searchProfilesForEmployee(query: string): Promise<ProfileSearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const client = db()
  const like = `%${q.replace(/[%_,]/g, "")}%`
  const { data: profiles, error } = await client
    .from("profiles")
    .select("id, full_name, email, phone, role, is_active")
    .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
    .limit(20)
  if (error) throw new Error(error.message)

  const ids = ((profiles ?? []) as Array<Record<string, unknown>>).map((row) => String(row.id))
  const { data: employees } = ids.length
    ? await client.from("employees" as never).select("id, profile_id").in("profile_id", ids)
    : { data: [] as Array<Record<string, unknown>> }
  const employeeByProfile = new Map(
    ((employees ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.profile_id),
      String(row.id),
    ])
  )

  return ((profiles ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: asString(row.full_name) ?? "Sem nome",
    email: asString(row.email) ?? "",
    phone: asString(row.phone),
    role: String(row.role ?? ""),
    isActive: row.is_active !== false,
    employeeId: employeeByProfile.get(String(row.id)) ?? null,
  }))
}

export async function linkOrCreateEmployee(input: {
  profileId: string
  status?: unknown
  actorProfileId: string
}): Promise<{ ok: true; employeeId: string; created: boolean } | { ok: false; message: string }> {
  const profileId = input.profileId.trim()
  if (!profileId) return { ok: false, message: "Perfil inválido." }
  const status = parseRequestedEmployeeStatus(input.status) ?? "active"
  const client = db()

  const { data: profile } = await client
    .from("profiles")
    .select("id, role")
    .eq("id", profileId)
    .maybeSingle()
  if (!profile?.id) return { ok: false, message: "Usuário não encontrado." }

  const { data: existing } = await client
    .from("employees" as never)
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle()
  if (existing?.id) {
    return { ok: true, employeeId: String(existing.id), created: false }
  }

  const { data: inserted, error } = await client
    .from("employees" as never)
    .insert({
      profile_id: profileId,
      status,
      hired_at: new Date().toISOString(),
    } as never)
    .select("id")
    .maybeSingle()

  if (error || !inserted?.id) {
    return { ok: false, message: error?.message ?? "Não foi possível criar o funcionário." }
  }

  await recordAdminEvent({
    employeeId: String(inserted.id),
    eventType: "employee_created",
    actorProfileId: input.actorProfileId,
    newValue: { status, profile_id: profileId },
  })
  return { ok: true, employeeId: String(inserted.id), created: true }
}

export async function updateEmployeeStatus(input: {
  employeeId: string
  status: unknown
  notes?: unknown
  actorProfileId: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const status = parseRequestedEmployeeStatus(input.status)
  if (!status) return { ok: false, message: "Estado do funcionário inválido." }
  const client = db()
  const { data: current } = await client
    .from("employees" as never)
    .select("id, status, notes, profile_id")
    .eq("id", input.employeeId)
    .maybeSingle()
  if (!current?.id) return { ok: false, message: "Funcionário não encontrado." }

  const notes =
    typeof input.notes === "string" ? input.notes.trim().slice(0, 500) || null : undefined
  const patch: Record<string, unknown> = { status }
  if (notes !== undefined) patch.notes = notes

  const { error } = await client
    .from("employees" as never)
    .update(patch as never)
    .eq("id", input.employeeId)
  if (error) return { ok: false, message: error.message }

  const previousStatus = String((current as Record<string, unknown>).status)
  const profileId = asString((current as Record<string, unknown>).profile_id)
  if (profileId && shouldInactivateProfileOnEmployeeStatus(status)) {
    await client
      .from("profiles")
      .update({ is_active: false } as never)
      .eq("id", profileId)
    await disableAuthUserLogin(createServiceRoleClient(), profileId)
  } else if (profileId && previousStatus === "dismissed" && status !== "dismissed") {
    await client
      .from("profiles")
      .update({ is_active: true } as never)
      .eq("id", profileId)
    await enableAuthUserLogin(createServiceRoleClient(), profileId)
  }

  if (previousStatus !== status) {
    await recordAdminEvent({
      employeeId: input.employeeId,
      eventType: status === "dismissed" ? "employee_dismissed" : "status_changed",
      actorProfileId: input.actorProfileId,
      oldValue: { status: previousStatus },
      newValue: { status },
    })
  }
  return { ok: true }
}

export async function setEmployeeSectorMembership(input: {
  employeeId: string
  sectorCode: string
  active: boolean
  actorProfileId: string
}): Promise<
  | {
      ok: true
      commercialWarning?: string
    }
  | { ok: false; status: 400 | 409; message: string; activeAssignments?: number }
> {
  const sectorCode = input.sectorCode.trim()
  if (!sectorCode) return { ok: false, status: 400, message: "Setor inválido." }

  const client = db()
  const { data: sector } = await client
    .from("sectors" as never)
    .select("id, code, name, is_active")
    .eq("code", sectorCode)
    .maybeSingle()
  if (!sector?.id) return { ok: false, status: 400, message: "Setor não encontrado no catálogo." }

  const { data: employee } = await client
    .from("employees" as never)
    .select("id, profile_id")
    .eq("id", input.employeeId)
    .maybeSingle()
  if (!employee?.id) return { ok: false, status: 400, message: "Funcionário não encontrado." }

  const { data: existing } = await client
    .from("employee_sector_memberships" as never)
    .select("id, is_active, joined_at, updated_at")
    .eq("employee_id", input.employeeId)
    .eq("sector_id", String(sector.id))

  const decision = decideMembershipChange({
    existing: ((existing ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      isActive: row.is_active === true,
      updatedAt: asString(row.updated_at),
      joinedAt: asString(row.joined_at),
    })),
    wantActive: input.active,
  })

  if (decision.action === "reject_duplicate") {
    return { ok: false, status: 409, message: "Já existe membership ativa neste setor." }
  }
  if (decision.action === "noop") {
    return { ok: true }
  }

  if (decision.action === "deactivate") {
    const { count } = await client
      .from("sector_work_assignments" as never)
      .select("id", { count: "exact", head: true })
      .eq("employee_id", input.employeeId)
      .eq("membership_id", decision.membershipId)
      .eq("status", "active")
    const guard = canDeactivateMembership(count ?? 0)
    if (!guard.ok) {
      return {
        ok: false,
        status: 409,
        message: guard.message,
        activeAssignments: guard.count,
      }
    }
    const { error } = await client
      .from("employee_sector_memberships" as never)
      .update({ is_active: false } as never)
      .eq("id", decision.membershipId)
    if (error) return { ok: false, status: 400, message: error.message }
    await recordAdminEvent({
      employeeId: input.employeeId,
      eventType: "sector_removed",
      actorProfileId: input.actorProfileId,
      sectorId: String(sector.id),
      oldValue: { is_active: true, sector_code: sectorCode },
      newValue: { is_active: false, sector_code: sectorCode },
    })
    return { ok: true }
  }

  if (decision.action === "activate") {
    const { error } = await client
      .from("employee_sector_memberships" as never)
      .update({ is_active: true, left_at: null } as never)
      .eq("id", decision.membershipId)
    if (error) {
      if (error.code === "23505") {
        return { ok: false, status: 409, message: "Já existe membership ativa neste setor." }
      }
      return { ok: false, status: 400, message: error.message }
    }
    await recordAdminEvent({
      employeeId: input.employeeId,
      eventType: "sector_added",
      actorProfileId: input.actorProfileId,
      sectorId: String(sector.id),
      oldValue: { is_active: false, sector_code: sectorCode },
      newValue: { is_active: true, sector_code: sectorCode, membership_id: decision.membershipId },
    })
  } else {
    const { data: inserted, error } = await client
      .from("employee_sector_memberships" as never)
      .insert({
        employee_id: input.employeeId,
        sector_id: String(sector.id),
        is_active: true,
      } as never)
      .select("id")
      .maybeSingle()
    if (error) {
      if (error.code === "23505") {
        return { ok: false, status: 409, message: "Já existe membership ativa neste setor." }
      }
      return { ok: false, status: 400, message: error.message }
    }
    await recordAdminEvent({
      employeeId: input.employeeId,
      eventType: "sector_added",
      actorProfileId: input.actorProfileId,
      sectorId: String(sector.id),
      newValue: {
        is_active: true,
        sector_code: sectorCode,
        membership_id: inserted?.id ?? null,
      },
    })
  }

  if (sectorCode === "commercial") {
    const { data: profile } = await client
      .from("profiles")
      .select("role")
      .eq("id", String((employee as Record<string, unknown>).profile_id))
      .maybeSingle()
    const { data: settings } = await client
      .from("commercial_lead_settings" as never)
      .select("id")
      .eq("commercial_profile_id", String((employee as Record<string, unknown>).profile_id))
      .maybeSingle()
    const warning = commercialMembershipDoesNotBypassLegacy({
      profileRole: asString((profile as Record<string, unknown> | null)?.role),
      hasCommercialLeadSettings: Boolean((settings as { id?: string } | null)?.id),
    })
    return { ok: true, commercialWarning: warning.message }
  }

  return { ok: true }
}

export async function listMyActiveSectorCodes(profileId: string): Promise<string[]> {
  const client = db()
  const { data: employee } = await client
    .from("employees" as never)
    .select("id, status")
    .eq("profile_id", profileId)
    .maybeSingle()
  if (!employee?.id) return []
  if (asString((employee as Record<string, unknown>).status) !== "active") return []

  const { data: memberships } = await client
    .from("employee_sector_memberships" as never)
    .select("sector_id")
    .eq("employee_id", String(employee.id))
    .eq("is_active", true)
  const sectorIds = ((memberships ?? []) as Array<Record<string, unknown>>)
    .map((row) => asString(row.sector_id))
    .filter((id): id is string => Boolean(id))
  if (sectorIds.length === 0) return []

  const { data: sectors } = await client
    .from("sectors" as never)
    .select("id, code")
    .in("id", sectorIds)
  return ((sectors ?? []) as Array<Record<string, unknown>>)
    .map((row) => asString(row.code))
    .filter((code): code is string => Boolean(code))
}
