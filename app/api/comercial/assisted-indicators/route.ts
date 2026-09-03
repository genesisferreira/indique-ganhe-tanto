import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  COMMERCIAL_ASSISTED_INDICATOR_AUDIT_ENTITY,
} from "@/lib/commercial-assisted/constants"
import {
  createAssistedIndicator,
  type AssistedIndicatorClientPayload,
  type AssistedIndicatorProfileRow,
} from "@/lib/commercial-assisted/create-assisted-indicator"
import { isUniqueViolationError } from "@/lib/commercial-assisted/idempotency"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Tabelas/colunas novas ainda fora do Database tipado — acesso via service/admin untyped.
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

  const supabase = await createClient()
  const admin = (await createAdminClient()) as unknown as AnyDb
  const service = createServiceRoleClient()

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
        const { data } = await admin
          .from("assisted_indicator_creations")
          .select(
            "id, idempotency_key, actor_profile_id, indicator_profile_id, status"
          )
          .eq("idempotency_key", key)
          .maybeSingle()
        if (!data) return null
        return data as {
          id: string
          idempotency_key: string
          actor_profile_id: string | null
          indicator_profile_id: string | null
          status: "pending" | "created" | "failed"
        }
      },
      insertCreationPending: async ({ idempotencyKey, actorProfileId }) => {
        const { data, error } = await admin
          .from("assisted_indicator_creations")
          .insert({
            idempotency_key: idempotencyKey,
            actor_profile_id: actorProfileId,
            status: "pending",
          })
          .select("id")
          .maybeSingle()
        if (error || !data?.id) {
          return {
            error: (error?.message as string | undefined) ?? "insert_failed",
            uniqueViolation: isUniqueViolationError(error),
          }
        }
        return { id: data.id as string }
      },
      updateCreation: async ({ id, status, indicatorProfileId }) => {
        const patch: Record<string, unknown> = {
          status,
          updated_at: new Date().toISOString(),
        }
        if (indicatorProfileId !== undefined) {
          patch.indicator_profile_id = indicatorProfileId
        }
        await admin
          .from("assisted_indicator_creations")
          .update(patch)
          .eq("id", id)
      },
      findProfileByEmail: async (email) => {
        const { data } = await admin
          .from("profiles")
          .select(
            "id, full_name, email, phone, cpf, role, is_active, must_change_password"
          )
          .ilike("email", email)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      findProfileByCpf: async (cpf) => {
        const { data } = await admin
          .from("profiles")
          .select(
            "id, full_name, email, phone, cpf, role, is_active, must_change_password"
          )
          .eq("cpf", cpf)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      findPixOwnerProfileId: async (normalizedPix) => {
        const { data } = await admin
          .from("pix_keys")
          .select("profile_id")
          .eq("key_value", normalizedPix)
          .maybeSingle()
        const row = data as { profile_id?: string } | null
        return row?.profile_id ?? null
      },
      findProfileById: async (id) => {
        const { data } = await admin
          .from("profiles")
          .select(
            "id, full_name, email, phone, cpf, role, is_active, must_change_password"
          )
          .eq("id", id)
          .maybeSingle()
        return mapProfile(data as Record<string, unknown> | null)
      },
      waitForProfile: async (userId) => {
        for (let i = 0; i < 5; i += 1) {
          const { data } = await admin
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
        const { data, error } = await service.auth.admin.createUser({
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
          console.error("[assisted-indicator]", {
            step: "createUser",
            hasError: Boolean(error),
          })
          return { ok: false as const, code: "create_failed" as const }
        }
        return { ok: true as const, userId: data.user.id }
      },
      deleteAuthUser: async (userId) => {
        const { error } = await service.auth.admin.deleteUser(userId)
        return { ok: !error }
      },
      updateProfileAfterCreate: async ({ profileId, cpf }) => {
        const { data, error } = await admin
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
