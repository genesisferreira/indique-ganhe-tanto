import { NextResponse } from "next/server"
import { jsonError } from "@/lib/collections/http"
import { authorizeEmployeeAdminRequest } from "@/lib/employees/admin-auth"
import {
  EMPLOYEE_ADMIN_EVENT_SOURCE,
  stripEmployeeAdminBrowserActor,
} from "@/lib/employees/admin-policy"
import {
  createEmployeeAccount,
  type EmployeeAccountClientPayload,
  type EmployeeAccountCreationRow,
  type EmployeeAccountProfileRow,
} from "@/lib/employees/create-employee-account"
import { logEmployeeAccountDbError } from "@/lib/employees/employee-account-db-log"
import { isUniqueViolationError } from "@/lib/commercial-assisted/idempotency"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { from: (t: string) => any }

function mapProfile(row: Record<string, unknown> | null): EmployeeAccountProfileRow | null {
  if (!row?.id) return null
  return {
    id: String(row.id),
    full_name: (row.full_name as string | null) ?? null,
    email: String(row.email ?? ""),
    phone: (row.phone as string | null) ?? null,
    cpf: (row.cpf as string | null) ?? null,
    role: String(row.role ?? ""),
    is_active: (row.is_active as boolean | null) ?? null,
    must_change_password: (row.must_change_password as boolean | null) ?? null,
  }
}

function mapCreation(data: Record<string, unknown> | null): EmployeeAccountCreationRow | null {
  if (!data?.id) return null
  return {
    id: String(data.id),
    idempotency_key: String(data.idempotency_key),
    actor_profile_id: (data.actor_profile_id as string | null) ?? null,
    auth_user_id: (data.auth_user_id as string | null) ?? null,
    profile_id: (data.profile_id as string | null) ?? null,
    employee_id: (data.employee_id as string | null) ?? null,
    status: data.status as "pending" | "created" | "failed",
  }
}

function idempotencyKeyPrefix(key: string): string {
  return key.length >= 8 ? key.slice(0, 8) : key
}

