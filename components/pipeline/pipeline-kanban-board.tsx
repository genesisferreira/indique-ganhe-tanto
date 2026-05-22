"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Phone, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  PIPELINE_STAGE_CONFIG,
  type PipelineCard,
  type PipelineStage,
} from "@/lib/commercial-pipeline"
import { CommercialSlaOverdueBadge } from "@/components/commercial/commercial-sla-overdue-badge"
import { CommercialRedistributedBadge } from "@/components/commercial/commercial-redistributed-badge"
import { emitReferralDataMutated } from "@/lib/client/referral-data-sync"
import { moveReferralPipelineStageFromSupabase } from "@/lib/services/pipeline.service"
import { devLogPipelineMove } from "@/lib/commercial-pipeline"

type PipelineKanbanBoardProps = {
  cards: PipelineCard[]
  onCardsChange: (cards: PipelineCard[]) => void
  leadDetailHref: (id: string) => string
  showCommercialName?: boolean
}

export function PipelineKanbanBoard({
  cards,
  onCardsChange,
  leadDetailHref,
  showCommercialName = false,
}: PipelineKanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropStage, setDropStage] = useState<PipelineStage | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  const cardsByStage = useMemo(() => {
    const map = new Map<PipelineStage, PipelineCard[]>()
    for (const cfg of PIPELINE_STAGE_CONFIG) {
      map.set(
        cfg.id,
        cards
          .filter((c) => c.pipelineStage === cfg.id)
          .sort((a, b) => a.pipelineOrder - b.pipelineOrder)
      )
    }
    return map
  }, [cards])

  const handleDragStart = useCallback((cardId: string) => {
    setDraggingId(cardId)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setDropStage(null)
  }, [])

  const handleDrop = useCallback(
    async (stage: PipelineStage, targetIndex: number) => {
      if (!draggingId) return
      const card = cards.find((c) => c.id === draggingId)
      if (!card) return

      if (card.pipelineStage === stage && card.pipelineOrder === targetIndex) {
        handleDragEnd()
        return
      }

      setMovingId(draggingId)
      const result = await moveReferralPipelineStageFromSupabase(
        draggingId,
        stage,
        targetIndex
      )
      setMovingId(null)
      handleDragEnd()

      if (!result.ok) {
        toast.error(result.message)
        return
      }

      const updated = cards.map((c) =>
        c.id === draggingId
          ? {
              ...c,
              pipelineStage: result.pipelineStage,
              pipelineOrder: result.pipelineOrder,
              movedToStageAt: new Date(),
              wonAt: result.pipelineStage === "ativado" ? new Date() : c.wonAt,
              lostAt: result.pipelineStage === "perdido" ? new Date() : c.lostAt,
            }
          : c
      )
      onCardsChange(updated)
      emitReferralDataMutated()
      toast.success("Lead movido no pipeline")
      devLogPipelineMove("ui updated", { id: draggingId, stage })
    },
    [cards, draggingId, handleDragEnd, onCardsChange]
  )

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-280px)]">
      {PIPELINE_STAGE_CONFIG.map((column) => {
        const columnCards = cardsByStage.get(column.id) ?? []
        const isDropTarget = dropStage === column.id

        return (
          <div
            key={column.id}
            className={cn(
              "flex w-[272px] shrink-0 flex-col rounded-xl border border-white/5",
              "bg-zinc-950/80 backdrop-blur-sm shadow-lg shadow-black/20",
              isDropTarget && "ring-2 ring-primary/50 border-primary/30"
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setDropStage(column.id)
            }}
            onDragLeave={() => setDropStage(null)}
            onDrop={(e) => {
              e.preventDefault()
              void handleDrop(column.id, columnCards.length)
            }}
          >
            <div
              className={cn(
                "sticky top-0 z-10 rounded-t-xl border-b border-white/5 px-3 py-3",
                column.accentClass
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className={cn("text-sm font-semibold", column.headerClass)}>
                  {column.label}
                </h3>
                <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-medium text-zinc-300">
                  {columnCards.length}
                </span>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2 p-2 min-h-[120px]">
              {columnCards.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500">
                  Arraste leads aqui
                </p>
              ) : (
                columnCards.map((card, index) => (
                  <div
                    key={card.id}
                    draggable={movingId !== card.id}
                    onDragStart={() => handleDragStart(card.id)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void handleDrop(column.id, index)
                    }}
                    className={cn(
                      "group rounded-lg border border-white/8 bg-zinc-900/90 p-3",
                      "transition-all hover:border-white/15 hover:bg-zinc-900",
                      draggingId === card.id && "opacity-40 scale-[0.98]",
                      movingId === card.id && "animate-pulse"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={leadDetailHref(card.id)}
                          className="font-medium text-sm text-zinc-100 hover:text-primary line-clamp-1"
                        >
                          {card.nomeIndicado}
                        </Link>
                        <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                          <Phone className="h-3 w-3" />
                          <span className="truncate">{card.telefoneIndicado}</span>
                        </div>
                        {card.planoNome ? (
                          <p className="mt-1 text-[11px] text-zinc-500 truncate">
                            {card.planoNome}
                          </p>
                        ) : null}
                        {showCommercialName && card.commercialNome ? (
                          <p className="mt-1 text-[11px] text-zinc-400 truncate">
                            {card.commercialNome}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <CommercialRedistributedBadge
                            redistributionCount={card.redistributionCount}
                            previousCommercialName={card.previousCommercialNome}
                            variant="compact"
                          />
                          <CommercialSlaOverdueBadge
                            level={card.slaLevel}
                            variant="compact"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
