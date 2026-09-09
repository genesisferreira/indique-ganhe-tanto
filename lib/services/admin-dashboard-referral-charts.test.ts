/**
 * Testes — hotfix admin dashboard null indicator (PostgREST 22P02).
 *
 * Reproduz:
 * - referral com indicator_profile_id = null + UUID válido
 * - todas null
 * - zero referrals
 *
 * Garante que null nunca entra em profiles.in("id", …).
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  aggregateAdminDashboardReferralCharts,
  isValidIndicatorProfileId,
  sanitizeIndicatorIdsForProfilesIn,
  type AdminDashboardReferralChartRow,
} from "./admin-dashboard-referral-charts"

const INDICATOR_A = "11111111-1111-4111-8111-111111111111"
const INDICATOR_B = "22222222-2222-4222-8222-222222222222"

/** Data fixa no mês corrente para monthlyData previsível. */
function rowInCurrentMonth(
  partial: Omit<AdminDashboardReferralChartRow, "created_at"> & {
    created_at?: string
  }
): AdminDashboardReferralChartRow {
  const now = new Date()
  const created_at =
    partial.created_at ??
    new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0).toISOString()
  return {
    created_at,
    status: partial.status,
    indicator_profile_id: partial.indicator_profile_id,
  }
}

describe("isValidIndicatorProfileId", () => {
  it("aceita UUID string não-vazio", () => {
    assert.equal(isValidIndicatorProfileId(INDICATOR_A), true)
  })

  it("rejeita null, undefined e string vazia", () => {
    assert.equal(isValidIndicatorProfileId(null), false)
    assert.equal(isValidIndicatorProfileId(undefined), false)
    assert.equal(isValidIndicatorProfileId(""), false)
  })
})

describe("sanitizeIndicatorIdsForProfilesIn — defesa PostgREST 22P02", () => {
  it("remove null/undefined/vazio antes do .in", () => {
    const cleaned = sanitizeIndicatorIdsForProfilesIn([
      INDICATOR_A,
      null,
      undefined,
      "",
      INDICATOR_B,
    ])
    assert.deepEqual(cleaned, [INDICATOR_A, INDICATOR_B])
    assert.equal(cleaned.includes(null as unknown as string), false)
    assert.equal(
      cleaned.some((id) => id === "null" || String(id) === "null"),
      false
    )
  })

  it("array vazio permanece vazio (não inventa IDs)", () => {
    assert.deepEqual(sanitizeIndicatorIdsForProfilesIn([]), [])
  })
})

describe("aggregateAdminDashboardReferralCharts — hotfix null indicator", () => {
  it("1) null + UUID: null NÃO entra em indicatorIds; UUID entra; mês conta ambos", () => {
    const rows: AdminDashboardReferralChartRow[] = [
      rowInCurrentMonth({
        status: "pendente",
        indicator_profile_id: null,
      }),
      rowInCurrentMonth({
        status: "aprovada",
        indicator_profile_id: INDICATOR_A,
      }),
    ]

    const { monthlyData, indicatorAgg, indicatorIds } =
      aggregateAdminDashboardReferralCharts(rows)

    assert.equal(indicatorIds.includes(null as unknown as string), false)
    assert.equal(
      indicatorIds.some((id) => id == null || String(id) === "null"),
      false,
      "profiles.in nunca deve receber null serializado como 'null'"
    )
    assert.deepEqual(indicatorIds, [INDICATOR_A])
    assert.equal(indicatorAgg.has(INDICATOR_A), true)
    assert.equal(indicatorAgg.get(INDICATOR_A)?.total, 1)
    assert.equal(indicatorAgg.get(INDICATOR_A)?.conversoes, 1)

    const monthTotal = monthlyData.reduce((s, m) => s + m.indicacoes, 0)
    const monthConv = monthlyData.reduce((s, m) => s + m.conversoes, 0)
    assert.equal(monthTotal, 2, "referral sem indicador conta nas métricas gerais/mês")
    assert.equal(monthConv, 1)
  })

  it("2) todos null: indicatorIds vazio; sem query .in necessária; mês conta referrals", () => {
    const rows: AdminDashboardReferralChartRow[] = [
      rowInCurrentMonth({ status: "pendente", indicator_profile_id: null }),
      rowInCurrentMonth({ status: "aprovada", indicator_profile_id: null }),
      rowInCurrentMonth({ status: "em_atendimento", indicator_profile_id: null }),
    ]

    const { monthlyData, indicatorAgg, indicatorIds } =
      aggregateAdminDashboardReferralCharts(rows)

    assert.deepEqual(indicatorIds, [])
    assert.equal(indicatorAgg.size, 0)
    assert.equal(
      indicatorIds.length > 0,
      false,
      "com zero IDs válidos, profiles.in NÃO deve ser chamado pelo caller"
    )

    const monthTotal = monthlyData.reduce((s, m) => s + m.indicacoes, 0)
    assert.equal(monthTotal, 3)
    assert.equal(
      monthlyData.reduce((s, m) => s + m.conversoes, 0),
      1
    )
  })

  it("3) zero referrals: agregação vazia, sem erro", () => {
    const { monthlyData, indicatorAgg, indicatorIds } =
      aggregateAdminDashboardReferralCharts([])

    assert.deepEqual(indicatorIds, [])
    assert.equal(indicatorAgg.size, 0)
    assert.equal(monthlyData.length, 6)
    assert.ok(monthlyData.every((m) => m.indicacoes === 0 && m.conversoes === 0))
  })

  it("4) ranking só com indicadores reais; pré-cadastro não vira placeholder", () => {
    const rows: AdminDashboardReferralChartRow[] = [
      rowInCurrentMonth({ status: "aprovada", indicator_profile_id: null }),
      rowInCurrentMonth({ status: "aprovada", indicator_profile_id: INDICATOR_A }),
      rowInCurrentMonth({ status: "pendente", indicator_profile_id: INDICATOR_A }),
      rowInCurrentMonth({ status: "aprovada", indicator_profile_id: INDICATOR_B }),
    ]

    const { indicatorAgg, indicatorIds } =
      aggregateAdminDashboardReferralCharts(rows)

    assert.deepEqual([...indicatorIds].sort(), [INDICATOR_A, INDICATOR_B].sort())
    assert.equal(indicatorAgg.get(INDICATOR_A)?.total, 2)
    assert.equal(indicatorAgg.get(INDICATOR_A)?.conversoes, 1)
    assert.equal(indicatorAgg.get(INDICATOR_B)?.total, 1)
    assert.equal(indicatorAgg.get(INDICATOR_B)?.conversoes, 1)
    assert.equal(indicatorAgg.size, 2)
  })

  it("5) REGRESSÃO: chave null nunca aparece no Map nem em indicatorIds", () => {
    const rows: AdminDashboardReferralChartRow[] = [
      rowInCurrentMonth({ status: "pendente", indicator_profile_id: null }),
      rowInCurrentMonth({
        status: "pendente",
        indicator_profile_id: null as unknown as string,
      }),
    ]

    const { indicatorAgg, indicatorIds } =
      aggregateAdminDashboardReferralCharts(rows)

    for (const key of indicatorAgg.keys()) {
      assert.notEqual(key, null)
      assert.notEqual(String(key), "null")
      assert.ok(typeof key === "string" && key.length > 0)
    }
    for (const id of indicatorIds) {
      assert.notEqual(id, null)
      assert.notEqual(String(id), "null")
    }
    assert.deepEqual(
      sanitizeIndicatorIdsForProfilesIn(indicatorIds),
      indicatorIds
    )
  })
})
