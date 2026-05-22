import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  computePipelineMetrics,
  devLogPipeline,
  devLogPipelineMove,
  devLogPipelineSla,
  normalizePipelineStage,
  type PipelineCard,
  type PipelineMetrics,
  type PipelineStage,
} from "@/lib/commercial-pipeline"
import { getCommercialSlaLevel } from "@/lib/commercial-sla"
import { getSupabaseClient } from "@/lib/supabase/client"
import { leads, currentComercial, comerciais } from "@/lib/services/mock-data.service"
type ReferralPipelineRow = {
  id: string
  referred_name: string
  referred_phone: string
  plan_id: string
  commercial_profile_id: string | null
  pipeline_stage: string | null
  pipeline_order: number
  moved_to_stage_at: string | null
  assigned_at: string | null
  first_response_at: string | null
  status: string
  redistribution_count?: number
  previous_commercial_profile_id?: string | null
  sla_redistributed?: boolean
  last_redistributed_at?: string | null
  won_at?: string | null
  lost_at?: string | null
}

export type PipelineLoadMeta = {
  scope: "comercial" | "admin"
  authUserId: string | null
  profileId: string | null
  role: string | null
  filter: string | null
  rowsReturned: number
  cardsMapped: number
  rowsDropped: number
  selectVariant?: "extended" | "core"
}

export type PipelineBoardLoadResult =
  | {
      ok: true
      cards: PipelineCard[]
      metrics: PipelineMetrics
      meta: PipelineLoadMeta
    }
  | {
      ok: false
      cards: []
      metrics: PipelineMetrics
      error: string
      code?: string
      meta: PipelineLoadMeta
    }

type PipelineDb = {
  from: (t: string) => ReturnType<ReturnType<typeof getSupabaseClient>["from"]>
}

const ADMIN_PIPELINE_ROLES = new Set([
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
])

/** Colunas mínimas (pipeline + identificação). Sem patches SLA/redistribuição. */
const PIPELINE_SELECT_CORE = `
  id,
  referred_name,
  referred_phone,
  plan_id,
  commercial_profile_id,
  pipeline_stage,
  pipeline_order,
  moved_to_stage_at,
  status,
  won_at,
  lost_at
`

/** Inclui campos opcionais de SLA/redistribuição (exige patches aplicados). */
const PIPELINE_SELECT_EXTENDED = `
  id,
  referred_name,
  referred_phone,
  plan_id,
  commercial_profile_id,
  pipeline_stage,
  pipeline_order,
  moved_to_stage_at,
  assigned_at,
  first_response_at,
  status,
  redistribution_count,
  previous_commercial_profile_id,
  sla_redistributed,
  last_redistributed_at,
  won_at,
  lost_at
`

function isMissingColumnPipelineError(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false
  const code = error.code ?? ""
  const msg = (error.message ?? "").toLowerCase()
  return (
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    (msg.includes("column") && msg.includes("referrals"))
  )
}

function parsePostgrestThrown(thrown: unknown): {
  message?: string
  code?: string
  details?: string
  hint?: string
} {
  if (thrown && typeof thrown === "object" && "message" in thrown) {
    return thrown as {
      message?: string
      code?: string
      details?: string
      hint?: string
    }
  }
  return {
    message: thrown instanceof Error ? thrown.message : String(thrown),
  }
}

async function fetchPipelineReferralRows(
  db: PipelineDb,
  opts: {
    applyFilter: (qb: ReturnType<PipelineDb["from"]>) => ReturnType<PipelineDb["from"]>
    filterDesc: string | null
  }
): Promise<{
  rows: ReferralPipelineRow[]
  selectUsed: string
  selectVariant: "extended" | "core"
  error: { message?: string; code?: string } | null
}> {
  const selects: Array<{ variant: "extended" | "core"; sql: string }> = [
    { variant: "extended", sql: PIPELINE_SELECT_EXTENDED },
    { variant: "core", sql: PIPELINE_SELECT_CORE },
  ]
  let lastError: { message?: string; code?: string } | null = null

  for (let i = 0; i < selects.length; i++) {
    const { variant, sql } = selects[i]!
    let qb = db.from("referrals").select(sql)
    qb = opts.applyFilter(qb)

    try {
      const { data } = await qb
        .order("pipeline_order", { ascending: true })
        .throwOnError()
      const rows = (data ?? []) as ReferralPipelineRow[]
      console.log("[pipeline:query]", {
        rowsReturned: rows.length,
        error: null,
        filter: opts.filterDesc,
        selectVariant: variant,
      })
      return { rows, selectUsed: sql, selectVariant: variant, error: null }
    } catch (thrown) {
      const error = parsePostgrestThrown(thrown)
      lastError = error
      console.error("[pipeline:error]", error)

      if (isMissingColumnPipelineError(error) && i < selects.length - 1) {
        console.warn("[pipeline:retry-core]", {
          reason: error.message,
          next: "core",
        })
        continue
      }

      console.log("[pipeline:query]", {
        rowsReturned: 0,
        error,
        filter: opts.filterDesc,
        selectVariant: variant,
      })
      return { rows: [], selectUsed: sql, selectVariant: variant, error }
    }
  }

  return {
    rows: [],
    selectUsed: PIPELINE_SELECT_CORE,
    selectVariant: "core",
    error: lastError,
  }
}

