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

  const loadBoard = useCallback(async () => {
    const data = await loadPipelineBoardFromSupabase("admin", { from: fromIso, to: toIso })
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
  }, [fromIso, toIso])

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
    <div className="space-y-6 -mx-1 px-1">
      <PageHeader
        title="Pipeline — Visão Admin"
        description={`Funil do período ${period.label}.`}
      />
      <PeriodFilter />

      <PipelineMetricsBar metrics={metrics} showRanking />

      <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-zinc-950 to-zinc-900/50 p-3 sm:p-4">
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
