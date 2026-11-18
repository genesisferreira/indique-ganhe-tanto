"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { StatCard } from "@/components/ui/stat-card"
import { channelLabel } from "@/lib/channels/classification"

type Summary = {
  label: string
  total: number
  direct: number
  referral: number
  unclassified: number
  byKind: Record<string, number>
  directAttendance: number
  directApproved: number
  directRejected: number
  referralAttendance: number
  referralApproved: number
  referralRejected: number
  directRate: number
  referralRate: number
  totalRate: number
  costLabel: string
  rewardLabel: string
}

export function ChannelSummary({ mode }: { mode: "general" | "direct" | "referral" | "report" }) {
  const searchParams = useSearchParams()
  const [summary, setSummary] = useState<Summary | null>(null)
  const query = searchParams.toString()

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/admin/channels?${query}`, { signal: controller.signal, cache: "no-store", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((body: (Summary & { ok?: boolean }) | null) => {
        if (body?.ok) setSummary(body)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [query])

  if (!summary) return <p className="text-sm text-muted-foreground">Carregando canais do período…</p>
  const directKinds = Object.entries(summary.byKind).filter(([kind, count]) => kind.startsWith("direct_") && count > 0)
  const referralKinds = ["indicator", "partner_merchant", "employee_technician", "employee_external_sales"]
  return (
    <section className="space-y-3" aria-label="Resumo por canal de aquisição">
      {mode === "general" || mode === "report" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Oportunidades no período" value={summary.total} subtitle={summary.label} />
          <StatCard title="Captações diretas" value={summary.direct} subtitle={`${summary.directRate}% convertidas`} />
          <StatCard title="Indicações" value={summary.referral} subtitle={`${summary.referralRate}% convertidas`} />
          <StatCard title="Taxa geral" value={`${summary.totalRate}%`} subtitle={`${summary.unclassified} sem classificação`} />
        </div>
      ) : null}
      {mode === "direct" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Captações no período" value={summary.direct} subtitle={summary.label} />
          <StatCard title="Em atendimento" value={summary.directAttendance} />
          <StatCard title="Aprovadas" value={summary.directApproved} />
          <StatCard title="Recusadas" value={summary.directRejected} subtitle={`Conversão ${summary.directRate}%`} />
        </div>
      ) : null}
      {mode === "referral" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Indicações no período" value={summary.referral} subtitle={summary.label} />
          <StatCard title="Em atendimento" value={summary.referralAttendance} />
          <StatCard title="Aprovadas" value={summary.referralApproved} />
          <StatCard title="Recusadas" value={summary.referralRejected} subtitle={`Conversão ${summary.referralRate}%`} />
        </div>
      ) : null}
      {mode === "referral" || mode === "report" ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {referralKinds.map((kind) => (
            <p key={kind} className="rounded-lg border px-3 py-2 text-sm">{channelLabel(kind)}: {summary.byKind[kind] ?? 0}</p>
          ))}
        </div>
      ) : null}
      {mode === "direct" || mode === "report" ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(directKinds.length > 0 ? directKinds : [["direct_preregistration", summary.direct] as [string, number]]).map(([kind, count]) => (
            <p key={kind} className="rounded-lg border px-3 py-2 text-sm">{channelLabel(kind)}: {count}</p>
          ))}
        </div>
      ) : null}
      {mode === "report" ? (
        <p className="text-sm text-muted-foreground">{summary.costLabel}. {summary.rewardLabel}</p>
      ) : null}
      {summary.total === 0 ? <p className="text-sm text-muted-foreground">Nenhuma oportunidade neste período.</p> : null}
    </section>
  )
}