function rowToPipelineCard(
  row: ReferralPipelineRow,
  profileNames: Map<string, string>,
  planNameById: Map<string, string>
): PipelineCard {
  const stage = normalizePipelineStage(row.pipeline_stage)

  const slaLevel = getCommercialSlaLevel({
    commercialProfileId: row.commercial_profile_id,
    assignedAt: row.assigned_at,
    firstResponseAt: row.first_response_at,
    status: row.status,
  })

  if (slaLevel !== "none") {
    devLogPipelineSla({ referralId: row.id, slaLevel, stage })
  }

  const movedRaw = row.moved_to_stage_at ?? row.assigned_at ?? null

  return {
    id: row.id,
    nomeIndicado: row.referred_name,
    telefoneIndicado: row.referred_phone,
    planoNome: planNameById.get(row.plan_id),
    pipelineStage: stage,
    pipelineOrder: row.pipeline_order ?? 0,
    commercialProfileId: row.commercial_profile_id,
    commercialNome: row.commercial_profile_id
      ? profileNames.get(row.commercial_profile_id)
      : undefined,
    assignedAt: row.assigned_at ? new Date(row.assigned_at) : null,
    movedToStageAt: movedRaw ? new Date(movedRaw) : new Date(),
    slaLevel,
    redistributionCount: row.redistribution_count ?? 0,
    previousCommercialNome: row.previous_commercial_profile_id
      ? (profileNames.get(row.previous_commercial_profile_id) ?? null)
      : null,
    wonAt: row.won_at ? new Date(row.won_at) : null,
    lostAt: row.lost_at ? new Date(row.lost_at) : null,
  }
}

function mockPipelineCards(scope: "comercial" | "admin"): PipelineCard[] {
  const list =
    scope === "comercial"
      ? leads.filter((l) => l.comercialId === currentComercial.id)
      : leads

  const stageMap: Record<string, PipelineStage> = {
    novo: "novo",
    em_atendimento: "tentativa_contato",
    sem_contato: "tentativa_contato",
    em_negociacao: "negociacao",
    vendido: "ativado",
    perdido: "perdido",
    redistribuido: "tentativa_contato",
  }

  return list.map((lead, index) => ({
    id: lead.id,
    nomeIndicado: lead.indicacao?.nomeIndicado ?? "Lead",
    telefoneIndicado: lead.indicacao?.telefoneIndicado ?? "",
    planoNome: lead.indicacao?.plano?.nome,
    pipelineStage: stageMap[lead.status] ?? "novo",
    pipelineOrder: index,
    commercialProfileId: lead.comercialId || currentComercial.id,
    commercialNome:
      comerciais.find((c) => c.id === lead.comercialId)?.nome ??
      currentComercial.nome,
    assignedAt: lead.assignedAt ?? lead.createdAt,
    movedToStageAt: lead.updatedAt,
    slaLevel: lead.slaLevel,
    redistributionCount: lead.redistributionCount ?? 0,
    previousCommercialNome: lead.previousCommercialNome ?? null,
  }))
}

function buildEmptyMeta(scope: "comercial" | "admin"): PipelineLoadMeta {
  return {
    scope,
    authUserId: null,
    profileId: null,
    role: null,
    filter: null,
    rowsReturned: 0,
    cardsMapped: 0,
    rowsDropped: 0,
  }
}

