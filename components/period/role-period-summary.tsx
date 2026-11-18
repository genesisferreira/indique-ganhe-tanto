"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { PeriodFilter } from "@/components/period/period-filter"
import { StatCard } from "@/components/ui/stat-card"
import { currentMonthKey } from "@/lib/period/range"

type SelfPeriod = {
  ok?: boolean
  periodLabel?: string
  totalReferrals?: number
  pendingReferrals?: number
  approvedReferrals?: number
  rejectedReferrals?: number
  paidValue?: number
  currentBalance?: number
  currentBalanceLabel?: string
}

export function RolePeriodSummary() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<SelfPeriod | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (!params.get("month") && !params.get("period") && !params.get("from")) params.set("month", currentMonthKey())
    void fetch(`/api/me/period?${params.toString()}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return
        const body = await response.json() as SelfPeriod
        if (body.ok) setData(body)
      })
  }, [searchParams])

  if (!data) return <PeriodFilter />

  return (
    <div className="space-y-4">
      <PeriodFilter />
      <p className="text-sm text-muted-foreground">Período: {data.periodLabel}. O saldo atual não usa este filtro.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Indicações no período" value={data.totalReferrals ?? 0} />
        <StatCard title="Conversões no período" value={data.approvedReferrals ?? 0} />
        <StatCard title="Pendentes no período" value={data.pendingReferrals ?? 0} />
        <StatCard title={data.currentBalanceLabel ?? "Saldo atual"} value={`R$ ${Number(data.currentBalance ?? 0).toLocaleString("pt-BR")}`} subtitle="Acumulado" />
      </div>
    </div>
  )
}
