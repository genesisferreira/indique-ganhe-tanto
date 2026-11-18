"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { PipelineKanbanBoard } from "@/components/pipeline/pipeline-kanban-board"
import { PipelineMetricsBar } from "@/components/pipeline/pipeline-metrics-bar"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_ADMIN,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { loadPipelineBoardFromSupabase } from "@/lib/services/pipeline.service"
import { computePipelineMetrics, devLogPipeline } from "@/lib/commercial-pipeline"
import type { PipelineCard } from "@/lib/commercial-pipeline"
import { subscribeReferralDataMutated } from "@/lib/client/referral-data-sync"
import { PeriodFilter } from "@/components/period/period-filter"
import { parsePeriod } from "@/lib/period/range"

export default function AdminPipelinePage() {
  const searchParams = useSearchParams()
  const [cards, setCards] = useState<PipelineCard[]>([])
  const [reloadTick, setReloadTick] = useState(0)
  const period = parsePeriod(new URLSearchParams(searchParams.toString()))
  const fromIso = period.from?.toISOString() ?? null
  const toIso = period.to?.toISOString() ?? null
  const channel = searchParams.get("channel")

  const loadBoard = useCallback(async () => {
    const data = await loadPipelineBoardFromSupabase("admin", { from: fromIso, to: toIso, channel })
    if (!data.ok) {
      console.error("[pipeline:error]", data.error, data.meta)
      toast.error(
        data.error ||
          "Não foi possível carregar o pipeline. Veja o console."
      )
      setCards([])
      return
    }
    setCards(data.cards)
    devLogPipeline("admin board", {
      total: data.cards.length,
      byStage: data.meta,
    })
  }, [fromIso, toIso, channel])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard, reloadTick])

  useEffect(() => {
    return subscribeReferralDataMutated(() => {
      setReloadTick((t) => t + 1)
    })
  }, [])

  useRealtimeReload(
    () => setReloadTick((t) => t + 1),
    REALTIME_TABLES_ADMIN,
    { enabled: !isDataProviderMock(), logPrefix: "[pipeline:realtime]" }
  )

  const metrics = computePipelineMetrics(cards)

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title="Pipeline — Visão Admin"
        description={`Funil do período ${period.label}.`}
      />
      <PeriodFilter />
      <nav className="flex gap-2 overflow-x-auto" aria-label="Canal do pipeline">
        {[
          ["", "Todos"],
          ["direct", "Captação direta"],
          ["referral", "Todas as indicações"],
          ["indicator", "Indique e Ganhe"],
          ["partner_merchant", "Comércio parceiro"],
          ["employee_technician", "Técnico"],
          ["employee_external_sales", "Vendedor externo"],
        ].map(([value, label]) => {
          const next = new URLSearchParams(searchParams.toString())
          if (value) next.set("channel", value)
          else next.delete("channel")
          return (
            <a key={label} href={`/admin/pipeline?${next.toString()}`} className="rounded-md border px-3 py-1 text-sm whitespace-nowrap" aria-current={channel === value || (!channel && value === "") ? "page" : undefined}>
              {label}
            </a>
          )
        })}
      </nav>

      <PipelineMetricsBar metrics={metrics} showRanking />

      <p className="text-sm text-muted-foreground">O quadro rola para o lado. A página permanece no lugar.</p>
      <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-zinc-950 to-zinc-900/50 p-3 sm:p-4">
        <PipelineKanbanBoard
          cards={cards}
          onCardsChange={setCards}
          leadDetailHref={(id) => `/admin/indicacoes/${id}`}
          showCommercialName
        />
      </div>
    </div>
  )
}
