import "server-only"

import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export type BrbytePlanResolutionInput = {
  planId?: string | null
  planCode?: string | null
  planName?: string | null
}

export type BrbytePlanResolutionSource =
  | "crm_plan_id"
  | "crm_plan_code"
  | "crm_plan_name"
  | "env_default"

export type BrbytePlanResolutionResult =
  | {
      ok: true
      planPk: string
      source: BrbytePlanResolutionSource
    }
  | {
      ok: false
      message: string
    }

type PlanMappingRow = {
  brbyte_plan_pk: string
}

type PlanMappingDb = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        eq: (
          col2: string,
          val2: boolean
        ) => {
          maybeSingle: () => Promise<{
            data: PlanMappingRow | null
            error: { message: string } | null
          }>
        }
      }
    }
  }
}

function getDb(): PlanMappingDb {
  return createServiceRoleClient() as unknown as PlanMappingDb
}

async function findActiveMapping(
  column: "crm_plan_id" | "crm_plan_code" | "crm_plan_name",
  value: string
): Promise<string | null> {
  const trimmed = value.trim()
  if (!trimmed) return null

  const { data, error } = await getDb()
    .from("brbyte_plan_mappings")
    .select("brbyte_plan_pk")
    .eq(column, trimmed)
    .eq("is_active", true)
    .maybeSingle()

  if (error) {
    console.warn("[brbyte:plan-mapping]", { column, message: error.message })
    return null
  }

  const pk = data?.brbyte_plan_pk?.trim()
  return pk || null
}

/**
 * Resolve plan_pk do Controllr para uma indicação/plano do CRM.
 * Ordem: crm_plan_id → crm_plan_code → crm_plan_name → BRBYTE_DEFAULT_PLAN_PK.
 */
export async function resolveBrbytePlanPkForReferral(
  input: BrbytePlanResolutionInput,
  config?: Pick<BrbyteCreateInterestConfig, "defaultPlanPk"> | null
): Promise<BrbytePlanResolutionResult> {
  const planId = input.planId?.trim() ?? ""
  const planCode = input.planCode?.trim() ?? ""
  const planName = input.planName?.trim() ?? ""

  if (planId) {
    const byId = await findActiveMapping("crm_plan_id", planId)
    if (byId) {
      return { ok: true, planPk: byId, source: "crm_plan_id" }
    }
  }

  if (planCode) {
    const byCode = await findActiveMapping("crm_plan_code", planCode)
    if (byCode) {
      return { ok: true, planPk: byCode, source: "crm_plan_code" }
    }
  }

  if (planName) {
    const byName = await findActiveMapping("crm_plan_name", planName)
    if (byName) {
      return { ok: true, planPk: byName, source: "crm_plan_name" }
    }
  }

  const fallback = config?.defaultPlanPk?.trim() ?? ""
  if (fallback) {
    return { ok: true, planPk: fallback, source: "env_default" }
  }

  return {
    ok: false,
    message: "Plano sem mapeamento BRByte",
  }
}
