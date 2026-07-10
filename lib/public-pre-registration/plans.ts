import "server-only"

import { resolveBrbytePlanPkForReferral } from "@/lib/brbyte/plan-mapping"
import { getBrbyteCreateInterestConfigForIntegration } from "@/lib/brbyte/config"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  getPublicPreRegistrationPlan1000Id,
  getPublicPreRegistrationPlan500Id,
  isPublicPreRegistrationEnabled,
} from "@/lib/public-pre-registration/config"
import {
  resolvePublicPlanSlots,
  type PlanCatalogRow,
} from "@/lib/public-pre-registration/plan-resolver"

type LoosePlansDb = {
  from: (table: "plans") => {
    select: (cols: string) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => Promise<{
        data: PlanCatalogRow[] | null
        error: { message: string } | null
      }>
      eq: (
        col: string,
        val: unknown
      ) => {
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

export type LoadPublicPreRegistrationPlansResult =
  | { ok: true; plans: PublicPreRegistrationPlanOption[] }
  | { ok: false; error: "PUBLIC_PLAN_MAPPING_INCOMPLETE" }

function logRawPlans(rows: PlanCatalogRow[]): void {
  console.info("[public-plans:raw]", {
    count: rows.length,
    plans: rows.map((row) => ({
      id: row.id,
      name: row.name,
      speed_label: row.speed_label,
      is_active: row.is_active,
    })),
  })
}

async function fetchAllPlanRows(): Promise<PlanCatalogRow[]> {
  const supabase = getPlansDb()
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, speed_label, is_active")
    .order("sort_order", { ascending: true })

  if (error) {
    console.error("[public-plans:raw]", { error: error.message })
    return []
  }

  return data ?? []
}

export async function loadPublicPreRegistrationPlans(): Promise<LoadPublicPreRegistrationPlansResult> {
  if (!isPublicPreRegistrationEnabled()) {
    return { ok: false, error: "PUBLIC_PLAN_MAPPING_INCOMPLETE" }
  }

  const rows = await fetchAllPlanRows()
  logRawPlans(rows)

  const resolution = resolvePublicPlanSlots({
    rows,
    plan500Id: getPublicPreRegistrationPlan500Id(),
    plan1000Id: getPublicPreRegistrationPlan1000Id(),
  })

  if (!resolution.ok) {
    console.info("[public-plans:matched]", {
      ok: false,
      error: resolution.error,
      missing: resolution.missing,
    })
    console.info("[public-plans:final]", { ok: false, plans: [] })
    return { ok: false, error: "PUBLIC_PLAN_MAPPING_INCOMPLETE" }
  }

  console.info(
    "[public-plans:matched]",
    resolution.slots.map((slot) => ({
      slot: slot.displayName,
      id: slot.row.id,
      name: slot.row.name,
      speed_label: slot.row.speed_label,
      is_active: slot.row.is_active,
      matchMethod: slot.matchMethod,
    }))
  )

  const config = getBrbyteCreateInterestConfigForIntegration()
  const options: PublicPreRegistrationPlanOption[] = []

  for (const slot of resolution.slots) {
    const speedLabel =
      slot.row.speed_label != null ? String(slot.row.speed_label).trim() : null

    const brbyteResolution = await resolveBrbytePlanPkForReferral(
      {
        planId: slot.row.id,
        planCode: speedLabel,
        planName: String(slot.row.name ?? "").trim(),
      },
      config ?? undefined
    )

    options.push({
      id: slot.row.id,
      name: slot.displayName,
      speedLabel,
      brbyteMapped: brbyteResolution.ok,
    })
  }

  console.info(
    "[public-plans:final]",
    options.map((plan) => ({
      id: plan.id,
      name: plan.name,
      speedLabel: plan.speedLabel,
      brbyteMapped: plan.brbyteMapped,
    }))
  )

  return { ok: true, plans: options }
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

  if (error || !data) {
    return { ok: false, message: "Plano inválido ou indisponível." }
  }

  const row = data as PlanCatalogRow
  const allRows = await fetchAllPlanRows()
  const resolution = resolvePublicPlanSlots({
    rows: allRows,
    plan500Id: getPublicPreRegistrationPlan500Id(),
    plan1000Id: getPublicPreRegistrationPlan1000Id(),
  })

  if (!resolution.ok) {
    return { ok: false, message: "Plano não disponível para pré-cadastro." }
  }

  const slot = resolution.slots.find((s) => s.row.id === row.id)
  if (!slot) {
    return { ok: false, message: "Plano não disponível para pré-cadastro." }
  }

  const speedLabel =
    row.speed_label != null ? String(row.speed_label).trim() : null

  const config = getBrbyteCreateInterestConfigForIntegration()
  const brbyteResolution = await resolveBrbytePlanPkForReferral(
    {
      planId: row.id,
      planCode: speedLabel,
      planName: String(row.name ?? "").trim(),
    },
    config ?? undefined
  )

  if (!brbyteResolution.ok) {
    return { ok: false, message: brbyteResolution.message }
  }

  return {
    ok: true,
    planId: row.id,
    planName: slot.displayName,
    planCode: speedLabel,
    brbytePlanPk: brbyteResolution.planPk,
  }
}
