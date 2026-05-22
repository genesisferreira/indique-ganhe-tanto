import type { CommercialSlaLevel } from "@/lib/commercial-sla"

export const PIPELINE_STAGES = [
  "novo",
  "tentativa_contato",
  "contato_realizado",
  "negociacao",
  "agendado",
  "instalacao",
  "ativado",
  "perdido",
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export type PipelineStageConfig = {
  id: PipelineStage
  label: string
  shortLabel: string
  accentClass: string
  headerClass: string
  isTerminal?: boolean
}

export const PIPELINE_STAGE_CONFIG: PipelineStageConfig[] = [
  {
    id: "novo",
    label: "Novo",
    shortLabel: "Novo",
    accentClass: "border-sky-500/40 bg-sky-500/10",
    headerClass: "text-sky-300",
  },
  {
    id: "tentativa_contato",
    label: "Tentativa de contato",
    shortLabel: "Tentativa",
    accentClass: "border-amber-500/40 bg-amber-500/10",
    headerClass: "text-amber-300",
  },
  {
    id: "contato_realizado",
    label: "Contato realizado",
    shortLabel: "Contato",
    accentClass: "border-cyan-500/40 bg-cyan-500/10",
    headerClass: "text-cyan-300",
  },
  {
    id: "negociacao",
    label: "Negociação",
    shortLabel: "Negociação",
    accentClass: "border-violet-500/40 bg-violet-500/10",
    headerClass: "text-violet-300",
  },
  {
    id: "agendado",
    label: "Agendado",
    shortLabel: "Agendado",
    accentClass: "border-indigo-500/40 bg-indigo-500/10",
    headerClass: "text-indigo-300",
  },
  {
    id: "instalacao",
    label: "Instalação",
    shortLabel: "Instalação",
    accentClass: "border-blue-500/40 bg-blue-500/10",
    headerClass: "text-blue-300",
  },
  {
    id: "ativado",
    label: "Ativado",
    shortLabel: "Ganho",
    accentClass: "border-emerald-500/40 bg-emerald-500/10",
    headerClass: "text-emerald-300",
    isTerminal: true,
  },
  {
    id: "perdido",
    label: "Perdido",
    shortLabel: "Perdido",
    accentClass: "border-rose-500/40 bg-rose-500/10",
    headerClass: "text-rose-300",
    isTerminal: true,
  },
]

export type PipelineCard = {
  id: string
  nomeIndicado: string
  telefoneIndicado: string
  planoNome?: string
  pipelineStage: PipelineStage
  pipelineOrder: number
  commercialProfileId?: string | null
  commercialNome?: string
  assignedAt?: Date | null
  movedToStageAt?: Date
  slaLevel?: CommercialSlaLevel
  redistributionCount?: number
  previousCommercialNome?: string | null
  wonAt?: Date | null
  lostAt?: Date | null
}

export type PipelineMetrics = {
  totalLeads: number
  conversionRate: number
  avgStageMinutes: number
  wonCount: number
  lostCount: number
  byStage: Record<PipelineStage, number>
  commercialRanking: Array<{
    commercialId: string
    commercialNome: string
    wonCount: number
    totalAssigned: number
    conversionRate: number
  }>
}

export function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value)
}

/** Normaliza valor do banco; null/vazio/inválido → `novo`. */
export function normalizePipelineStage(
  raw: string | null | undefined
): PipelineStage {
  if (raw == null || String(raw).trim() === "") return "novo"
  const normalized = String(raw).trim().toLowerCase()
  if (isPipelineStage(normalized)) return normalized
  return "novo"
}

export function devLogPipeline(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "development") return
  console.log("[pipeline]", ...args)
}

export function devLogPipelineMove(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "development") return
  console.log("[pipeline:move]", ...args)
}

export function devLogPipelineSla(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "development") return
  console.log("[pipeline:sla]", ...args)
}

export function computePipelineMetrics(cards: PipelineCard[]): PipelineMetrics {
  const byStage = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = 0
      return acc
    },
    {} as Record<PipelineStage, number>
  )

  for (const card of cards) {
    byStage[card.pipelineStage] += 1
  }

  const wonCount = byStage.ativado
  const lostCount = byStage.perdido
  const totalLeads = cards.length
  const closed = wonCount + lostCount
  const conversionRate = closed > 0 ? Math.round((wonCount / closed) * 100) : 0

  const stageMinutes: number[] = []
  const now = Date.now()
  for (const card of cards) {
    if (!card.movedToStageAt) continue
    const mins = (now - card.movedToStageAt.getTime()) / 60000
    if (mins >= 0) stageMinutes.push(mins)
  }
  const avgStageMinutes =
    stageMinutes.length > 0
      ? Math.round(
          stageMinutes.reduce((a, b) => a + b, 0) / stageMinutes.length
        )
      : 0

  const rankMap = new Map<
    string,
    { commercialNome: string; wonCount: number; totalAssigned: number }
  >()
  for (const card of cards) {
    const cid = card.commercialProfileId
    if (!cid) continue
    const cur = rankMap.get(cid) ?? {
      commercialNome: card.commercialNome ?? "Comercial",
      wonCount: 0,
      totalAssigned: 0,
    }
    cur.totalAssigned += 1
    if (card.pipelineStage === "ativado") cur.wonCount += 1
    rankMap.set(cid, cur)
  }

  const commercialRanking = [...rankMap.entries()]
    .map(([commercialId, row]) => ({
      commercialId,
      commercialNome: row.commercialNome,
      wonCount: row.wonCount,
      totalAssigned: row.totalAssigned,
      conversionRate:
        row.totalAssigned > 0
          ? Math.round((row.wonCount / row.totalAssigned) * 100)
          : 0,
    }))
    .sort((a, b) => b.wonCount - a.wonCount || b.conversionRate - a.conversionRate)

  return {
    totalLeads,
    conversionRate,
    avgStageMinutes,
    wonCount,
    lostCount,
    byStage,
    commercialRanking,
  }
}
