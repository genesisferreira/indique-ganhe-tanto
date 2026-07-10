/**
 * Resolução determinística dos dois planos públicos (500 Mega / 1 Giga).
 * Sem dependências de servidor — testável isoladamente.
 */

export type PlanCatalogRow = {
  id: string
  name: string
  speed_label: string | null
  is_active: boolean
}

export type PublicPlanSlotKey = "500" | "1000"

export type PublicPlanMatchMethod =
  | "env_id"
  | "exact_name"
  | "speed_label"
  | "alias"

export type PublicPlanSlotDefinition = {
  key: PublicPlanSlotKey
  displayName: string
  exactNames: readonly string[]
  speedLabels: readonly string[]
  aliases: readonly string[]
}

export type ResolvedPublicPlanSlot = {
  slotKey: PublicPlanSlotKey
  displayName: string
  row: PlanCatalogRow
  matchMethod: PublicPlanMatchMethod
}

export type ResolvePublicPlanSlotsInput = {
  rows: PlanCatalogRow[]
  plan500Id?: string | null
  plan1000Id?: string | null
}

export type ResolvePublicPlanSlotsResult =
  | { ok: true; slots: ResolvedPublicPlanSlot[] }
  | {
      ok: false
      error: "PUBLIC_PLAN_MAPPING_INCOMPLETE"
      missing: PublicPlanSlotKey[]
    }

export const PUBLIC_PLAN_SLOT_DEFINITIONS: readonly PublicPlanSlotDefinition[] = [
  {
    key: "500",
    displayName: "500 Mega",
    exactNames: ["500 mega"],
    speedLabels: ["500 mbps", "500mb", "500 mega"],
    aliases: ["500 mega", "500mb", "500 mbps", "500mega"],
  },
  {
    key: "1000",
    displayName: "1 Giga",
    exactNames: ["1 giga", "1000 mega", "1000mega", "mega 1000"],
    speedLabels: [
      "1 gbps",
      "1gbps",
      "1000 mbps",
      "1000mb",
      "1 giga",
      "1gb",
    ],
    aliases: [
      "1 giga",
      "1000 mega",
      "1000mega",
      "mega 1000",
      "1000 mbps",
      "1000mb",
      "1gb",
      "1 gbps",
      "1gbps",
      "tanto giga",
    ],
  },
] as const

export function normalizePlanText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
}

export function planHaystacks(
  name: string,
  speedLabel: string | null
): string[] {
  const n = normalizePlanText(name)
  const s = speedLabel ? normalizePlanText(speedLabel) : ""
  const combined = [n, s].filter(Boolean)
  if (n && s && n !== s) {
    combined.push(`${n} ${s}`)
  }
  return combined
}

function orderedRows(rows: PlanCatalogRow[]): PlanCatalogRow[] {
  const active = rows.filter((row) => row.is_active)
  const inactive = rows.filter((row) => !row.is_active)
  return [...active, ...inactive]
}

function textMatchesList(value: string, list: readonly string[]): boolean {
  if (!value) return false
  return list.some((item) => value === item || value.includes(item))
}

/** O nome do plano pertence claramente a este slot (não usa speed_label). */
export function rowNameBelongsToSlot(
  name: string,
  slot: PublicPlanSlotDefinition
): boolean {
  const n = normalizePlanText(name)
  if (!n) return false
  return slot.exactNames.some((exact) => n === exact || n.includes(exact))
}

export function rowReservedForOtherSlot(
  row: PlanCatalogRow,
  slotIndex: number,
  slots: readonly PublicPlanSlotDefinition[] = PUBLIC_PLAN_SLOT_DEFINITIONS
): boolean {
  for (let i = 0; i < slots.length; i++) {
    if (i === slotIndex) continue
    if (rowNameBelongsToSlot(row.name, slots[i])) {
      return true
    }
  }
  return false
}

export function matchesSlotByAlias(
  name: string,
  speedLabel: string | null,
  aliases: readonly string[]
): boolean {
  const haystacks = planHaystacks(name, speedLabel)
  return aliases.some((alias) =>
    haystacks.some((h) => h === alias || h.includes(alias))
  )
}

