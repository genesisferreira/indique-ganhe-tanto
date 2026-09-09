/**
 * Agregação de gráficos/top indicadores do dashboard admin.
 *
 * Pré-cadastro público pode deixar referrals.indicator_profile_id = NULL.
 * Esses registros DEVEM continuar nas métricas mensais gerais, mas NÃO
 * podem entrar em indicatorAgg / .in("id", …) — o postgrest-js serializa
 * null como a string "null" e o PostgREST responde 22P02 em colunas UUID.
 */

export type AdminDashboardReferralChartRow = {
  created_at: string
  status: string
  indicator_profile_id: string | null
}

export type AdminDashboardIndicatorAgg = {
  total: number
  conversoes: number
}

export type AdminDashboardMonthlyPoint = {
  mes: string
  indicacoes: number
  conversoes: number
}

function buildLastSixMonthLabels(now: Date): Array<{ key: string; mes: string }> {
  return Array.from({ length: 6 }).map((_, index) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      mes: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
    }
  })
}

/**
 * True somente para UUID não-vazio. Exclui null/undefined/"" — nunca
 * deve ser enviado a profiles.in("id", …).
 */
export function isValidIndicatorProfileId(
  id: string | null | undefined
): id is string {
  return typeof id === "string" && id.length > 0
}

/**
 * Agrega referrals para monthlyData + ranking por indicador.
 * Referrals sem indicator_profile_id contam no mês, mas não no ranking.
 */
export function aggregateAdminDashboardReferralCharts(
  referralRows: AdminDashboardReferralChartRow[],
  now: Date = new Date()
): {
  monthlyData: AdminDashboardMonthlyPoint[]
  indicatorAgg: Map<string, AdminDashboardIndicatorAgg>
  /** Somente UUIDs válidos — seguro para .in("id", indicatorIds). */
  indicatorIds: string[]
} {
  const monthLabels = buildLastSixMonthLabels(now)
  const monthlyAccumulator = new Map(
    monthLabels.map((m) => [m.key, { mes: m.mes, indicacoes: 0, conversoes: 0 }])
  )

  const indicatorAgg = new Map<string, AdminDashboardIndicatorAgg>()

  for (const row of referralRows) {
    const created = new Date(row.created_at)
    const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`
    const monthEntry = monthlyAccumulator.get(monthKey)
    if (monthEntry) {
      monthEntry.indicacoes += 1
      if (row.status === "aprovada") {
        monthEntry.conversoes += 1
      }
    }

    // Correção 22P02: não agregar chave null no Map / .in("id", …)
    if (!isValidIndicatorProfileId(row.indicator_profile_id)) {
      continue
    }

    const indicatorId = row.indicator_profile_id
    const current = indicatorAgg.get(indicatorId) ?? { total: 0, conversoes: 0 }
    current.total += 1
    if (row.status === "aprovada") {
      current.conversoes += 1
    }
    indicatorAgg.set(indicatorId, current)
  }

  const monthlyData = monthLabels.map(
    (m) => monthlyAccumulator.get(m.key) ?? { mes: m.mes, indicacoes: 0, conversoes: 0 }
  )

  const indicatorIds = [...indicatorAgg.keys()]

  return { monthlyData, indicatorAgg, indicatorIds }
}

/**
 * Proteção defensiva: remove qualquer valor inválido antes de .in("id", …).
 * Com o guard na agregação, normalmente é no-op.
 */
export function sanitizeIndicatorIdsForProfilesIn(
  indicatorIds: readonly (string | null | undefined)[]
): string[] {
  return indicatorIds.filter(isValidIndicatorProfileId)
}
