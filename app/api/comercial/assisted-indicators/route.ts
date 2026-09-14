import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  COMMERCIAL_ASSISTED_INDICATOR_AUDIT_ENTITY,
} from "@/lib/commercial-assisted/constants"
import {
  createAssistedIndicator,
  type AssistedIndicatorClientPayload,
  type AssistedIndicatorCreationRow,
  type AssistedIndicatorProfileRow,
  type CreationUpdateResult,
} from "@/lib/commercial-assisted/create-assisted-indicator"
import { logAssistedIndicatorDbError } from "@/lib/commercial-assisted/assisted-indicator-db-log"
import { isUniqueViolationError } from "@/lib/commercial-assisted/idempotency"
import { createConfirmedAuthUserWithPassword } from "@/lib/auth/create-confirmed-auth-user"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { from: (t: string) => any }

function mapProfile(row: Record<string, unknown> | null): AssistedIndicatorProfileRow | null {
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

function mapCreation(
  data: Record<string, unknown> | null
): AssistedIndicatorCreationRow | null {
  if (!data?.id) return null
  return {
    id: String(data.id),
    idempotency_key: String(data.idempotency_key),
    actor_profile_id: (data.actor_profile_id as string | null) ?? null,
    indicator_profile_id: (data.indicator_profile_id as string | null) ?? null,
    auth_user_id: (data.auth_user_id as string | null) ?? null,
    status: data.status as "pending" | "created" | "failed",
  }
}

function idempotencyKeyPrefix(key: string): string {
  return key.length >= 8 ? key.slice(0, 8) : key
}

export async function POST(request: NextRequest) {
  let body: AssistedIndicatorClientPayload
  try {
    body = (await request.json()) as AssistedIndicatorClientPayload
  } catch {
    return NextResponse.json(
      { ok: false, message: "Payload inválido." },
      { status: 400 }
    )
  }

  // A) Sessão do Comercial — NUNCA service role para auth/role.
  const supabase = await createClient()

  // B) Privilegiado — service role SEM cookies; lazy após auth no service.
  let privileged: ReturnType<typeof createServiceRoleClient> | null = null
  function getPrivileged() {
    if (!privileged) {
      privileged = createServiceRoleClient()
    }
    return privileged
  }
  function getPrivilegedDb(): AnyDb {
    return getPrivileged() as unknown as AnyDb
  }

  const result = await createAssistedIndicator(
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
        const { data } = await supabase
          .from("profiles")
          .select("id, role, is_active")
          .eq("id", userId)
          .maybeSingle()
        return (data as {
          id: string
          role: string
          is_active: boolean | null
        } | null) ?? null
      },
      findCreationByKey: async (key) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("assisted_indicator_creations")
          .select(
            "id, idempotency_key, actor_profile_id, indicator_profile_id, auth_user_id, status"
          )
          .eq("idempotency_key", key)
          .maybeSingle()
        if (error) {
          logAssistedIndicatorDbError({
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
          .from("assisted_indicator_creations")
          .insert({
            idempotency_key: idempotencyKey,
            actor_profile_id: actorProfileId,
            status: "pending",
          })
          .select("id")
          .maybeSingle()
        if (error || !data?.id) {
          logAssistedIndicatorDbError({
            stage: "idempotency_insert_pending",
            operation: "insert",
            error: error ?? { message: "insert_failed_no_row" },
            idempotencyKeyPrefix: idempotencyKeyPrefix(idempotencyKey),
          })
          return {
            error: (error?.message as string | undefined) ?? "insert_failed",
            uniqueViolation: isUniqueViolationError(error),
          }
        }
        return { id: data.id as string }
      },
      updateCreation: async ({
        id,
        status,
        indicatorProfileId,
        authUserId,
      }): Promise<CreationUpdateResult> => {
        const db = getPrivilegedDb()
        const patch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        }
        if (status !== undefined) patch.status = status
        if (indicatorProfileId !== undefined) {
          patch.indicator_profile_id = indicatorProfileId
        }
        if (authUserId !== undefined) {
          patch.auth_user_id = authUserId
        }
        const { data, error } = await db
          .from("assisted_indicator_creations")
          .update(patch)
          .eq("id", id)
          .select("id")
          .maybeSingle()
        if (error || !data?.id) {
          logAssistedIndicatorDbError({
            stage: "idempotency_update",
            operation: "update",
            error: error ?? { message: "update_failed_no_row" },
          })
          return {
            ok: false,
            message: (error?.message as string | undefined) ?? "update_failed",
          }
        }
        return { ok: true }
      },
      findProfileByEmail: async (email) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("profiles")
          .select(
            "id, full_name, email, phone, cpf, role, is_active, must_change_password"
          )
          .ilike("email", email)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      findProfileByCpf: async (cpf) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("profiles")
          .select(
            "id, full_name, email, phone, cpf, role, is_active, must_change_password"
          )
          .eq("cpf", cpf)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      findPixOwnerProfileId: async (normalizedPix) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("pix_keys")
          .select("profile_id")
          .eq("key_value", normalizedPix)
          .maybeSingle()
        const row = data as { profile_id?: string } | null
        return row?.profile_id ?? null
      },
      findProfileById: async (id) => {
        const db = getPrivilegedDb()
        const { data } = await db
          .from("profiles")
          .select(
            "id, full_name, email, phone, cpf, role, is_active, must_change_password"
          )
          .eq("id", id)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      waitForProfile: async (userId) => {
        const db = getPrivilegedDb()
        for (let i = 0; i < 5; i += 1) {
          const { data } = await db
            .from("profiles")
            .select(
              "id, full_name, email, phone, cpf, role, is_active, must_change_password"
            )
            .eq("id", userId)
            .maybeSingle()
          const mapped = mapProfile(data as Record<string, unknown> | null)
          if (mapped) return mapped
          await new Promise((r) => setTimeout(r, 80 * (i + 1)))
        }
        return null
      },
      createAuthUser: async ({ email, password, metadata }) => {
        const created = await createConfirmedAuthUserWithPassword(getPrivileged(), {
          email,
          password,
          userMetadata: metadata,
        })
        if (!created.ok) {
          if (created.code === "email_exists") {
            return { ok: false as const, code: "email_exists" as const }
          }
          logAssistedIndicatorDbError({
            stage: "auth_create_user",
            operation: "createUser",
            error: { message: created.message ?? "create_failed" },
          })
          return { ok: false as const, code: "create_failed" as const }
        }
        return { ok: true as const, userId: created.userId }
      },
      deleteAuthUser: async (userId) => {
        const { error } = await getPrivileged().auth.admin.deleteUser(userId)
        return { ok: !error }
      },
      updateProfileAfterCreate: async ({ profileId, cpf }) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("profiles")
          .update({
            cpf,
            must_change_password: true,
          })
          .eq("id", profileId)
          .eq("role", "indicador")
          .select("id, cpf, must_change_password, role")
          .maybeSingle()
        if (error || !data) {
          if (isUniqueViolationError(error)) {
            return {
              ok: false as const,
              message:
                "Já existe um cadastro com este CPF. Procure o indicador existente.",
            }
          }
          logAssistedIndicatorDbError({
            stage: "profile_finalize",
            operation: "update",
            error: error ?? { message: "profile_update_failed" },
          })
          return {
            ok: false as const,
            message: "Não foi possível finalizar o cadastro do indicador.",
          }
        }
        const row = data as {
          cpf: string | null
          must_change_password: boolean | null
        }
        if (row.cpf !== cpf || row.must_change_password !== true) {
          return {
            ok: false as const,
            message: "Não foi possível confirmar o estado do perfil.",
          }
        }
        return { ok: true as const }
      },
      insertAudit: async ({ actorProfileId, entityId, metadata }) => {
        // Best-effort sob a sessão do ator (não bloqueia criação).
        const db = supabase as unknown as AnyDb
        await db.from("audit_logs").insert({
          actor_profile_id: actorProfileId,
          target_profile_id: entityId,
          entity_name: COMMERCIAL_ASSISTED_INDICATOR_AUDIT_ENTITY,
          entity_id: entityId,
          action: "create",
          old_data: null,
          new_data: null,
          metadata,
        })
      },
    },
    body
  )

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.message },
      { status: result.status }
    )
  }

  return NextResponse.json({
    ok: true,
    replayed: result.replayed,
    indicator: result.indicator,
    login: result.login,
    temporaryPassword: result.temporaryPassword,
    mustChangePassword: result.mustChangePassword,
    passwordAlreadyIssued: result.passwordAlreadyIssued,
  })
}