function resolveSlotByEnvId(
  slot: PublicPlanSlotDefinition,
  rows: PlanCatalogRow[],
  usedIds: Set<string>,
  envId: string
): ResolvedPublicPlanSlot | null {
  const row = rows.find((r) => r.id === envId && !usedIds.has(r.id))
  if (!row) return null
  return {
    slotKey: slot.key,
    displayName: slot.displayName,
    row,
    matchMethod: "env_id",
  }
}

function resolveSlotFromRows(
  slot: PublicPlanSlotDefinition,
  slotIndex: number,
  rows: PlanCatalogRow[],
  usedIds: Set<string>,
  slots: readonly PublicPlanSlotDefinition[]
): ResolvedPublicPlanSlot | null {
  const candidates = orderedRows(rows).filter((row) => !usedIds.has(row.id))

  for (const row of candidates) {
    if (rowReservedForOtherSlot(row, slotIndex, slots)) continue
    const n = normalizePlanText(row.name)
    if (slot.exactNames.some((exact) => n === exact)) {
      return {
        slotKey: slot.key,
        displayName: slot.displayName,
        row,
        matchMethod: "exact_name",
      }
    }
  }

  for (const row of candidates) {
    if (rowReservedForOtherSlot(row, slotIndex, slots)) continue
    if (rowNameBelongsToSlot(row.name, slots[1]) && slot.key === "500") {
      continue
    }
    const s = row.speed_label ? normalizePlanText(row.speed_label) : ""
    if (s && textMatchesList(s, slot.speedLabels)) {
      return {
        slotKey: slot.key,
        displayName: slot.displayName,
        row,
        matchMethod: "speed_label",
      }
    }
  }

  for (const row of candidates) {
    if (rowReservedForOtherSlot(row, slotIndex, slots)) continue
    if (rowNameBelongsToSlot(row.name, slots[1]) && slot.key === "500") {
      continue
    }
    const speedLabel =
      row.speed_label != null ? String(row.speed_label).trim() : null
    if (matchesSlotByAlias(row.name, speedLabel, slot.aliases)) {
      return {
        slotKey: slot.key,
        displayName: slot.displayName,
        row,
        matchMethod: "alias",
      }
    }
  }

  return null
}

function envIdForSlot(
  slotKey: PublicPlanSlotKey,
  input: ResolvePublicPlanSlotsInput
): string | null {
  const raw =
    slotKey === "500" ? input.plan500Id?.trim() : input.plan1000Id?.trim()
  return raw || null
}

export function resolvePublicPlanSlots(
  input: ResolvePublicPlanSlotsInput
): ResolvePublicPlanSlotsResult {
  const slots = PUBLIC_PLAN_SLOT_DEFINITIONS
  const usedIds = new Set<string>()
  const resolved: ResolvedPublicPlanSlot[] = []

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const slot = slots[slotIndex]
    const envId = envIdForSlot(slot.key, input)

    let match: ResolvedPublicPlanSlot | null = null

    if (envId) {
      match = resolveSlotByEnvId(slot, input.rows, usedIds, envId)
    } else {
      match = resolveSlotFromRows(slot, slotIndex, input.rows, usedIds, slots)
    }

    if (!match) {
      const missing: PublicPlanSlotKey[] = []
      for (let j = slotIndex; j < slots.length; j++) {
        missing.push(slots[j].key)
      }
      return {
        ok: false,
        error: "PUBLIC_PLAN_MAPPING_INCOMPLETE",
        missing,
      }
    }

    if (usedIds.has(match.row.id)) {
      return {
        ok: false,
        error: "PUBLIC_PLAN_MAPPING_INCOMPLETE",
        missing: [slot.key],
      }
    }

    usedIds.add(match.row.id)
    resolved.push(match)
  }

  return { ok: true, slots: resolved }
}

export function findSlotForPlanRow(
  row: PlanCatalogRow,
  input: ResolvePublicPlanSlotsInput
): PublicPlanSlotDefinition | null {
  const result = resolvePublicPlanSlots(input)
  if (!result.ok) return null
  const hit = result.slots.find((s) => s.row.id === row.id)
  if (!hit) return null
  return PUBLIC_PLAN_SLOT_DEFINITIONS.find((d) => d.key === hit.slotKey) ?? null
}