export async function POST(request: Request) {
  const gate = await authorizeEmployeeAdminRequest("write")
  if (!gate.ok) return jsonError(gate.status, gate.message)

  let body: EmployeeAccountClientPayload
  try {
    body = stripEmployeeAdminBrowserActor(
      await request.json()
    ) as EmployeeAccountClientPayload
  } catch {
    return jsonError(400, "Payload inválido.")
  }

  const supabase = await createClient()
  let privileged: ReturnType<typeof createServiceRoleClient> | null = null
  function getPrivileged() {
    if (!privileged) privileged = createServiceRoleClient()
    return privileged
  }
  function getPrivilegedDb(): AnyDb {
    return getPrivileged() as unknown as AnyDb
  }

  const result = await createEmployeeAccount(
    {
      getUser: async () => {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()
        if (error || !user) return null
        return { id: user.id }
      },
      getActorProfile: async (userId) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("profiles")
          .select("id, role, is_active")
          .eq("id", userId)
          .maybeSingle()
        return (
          (data as { id: string; role: string; is_active: boolean | null } | null) ?? null
        )
      },
      findCreationByKey: async (key) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("employee_account_creations")
          .select(
            "id, idempotency_key, actor_profile_id, auth_user_id, profile_id, employee_id, status"
          )
          .eq("idempotency_key", key)
          .maybeSingle()
        if (error) {
          logEmployeeAccountDbError({
            stage: "idempotency_lookup",
            operation: "select",
            error,
            idempotencyKeyPrefix: idempotencyKeyPrefix(key),
          })
        }
        return mapCreation(data as Record<string, unknown> | null)
      },
      insertCreationPending: async ({ idempotencyKey, actorProfileId }) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("employee_account_creations")
          .insert({
            idempotency_key: idempotencyKey,
            actor_profile_id: actorProfileId,
            status: "pending",
          })
          .select("id")
          .maybeSingle()
        if (error || !data?.id) {
          return {
            error: error?.message ?? "insert_failed",
            uniqueViolation: isUniqueViolationError(error),
          }
        }
        return { id: String(data.id) }
      },
      updateCreation: async (input) => {
        const db = getPrivilegedDb()
        const patch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        }
        if (input.status) patch.status = input.status
        if (input.authUserId !== undefined) patch.auth_user_id = input.authUserId
        if (input.profileId !== undefined) patch.profile_id = input.profileId
        if (input.employeeId !== undefined) patch.employee_id = input.employeeId
        const { error } = await db
          .from("employee_account_creations")
          .update(patch)
          .eq("id", input.id)
        if (error) {
          logEmployeeAccountDbError({
            stage: "creation_update",
            operation: "update",
            error,
          })
          return { ok: false as const, message: "creation_update_failed" }
        }
        return { ok: true as const }
      },
      findProfileByEmail: async (email) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("profiles")
          .select("id, full_name, email, phone, cpf, role, is_active, must_change_password")
          .ilike("email", email)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      findProfileByCpf: async (cpf) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("profiles")
          .select("id, full_name, email, phone, cpf, role, is_active, must_change_password")
          .eq("cpf", cpf)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      findProfileById: async (id) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("profiles")
          .select("id, full_name, email, phone, cpf, role, is_active, must_change_password")
          .eq("id", id)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      findEmployeeByProfileId: async (profileId) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("employees")
          .select("id")
          .eq("profile_id", profileId)
          .maybeSingle()
        return data?.id ? { id: String(data.id) } : null
      },
      findEmployeeById: async (id) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("employees")
          .select("id, manager_employee_id")
          .eq("id", id)
          .maybeSingle()
        if (!data?.id) return null
        return {
          id: String(data.id),
          managerEmployeeId: (data.manager_employee_id as string | null) ?? null,
        }
      },
      listSectors: async () => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("sectors")
          .select("id, code, name, is_active")
          .order("name", { ascending: true })
        return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          code: String(row.code ?? ""),
          name: String(row.name ?? ""),
          isActive: row.is_active === true,
        }))
      },
      waitForProfile: async (userId) => {
        const db = getPrivilegedDb()
        for (let i = 0; i < 5; i += 1) {
          const { data } = await db
            .from("profiles")
            .select("id, full_name, email, phone, cpf, role, is_active, must_change_password")
            .eq("id", userId)
            .maybeSingle()
          const mapped = mapProfile(data as Record<string, unknown> | null)
          if (mapped) return mapped
          await new Promise((r) => setTimeout(r, 80 * (i + 1)))
        }
        return null
      },
      createAuthUser: async ({ email, password, metadata }) => {
        const { data, error } = await getPrivileged().auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: metadata,
        })
        if (error || !data.user?.id) {
          const msg = (error?.message ?? "").toLowerCase()
          if (
            msg.includes("already") ||
            msg.includes("registered") ||
            msg.includes("exists")
          ) {
            return { ok: false as const, code: "email_exists" as const }
          }
          logEmployeeAccountDbError({
            stage: "auth_create_user",
            operation: "createUser",
            error: error
              ? { message: error.message, code: (error as { code?: string }).code }
              : { message: "create_failed" },
          })
          return { ok: false as const, code: "create_failed" as const }
        }
        return { ok: true as const, userId: data.user.id }
      },
      deleteAuthUser: async (userId) => {
        const { error } = await getPrivileged().auth.admin.deleteUser(userId)
        return { ok: !error }
      },
      updateProfileAfterCreate: async ({ profileId, fullName, email, phone, cpf }) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("profiles")
          .update({
            full_name: fullName,
            email,
            phone,
            cpf,
            role: "funcionario",
            is_active: true,
            must_change_password: true,
          })
          .eq("id", profileId)
          .in("role", ["indicador", "funcionario"])
          .select("id, role, is_active, must_change_password")
          .maybeSingle()
        if (error || !data) {
          if (isUniqueViolationError(error)) {
            return {
              ok: false as const,
              message: "Já existe um cadastro com este CPF. Vincule o usuário existente se for o caso.",
            }
          }
          logEmployeeAccountDbError({
            stage: "profile_finalize",
            operation: "update",
            error: error ?? { message: "profile_update_failed" },
          })
          return { ok: false as const, message: "Não foi possível finalizar o perfil do funcionário." }
        }
        return { ok: true as const }
      },
      insertEmployee: async (input) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("employees")
          .insert({
            profile_id: input.profileId,
            status: input.status,
            hired_at: new Date().toISOString(),
            job_title: input.jobTitle,
            birth_date: input.birthDate,
            manager_employee_id: input.managerEmployeeId,
            notes: input.notes,
          })
          .select("id")
          .maybeSingle()
        if (error || !data?.id) {
          logEmployeeAccountDbError({
            stage: "employee_insert",
            operation: "insert",
            error: error ?? { message: "employee_insert_failed" },
          })
          return {
            ok: false as const,
            message: "Não foi possível criar o registro de funcionário.",
          }
        }
        return { ok: true as const, employeeId: String(data.id) }
      },
      insertMemberships: async ({ employeeId, sectorIds }) => {
        const db = getPrivilegedDb()
        for (const sectorId of sectorIds) {
          const { data: existing } = await db
            .from("employee_sector_memberships")
            .select("id, is_active")
            .eq("employee_id", employeeId)
            .eq("sector_id", sectorId)
            .eq("is_active", true)
            .maybeSingle()
          if (existing?.id) continue
          const { error } = await db.from("employee_sector_memberships").insert({
            employee_id: employeeId,
            sector_id: sectorId,
            is_active: true,
          })
          if (error && !isUniqueViolationError(error)) {
            logEmployeeAccountDbError({
              stage: "membership_insert",
              operation: "insert",
              error,
            })
            return { ok: false as const, message: "Não foi possível vincular os setores." }
          }
        }
        return { ok: true as const }
      },
      insertAuditEvents: async ({ employeeId, actorProfileId, metadata, sectorCodes }) => {
        const db = getPrivilegedDb()
        await db.from("employee_events").insert({
          employee_id: employeeId,
          event_type: "employee_created",
          actor_profile_id: actorProfileId,
          new_value: {
            status: metadata.status,
            job_title: metadata.job_title,
            manager_employee_id: metadata.manager_employee_id,
            sector_codes: sectorCodes,
          },
          metadata: {
            source: EMPLOYEE_ADMIN_EVENT_SOURCE,
            ...metadata,
          },
        })
      },
    },
    body
  )

  if (!result.ok) {
    return jsonError(result.status, result.message)
  }

  return NextResponse.json({
    ok: true,
    employeeId: result.employeeId,
    profileId: result.profileId,
    login: result.login,
    loginPath: result.loginPath,
    role: result.role,
    temporaryPassword: result.temporaryPassword,
    mustChangePassword: result.mustChangePassword,
    passwordAlreadyIssued: result.passwordAlreadyIssued,
    replayed: result.replayed,
  })
}
