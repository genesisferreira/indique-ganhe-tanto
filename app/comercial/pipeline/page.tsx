"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { PipelineKanbanBoard } from "@/components/pipeline/pipeline-kanban-board"
import { PipelineMetricsBar } from "@/components/pipeline/pipeline-metrics-bar"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_COMERCIAL,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { loadPipelineBoardFromSupabase } from "@/lib/services/pipeline.service"
import { computePipelineMetrics, devLogPipeline } from "@/lib/commercial-pipeline"
import type { PipelineCard } from "@/lib/commercial-pipeline"
import { subscribeReferralDataMutated } from "@/lib/client/referral-data-sync"

export default function ComercialPipelinePage() {
  const [cards, setCards] = useState<PipelineCard[]>([])
  const [reloadTick, setReloadTick] = useState(0)

  const loadBoard = useCallback(async () => {
    const data = await loadPipelineBoardFromSupabase("comercial")
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
    devLogPipeline("comercial board", {
      total: data.cards.length,
      byStage: data.meta,
    })
  }, [])

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
    REALTIME_TABLES_COMERCIAL,
    { enabled: !isDataProviderMock(), logPrefix: "[pipeline:realtime]" }
  )

  const metrics = computePipelineMetrics(cards)

  return (
    <div className="space-y-6 -mx-1 px-1">
      <PageHeader
        title="Pipeline Comercial"
        description="Arraste os cards entre etapas — atualização em tempo real"
      />

      <PipelineMetricsBar metrics={metrics} />

      <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-zinc-950 to-zinc-900/50 p-3 sm:p-4">
        <PipelineKanbanBoard
          cards={cards}
          onCardsChange={setCards}
          leadDetailHref={(id) => `/comercial/leads/${id}`}
        />
      </div>
    </div>
  )
}