function logPipelineRowsSample(
  rows: ReferralPipelineRow[],
  limit = 5
): Array<{
  id: string
  commercial_profile_id: string | null
  pipeline_stage: string | null
  status: string
}> {
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    commercial_profile_id: r.commercial_profile_id,
    pipeline_stage: r.pipeline_stage,
    status: r.status,
  }))
}

function logPipelineBoardByStage(cards: PipelineCard[]): Record<PipelineStage, number> {
  const totals = {} as Record<PipelineStage, number>
  for (const stage of [
    "novo",
    "tentativa_contato",
    "contato_realizado",
    "negociacao",
    "agendado",
    "instalacao",
    "ativado",
    "perdido",
  ] as PipelineStage[]) {
    totals[stage] = cards.filter((c) => c.pipelineStage === stage).length
  }
  return totals
}

async function loadPlanNamesForPipeline(
  db: PipelineDb,
  rows: ReferralPipelineRow[]
): Promise<Map<string, string>> {
  const planNameById = new Map<string, string>()
  const planIds = [...new Set(rows.map((r) => r.plan_id).filter(Boolean))]
  if (planIds.length === 0) return planNameById

  try {
    const { data } = await db
      .from("plans")
      .select("id, name")
      .in("id", planIds)
      .throwOnError()
    for (const pr of data ?? []) {
      const row = pr as { id: string; name: string }
      planNameById.set(row.id, row.name)
    }
  } catch (thrown) {
    console.error("[pipeline:error]", { step: "plans", error: thrown })
  }
  return planNameById
}

export async function loadPipelineCardsFromSupabase(
  scope: "comercial" | "admin"
): Promise<PipelineBoardLoadResult> {
  const emptyMetrics = computePipelineMetrics([])

  if (isDataProviderMock()) {
    const cards = mockPipelineCards(scope)
    const meta: PipelineLoadMeta = {
      ...buildEmptyMeta(scope),
      rowsReturned: cards.length,
      cardsMapped: cards.length,
    }
    devLogPipeline("mock", { scope, total: cards.length })
    console.log("[pipeline:board]", { scope, totalCards: cards.length, byStage: logPipelineBoardByStage(cards) })
    return { ok: true, cards, metrics: computePipelineMetrics(cards), meta }
  }

  let meta = buildEmptyMeta(scope)

  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as PipelineDb

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()

    meta = { ...meta, authUserId: user?.id ?? null }

    if (authErr || !user) {
      const error = authErr?.message ?? "Sessão ausente"
      console.error("[pipeline:error]", { step: "auth", error })
      return { ok: false, cards: [], metrics: emptyMetrics, error, meta }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) {
      const error = profileError?.message ?? "Perfil não encontrado"
      console.error("[pipeline:error]", { step: "profile", error: profileError ?? error })
      return {
        ok: false,
        cards: [],
        metrics: emptyMetrics,
        error,
        code: profileError?.code,
        meta,
      }
    }

    const profileRow = profile as { id: string; role: string }
    const profileId = profileRow.id
    const role = profileRow.role
    meta = { ...meta, profileId, role }

    console.log("[pipeline:session]", {
      authUserId: user.id,
      profileId,
      role,
      scope,
    })

    if (scope === "comercial" && role !== "comercial") {
      const error = `Role "${role}" não autorizada para pipeline comercial`
      console.error("[pipeline:error]", { step: "role", error })
      return { ok: false, cards: [], metrics: emptyMetrics, error, meta }
    }

    if (scope === "admin" && !ADMIN_PIPELINE_ROLES.has(role)) {
      const error = `Role "${role}" não autorizada para pipeline admin`
      console.error("[pipeline:error]", { step: "role", error })
      return { ok: false, cards: [], metrics: emptyMetrics, error, meta }
    }

    let filterDesc: string | null = null
    const applyFilter = (qb: ReturnType<PipelineDb["from"]>) => {
      if (scope === "comercial") {
        filterDesc = `commercial_profile_id.eq.${profileId}`
        return qb.eq("commercial_profile_id", profileId)
      }
      filterDesc = "(admin — todas visíveis via RLS)"
      return qb
    }

    meta = { ...meta, filter: filterDesc }

    const {
      rows,
      selectVariant,
      error: refError,
    } = await fetchPipelineReferralRows(db, {
      applyFilter,
      filterDesc,
    })

    meta = { ...meta, selectVariant }

    if (refError) {
      return {
        ok: false,
        cards: [],
        metrics: emptyMetrics,
        error: refError.message ?? "Falha ao carregar referrals do pipeline",
        code: refError.code,
        meta,
      }
    }

    meta = { ...meta, rowsReturned: rows.length }

    console.log("[pipeline:rows]", logPipelineRowsSample(rows))

    const profileIds = new Set<string>()
    for (const r of rows) {
      if (r.commercial_profile_id) profileIds.add(r.commercial_profile_id)
      if (r.previous_commercial_profile_id) {
        profileIds.add(r.previous_commercial_profile_id)
      }
    }

    const profileNames = new Map<string, string>()
    if (profileIds.size > 0) {
      try {
        const { data: profs } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", [...profileIds])
          .throwOnError()
        for (const p of profs ?? []) {
          const row = p as { id: string; full_name: string }
          profileNames.set(row.id, row.full_name)
        }
      } catch (thrown) {
        console.error("[pipeline:error]", { step: "profiles", error: thrown })
      }
    }

    const planNameById = await loadPlanNamesForPipeline(db, rows)

    let rowsDropped = 0
    const cards: PipelineCard[] = []
    for (const r of rows) {
      const rawStage = r.pipeline_stage
      const normalized = normalizePipelineStage(rawStage)
      if (
        rawStage != null &&
        String(rawStage).trim() !== "" &&
        normalized === "novo" &&
        String(rawStage).trim().toLowerCase() !== "novo"
      ) {
        rowsDropped += 1
        console.warn("[pipeline:stage-normalize]", {
          id: r.id,
          raw: rawStage,
          normalized,
        })
      }
      cards.push(rowToPipelineCard(r, profileNames, planNameById))
    }

    meta = {
      ...meta,
      cardsMapped: cards.length,
      rowsDropped,
    }

    const metrics = computePipelineMetrics(cards)
    const byStage = logPipelineBoardByStage(cards)

    console.log("[pipeline:board]", {
      scope,
      totalCards: cards.length,
      byStage,
      rowsDropped,
    })

    devLogPipeline("load", { scope, total: cards.length, byStage })

    return { ok: true, cards, metrics, meta }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error("[pipeline:error]", e)
    return { ok: false, cards: [], metrics: emptyMetrics, error, meta }
  }
}

