import "server-only"

import { resolveBrbytePlanPkForReferral } from "@/lib/brbyte/plan-mapping"
import { getBrbyteCreateInterestConfigForIntegration } from "@/lib/brbyte/config"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { isPublicPreRegistrationEnabled } from "@/lib/public-pre-registration/config"

type PlanCatalogRow = {
  id: string
  name: string
  speed_label: string | null
  is_active: boolean
}

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

/** Slots fixos exibidos no pré-cadastro — ordem preservada. */
const PUBLIC_PLAN_SLOTS = [
  {
    displayName: "500 Mega",
    aliases: ["500 mega", "500mb", "500 mbps", "500mega"],
  },
  {
    displayName: "1 Giga",
    aliases: [
      "1 giga",
      "1000 mega",
      "1000mega",
      "1000 mbps",
      "1000mb",
      "1gb",
      "1 gbps",
      "1gbps",
      "tanto giga",
    ],
  },
] as const

function normalizePlanName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
}

function planHaystacks(name: string, speedLabel: string | null): string[] {
  const n = normalizePlanName(name)
  const s = speedLabel ? normalizePlanName(speedLabel) : ""
  const combined = [n, s].filter(Boolean)
  if (n && s && n !== s) {
    combined.push(`${n} ${s}`)
  }
  return combined
}

export function matchesPublicPreRegistrationPlanSlot(
  name: string,
  speedLabel: string | null,
  aliases: readonly string[]
): boolean {
  const haystacks = planHaystacks(name, speedLabel)
  return aliases.some((alias) =>
    haystacks.some((h) => h === alias || h.includes(alias))
  )
}

function findPlanRowForSlot(
  rows: PlanCatalogRow[],
  usedIds: Set<string>,
  aliases: readonly string[]
): PlanCatalogRow | null {
  const active = rows.filter(
    (row) => row.is_active && !usedIds.has(row.id)
  )
  const inactive = rows.filter(
    (row) => !row.is_active && !usedIds.has(row.id)
  )

  for (const pool of [active, inactive]) {
    for (const row of pool) {
      const name = String(row.name ?? "").trim()
      const speedLabel =
        row.speed_label != null ? String(row.speed_label).trim() : null
      if (matchesPublicPreRegistrationPlanSlot(name, speedLabel, aliases)) {
        return row
      }
    }
  }

  return null
}

export async function loadPublicPreRegistrationPlans(): Promise<
  PublicPreRegistrationPlanOption[]
> {
  if (!isPublicPreRegistrationEnabled()) return []

  const supabase = getPlansDb()
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, speed_label, is_active")
    .order("sort_order", { ascending: true })

  if (error || !data) return []

  const config = getBrbyteCreateInterestConfigForIntegration()
  const options: PublicPreRegistrationPlanOption[] = []
  const usedIds = new Set<string>()

  for (const slot of PUBLIC_PLAN_SLOTS) {
    const row = findPlanRowForSlot(data, usedIds, slot.aliases)
    if (!row) continue

    usedIds.add(row.id)
    const speedLabel =
      row.speed_label != null ? String(row.speed_label).trim() : null

    const resolution = await resolveBrbytePlanPkForReferral(
      {
        planId: row.id,
        planCode: speedLabel,
        planName: String(row.name ?? "").trim(),
      },
      config ?? undefined
    )

    options.push({
      id: row.id,
      name: slot.displayName,
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

  if (error || !data) {
    return { ok: false, message: "Plano inválido ou indisponível." }
  }

  const name = String(data.name ?? "").trim()
  const speedLabel =
    data.speed_label != null ? String(data.speed_label).trim() : null

  const slot = PUBLIC_PLAN_SLOTS.find((s) =>
    matchesPublicPreRegistrationPlanSlot(name, speedLabel, s.aliases)
  )

  if (!slot) {
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
    planName: slot.displayName,
    planCode: speedLabel,
    brbytePlanPk: resolution.planPk,
  }
}
