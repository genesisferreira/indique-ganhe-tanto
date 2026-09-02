import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createBrbyteInterestFromReferral } from "@/lib/brbyte/create-interest.service"
import {
  COMMERCIAL_ASSISTED_CREATE_AUDIT_ENTITY,
} from "@/lib/commercial-assisted/constants"
import {
  createAssistedReferral,
  type AssistedReferralClientPayload,
} from "@/lib/commercial-assisted/create-assisted-referral"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

  const supabase = await createClient()
  const admin = await createAdminClient()

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
        const db = admin as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              eq: (c: string, v: string) => {
                maybeSingle: () => Promise<{ data: unknown }>
              }
            }
          }
        }
        const { data } = await db
          .from("profiles")
          .select("id, role, is_active, full_name")
          .eq("id", id)
          .maybeSingle()
        return (data as {
          id: string
          role: string
          is_active: boolean | null
          full_name: string | null
        } | null) ?? null
      },
      listPlanRows: async () => {
        const db = admin as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              order: (
                col: string,
                opts: { ascending: boolean }
              ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
            }
          }
        }
        const { data, error } = await db
          .from("plans")
          .select(
            "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
          )
          .order("sort_order", { ascending: true })
        if (error) return []
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
      insertReferral: async (row) => {
        const db = admin as unknown as {
          from: (t: string) => {
            insert: (values: Record<string, unknown>) => {
              select: (cols: string) => {
                maybeSingle: () => Promise<{
                  data: { id: string } | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
        const { data, error } = await db
          .from("referrals")
          .insert(row as unknown as Record<string, unknown>)
          .select("id")
          .maybeSingle()
        if (error || !data?.id) {
          console.error("[assisted-referral]", {
            step: "insert",
            message: error?.message ?? "no_id",
          })
          return { error: error?.message ?? "insert_failed" }
        }
        return { id: data.id }
      },
      insertReferralHistory: async ({
        referralId,
        actorProfileId,
        newStatus,
        metadata,
      }) => {
        const db = admin as unknown as {
          from: (t: string) => {
            insert: (values: Record<string, unknown>) => Promise<{
              error: { message: string } | null
            }>
          }
        }
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
        const db = supabase as unknown as {
          from: (t: string) => {
            insert: (values: Record<string, unknown>) => Promise<{
              error: { message: string } | null
            }>
          }
        }
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
    controllr: result.controllr,
    message: "Indicação cadastrada com sucesso.",
  })
}
