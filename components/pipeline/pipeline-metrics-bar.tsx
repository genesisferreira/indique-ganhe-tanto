"use client"

import { TrendingUp, Clock, Trophy, XCircle, Users } from "lucide-react"
import type { PipelineMetrics } from "@/lib/commercial-pipeline"

type PipelineMetricsBarProps = {
  metrics: PipelineMetrics
  showRanking?: boolean
}

export function PipelineMetricsBar({
  metrics,
  showRanking = false,
}: PipelineMetricsBarProps) {
  const items = [
    {
      label: "Leads no pipeline",
      value: String(metrics.totalLeads),
      icon: Users,
      color: "text-sky-400",
    },
    {
      label: "Taxa conversão",
      value: `${metrics.conversionRate}%`,
      icon: TrendingUp,
      color: "text-emerald-400",
    },
    {
      label: "Tempo médio etapa",
      value: `${metrics.avgStageMinutes} min`,
      icon: Clock,
      color: "text-amber-400",
    },
    {
      label: "Ganhos",
      value: String(metrics.wonCount),
      icon: Trophy,
      color: "text-emerald-400",
    },
    {
      label: "Perdidos",
      value: String(metrics.lostCount),
      icon: XCircle,
      color: "text-rose-400",
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-white/5 bg-zinc-950/60 px-4 py-3 backdrop-blur"
          >
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <item.icon className={cnIcon(item.color)} />
              {item.label}
            </div>
            <p className={cnValue(item.color)}>{item.value}</p>
          </div>
        ))}
      </div>

      {showRanking && metrics.commercialRanking.length > 0 ? (
        <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-200 mb-3">
            Ranking comercial
          </h3>
          <div className="space-y-2">
            {metrics.commercialRanking.slice(0, 5).map((row, i) => (
              <div
                key={row.commercialId}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-zinc-300">
                  <span className="text-zinc-500 mr-2">#{i + 1}</span>
                  {row.commercialNome}
                </span>
                <span className="text-emerald-400 font-medium">
                  {row.wonCount} ganhos · {row.conversionRate}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function cnIcon(color: string) {
  return `h-3.5 w-3.5 ${color}`
}

function cnValue(color: string) {
  return `mt-1 text-xl font-semibold ${color}`
}
