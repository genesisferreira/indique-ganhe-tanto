import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import {
  COMMERCIAL_ASSISTED_CREATE_AUDIT_ENTITY,
} from "@/lib/commercial-assisted/constants"
import { logAssistedReferralDbError } from "@/lib/commercial-assisted/assisted-referral-db-log"
import {
  createAssistedReferral,
  type AssistedReferralClientPayload,
} from "@/lib/commercial-assisted/create-assisted-referral"
import { isUniqueViolationError } from "@/lib/commercial-assisted/idempotency"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { from: (t: string) => any }

function idempotencyKeyPrefix(key: string): string {
  return key.length >= 8 ? key.slice(0, 8) : key
}

/**
 * Auth: createClient() + getUser / getActorProfile (sessão real).
 * Privilegiado: createServiceRoleClient() sem cookies, lazy após autorização
 * no service createAssistedReferral.
 */
export async function POST(request: NextRequest) {
  let body: AssistedReferralClientPayload
  try {
    body = (await request.json()) as AssistedReferralClientPayload
  } catch {
    return NextResponse.json(
      { ok: false, message: "Payload inválido." },
      { status: 400 }
    )
  }

  // A) Sessão do Comercial — NUNCA service role para auth/role.
  const supabase = await createClient()

  // B) Privilegiado — service role SEM cookies; lazy após auth no service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let privileged: any = null
  function getPrivileged() {
    if (!privileged) {
      privileged = createServiceRoleClient()
    }
    return privileged
  }
  function getPrivilegedDb(): AnyDb {
    return getPrivileged() as unknown as AnyDb
  }

  const result = await createAssistedReferral(
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
          .select("id, role, is_active, full_name")
          .eq("id", userId)
          .maybeSingle()
        return (data as {
          id: string
          role: string
          is_active: boolean | null
          full_name: string | null
        } | null) ?? null
      },
      loadIndicatorProfile: async (id) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("profiles")
          .select("id, role, is_active, full_name")
          .eq("id", id)
          .maybeSingle()
        if (error) {
          logAssistedReferralDbError({
            stage: "indicator_lookup",
            operation: "select",
            error: {
              message: error.message,
              code: (error as { code?: string }).code,
            },
          })
        }
        return (data as {
          id: string
          role: string
          is_active: boolean | null
          full_name: string | null
        } | null) ?? null
      },
      listPlanRows: async () => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("plans")
          .select(
            "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
          )
          .order("sort_order", { ascending: true })
        if (error) {
          logAssistedReferralDbError({
            stage: "plans_list",
            operation: "select",
            error: {
              message: error.message,
              code: (error as { code?: string }).code,
            },
          })
          return []
        }
        return (data ?? []) as {
          id: string
          name: string
          speed_label: string
          is_active: boolean
        }[]
      },
      resolvePlanEnv: () => {
        const plan500Id =
          process.env.NEXT_PUBLIC_PUBLIC_PRE_REGISTRATION_PLAN_500_ID?.trim() ||
          process.env.PUBLIC_PRE_REGISTRATION_PLAN_500_ID?.trim() ||
          null
        const plan1000Id =
          process.env.NEXT_PUBLIC_PUBLIC_PRE_REGISTRATION_PLAN_1000_ID?.trim() ||
          process.env.PUBLIC_PRE_REGISTRATION_PLAN_1000_ID?.trim() ||
          null
        const baseCrmPlanId =
          process.env.PUBLIC_PRE_REGISTRATION_BASE_CRM_PLAN_ID?.trim() ||
          process.env.NEXT_PUBLIC_PUBLIC_PRE_REGISTRATION_BASE_CRM_PLAN_ID?.trim() ||
          plan500Id ||
          plan1000Id ||
          null
        return { plan500Id, plan1000Id, baseCrmPlanId }
      },
      findReferralByIdempotencyKey: async (key) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("referrals")
          .select(
            "id, indicator_profile_id, created_by_profile_id, commercial_profile_id, referred_name, source, reward_eligible"
          )
          .eq("assisted_idempotency_key", key)
          .maybeSingle()
        if (error) {
          logAssistedReferralDbError({
            stage: "idempotency_lookup",
            operation: "select",
            error: {
              message: error.message,
              code: (error as { code?: string }).code,
            },
            idempotencyKeyPrefix: idempotencyKeyPrefix(key),
          })
        }
        return (data as {
          id: string
          indicator_profile_id: string
          created_by_profile_id: string | null
          commercial_profile_id: string | null
          referred_name: string
          source: string | null
          reward_eligible: boolean | null
        } | null) ?? null
      },
      insertReferral: async (row) => {
        const db = getPrivilegedDb()
        const { data, error } = await db
          .from("referrals")
          .insert(row as unknown as Record<string, unknown>)
          .select("id")
          .maybeSingle()
        if (error || !data?.id) {
          logAssistedReferralDbError({
            stage: "referral_insert",
            operation: "insert",
            error: error
              ? {
                  message: error.message,
                  code: (error as { code?: string }).code,
                }
              : { message: "insert_failed_no_id" },
            idempotencyKeyPrefix: row.assisted_idempotency_key
              ? idempotencyKeyPrefix(String(row.assisted_idempotency_key))
              : undefined,
          })
          return {
            error: error?.message ?? "insert_failed",
            code: error?.code ?? null,
            uniqueViolation: isUniqueViolationError(error),
          }
        }
        return { id: data.id as string }
      },
      insertReferralHistory: async ({
        referralId,
        actorProfileId,
        newStatus,
        metadata,
      }) => {
        const db = getPrivilegedDb()
        await db.from("referral_history").insert({
          referral_id: referralId,
          actor_profile_id: actorProfileId,
          old_status: null,
          new_status: newStatus,
          action_note: "Cadastro assistido pelo Comercial",
          metadata,
        })
      },
      insertAudit: async ({ actorProfileId, entityId, metadata }) => {
        // Best-effort sob a sessão do ator (não bloqueia criação).
        const db = supabase as unknown as AnyDb
        await db.from("audit_logs").insert({
          actor_profile_id: actorProfileId,
          target_profile_id: metadata.indicator_profile_id ?? null,
          entity_name: COMMERCIAL_ASSISTED_CREATE_AUDIT_ENTITY,
          entity_id: entityId,
          action: "create",
          old_data: null,
          new_data: null,
          metadata,
        })
      },
      createControllrInterest: async ({ referralId, actorUserId }) => {
        const interest = await createBrbyteInterestFromReferral({
          referralId,
          actorUserId,
          sourceContext: "commercial_assisted",
        })
        return {
          ok: interest.ok,
          skipped: interest.skipped,
          message: interest.message,
        }
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
    referralId: result.referralId,
    indicatorName: result.indicatorName,
    referredName: result.referredName,
    responsibleName: result.responsibleName,
    commercialProfileId: result.commercialProfileId,
    leadUrl: `/comercial/leads/${result.referralId}`,
    replayed: result.replayed,
    controllr: result.controllr,
    message: result.replayed
      ? "Indicação já cadastrada (idempotente)."
      : "Indicação cadastrada com sucesso.",
  })
}