export async function loadPipelineBoardFromSupabase(
  scope: "comercial" | "admin"
): Promise<PipelineBoardLoadResult> {
  return loadPipelineCardsFromSupabase(scope)
}

export type MovePipelineStageResult =
  | { ok: true; pipelineStage: PipelineStage; pipelineOrder: number }
  | { ok: false; message: string }

export async function moveReferralPipelineStageFromSupabase(
  referralId: string,
  newStage: PipelineStage,
  pipelineOrder?: number,
  lostReason?: string
): Promise<MovePipelineStageResult> {
  devLogPipelineMove({ referralId, newStage, pipelineOrder, lostReason })

  if (isDataProviderMock()) {
    return { ok: true, pipelineStage: newStage, pipelineOrder: pipelineOrder ?? 0 }
  }

  try {
    const supabase = getSupabaseClient()
    const dbRpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: {
          p_referral_id: string
          p_new_stage: string
          p_pipeline_order: number | null
          p_lost_reason: string | null
        }
      ) => Promise<{
        data: { ok?: boolean; message?: string; pipeline_stage?: string; pipeline_order?: number } | null
        error: { message: string } | null
      }>
    }

    const { data, error } = await dbRpc.rpc("move_referral_pipeline_stage", {
      p_referral_id: referralId,
      p_new_stage: newStage,
      p_pipeline_order: pipelineOrder ?? null,
      p_lost_reason: lostReason ?? null,
    })

    if (error) {
      devLogPipelineMove("erro rpc", error.message)
      return { ok: false, message: error.message }
    }

    if (!data?.ok) {
      return {
        ok: false,
        message: data?.message ?? "Não foi possível mover o lead.",
      }
    }

    const stage = normalizePipelineStage(data.pipeline_stage)
    devLogPipelineMove("sucesso", data)
    return {
      ok: true,
      pipelineStage: stage,
      pipelineOrder: data.pipeline_order ?? 0,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devLogPipelineMove("exceção", msg)
    return { ok: false, message: msg }
  }
}
