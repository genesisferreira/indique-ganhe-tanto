import "server-only"

import { resolveBrbytePlanPkForReferral } from "@/lib/brbyte/plan-mapping"
import { getBrbyteCreateInterestConfigForIntegration } from "@/lib/brbyte/config"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  PUBLIC_PRE_REGISTRATION_ALLOWED_PLAN_NAMES,
  isPublicPreRegistrationEnabled,
} from "@/lib/public-pre-registration/config"

type PlanCatalogRow = {
  id: string
  name: string
  speed_label: string | null
  is_active: boolean
}

type LoosePlansDb = {
  from: (table: "plans") => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{
          data: PlanCatalogRow[] | null
          error: { message: string } | null
        }>
        maybeSingle: () => Promise<{
          data: PlanCatalogRow | null
          error: { message: string } | null
        }>
      }
    }
  }
}

function getPlansDb(): LoosePlansDb {
  return createServiceRoleClient() as unknown as LoosePlansDb
}

export type PublicPreRegistrationPlanOption = {
  id: string
  name: string
  speedLabel: string | null
  brbyteMapped: boolean
}

function normalizePlanName(name: string): string {
  return name.trim().toLowerCase()
}

function isAllowedPublicPlan(name: string, speedLabel: string | null): boolean {
  const n = normalizePlanName(name)
  const s = speedLabel ? normalizePlanName(speedLabel) : ""
  return PUBLIC_PRE_REGISTRATION_ALLOWED_PLAN_NAMES.some(
    (allowed) => n === allowed || s === allowed || n.includes(allowed)
  )
}

export async function loadPublicPreRegistrationPlans(): Promise<
  PublicPreRegistrationPlanOption[]
> {
  if (!isPublicPreRegistrationEnabled()) return []

  const supabase = getPlansDb()
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, speed_label, is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })

  if (error || !data) return []

  const config = getBrbyteCreateInterestConfigForIntegration()
  const options: PublicPreRegistrationPlanOption[] = []

  for (const row of data) {
    const name = String(row.name ?? "").trim()
    const speedLabel =
      row.speed_label != null ? String(row.speed_label).trim() : null
    if (!isAllowedPublicPlan(name, speedLabel)) continue

    const resolution = await resolveBrbytePlanPkForReferral(
      {
        planId: row.id,
        planCode: speedLabel,
        planName: name,
      },
      config ?? undefined
    )

    options.push({
      id: row.id,
      name,
      speedLabel,
      brbyteMapped: resolution.ok,
    })
  }

  return options
}

export async function resolvePublicPreRegistrationPlan(planId: string): Promise<
  | {
      ok: true
      planId: string
      planName: string
      planCode: string | null
      brbytePlanPk: string
    }
  | { ok: false; message: string }
> {
  const supabase = getPlansDb()
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, speed_label, is_active")
    .eq("id", planId)
    .maybeSingle()

  if (error || !data || !data.is_active) {
    return { ok: false, message: "Plano inválido ou indisponível." }
  }

  const name = String(data.name ?? "").trim()
  const speedLabel =
    data.speed_label != null ? String(data.speed_label).trim() : null

  if (!isAllowedPublicPlan(name, speedLabel)) {
    return { ok: false, message: "Plano não disponível para pré-cadastro." }
  }

  const config = getBrbyteCreateInterestConfigForIntegration()
  const resolution = await resolveBrbytePlanPkForReferral(
    {
      planId: data.id,
      planCode: speedLabel,
      planName: name,
    },
    config ?? undefined
  )

  if (!resolution.ok) {
    return { ok: false, message: resolution.message }
  }

  return {
    ok: true,
    planId: data.id,
    planName: name,
    planCode: speedLabel,
    brbytePlanPk: resolution.planPk,
  }
}
