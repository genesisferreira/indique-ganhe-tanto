import { getSupabaseClient } from "@/lib/supabase/client"
import type { DashboardIndicador } from "@/types/dashboard"
import type { Indicador } from "@/types/profile"
import type { Indicacao, IndicacaoStatus, RecompensaTipo } from "@/types/referral"
import type { Plano } from "@/types/plan"

type ProfileRow = {
  id: string
  full_name: string
  email: string
  phone: string
  role: string
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type ReferralRow = {
  id: string
  indicator_profile_id: string
  referred_name: string
  referred_phone: string
  referred_email: string | null
  referred_address: string | null
  plan_id: string
  reward_type: string
  reward_amount: number | string
  status: string
  commercial_profile_id: string | null
  notes: string | null
  first_invoice_paid: boolean
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
  plans?: { name: string } | { name: string }[] | null
}

type PaymentRow = {
  amount: number | string
  status: string
}

type RewardRow = {
  amount: number | string
  status: string
  reward_type: string
}

const EM_ANDAMENTO_STATUSES = new Set([
  "pendente",
  "em_andamento",
  "em_atendimento",
  "em_negociacao",
])

function mapReferralStatus(status: string): IndicacaoStatus {
  const allowed: IndicacaoStatus[] = [
    "pendente",
    "em_andamento",
    "em_atendimento",
    "em_negociacao",
    "aprovada",
    "recusada",
    "paga",
  ]
  return (allowed.includes(status as IndicacaoStatus) ? status : "pendente") as IndicacaoStatus
}

function mapRewardType(t: string): RecompensaTipo {
  return t === "desconto_fatura" ? "desconto_fatura" : "pix"
}

function planNomeFromRow(row: ReferralRow): Plano | undefined {
  const p = row.plans
  if (!p) return undefined
  const name = Array.isArray(p) ? p[0]?.name : p.name
  if (!name) return undefined
  return {
    id: row.plan_id,
    nome: name,
    velocidade: "",
    preco: 0,
    descricao: "",
    ativo: true,
  }
}

function referralToIndicacao(row: ReferralRow, indicadorId: string): Indicacao {
  return {
    id: row.id,
    indicadorId,
    nomeIndicado: row.referred_name,
    telefoneIndicado: row.referred_phone,
    emailIndicado: row.referred_email ?? undefined,
    enderecoIndicado: row.referred_address ?? undefined,
    planoId: row.plan_id,
    plano: planNomeFromRow(row),
    tipoRecompensa: mapRewardType(row.reward_type),
    valorRecompensa: Number(row.reward_amount),
    status: mapReferralStatus(row.status),
    comercialId: row.commercial_profile_id ?? undefined,
    observacoes: row.notes ?? undefined,
    primeiraFaturaPaga: row.first_invoice_paid,
    dataAprovacao: row.approved_at ? new Date(row.approved_at) : undefined,
    dataRecusa: row.rejected_at ? new Date(row.rejected_at) : undefined,
    motivoRecusa: row.rejection_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/** Merge referrals + mapa de planos (consulta separada em plans). */
function referralRowToIndicacaoMerged(
  row: ReferralRow,
  indicadorId: string,
  planoById: Map<string, Plano>
): Indicacao {
  const plano = planoById.get(row.plan_id)
  return {
    id: row.id,
    indicadorId,
    nomeIndicado: row.referred_name,
    telefoneIndicado: row.referred_phone,
    emailIndicado: row.referred_email ?? undefined,
    enderecoIndicado: row.referred_address ?? undefined,
    planoId: row.plan_id,
    plano:
      plano ??
      ({
        id: row.plan_id,
        nome: "Plano",
        velocidade: "-",
        preco: 0,
        descricao: "",
        ativo: true,
      } satisfies Plano),
    tipoRecompensa: mapRewardType(row.reward_type),
    valorRecompensa: Number(row.reward_amount),
    status: mapReferralStatus(row.status),
    comercialId: row.commercial_profile_id ?? undefined,
    observacoes: row.notes ?? undefined,
    primeiraFaturaPaga: row.first_invoice_paid,
    dataAprovacao: row.approved_at ? new Date(row.approved_at) : undefined,
    dataRecusa: row.rejected_at ? new Date(row.rejected_at) : undefined,
    motivoRecusa: row.rejection_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function buildDashboardFromRows(
  referrals: ReferralRow[],
  payments: PaymentRow[],
  rewards: RewardRow[]
): DashboardIndicador {
  const totalIndicacoes = referrals.length
  let emAndamento = 0
  let aprovadas = 0
  let recusadas = 0

  for (const r of referrals) {
    if (EM_ANDAMENTO_STATUSES.has(r.status)) emAndamento += 1
    else if (r.status === "aprovada" || r.status === "paga") aprovadas += 1
    else if (r.status === "recusada") recusadas += 1
  }

  let totalRecebido = 0
  let totalAReceber = 0
  for (const p of payments) {
    const amt = Number(p.amount)
    if (p.status === "pago") totalRecebido += amt
    else if (p.status === "pendente" || p.status === "aprovado") totalAReceber += amt
  }

  let saldoDisponivel = 0
  let saldoEmDesconto = 0
  for (const rw of rewards) {
    if (rw.status !== "disponivel" && rw.status !== "solicitado") continue
    const amt = Number(rw.amount)
    if (rw.reward_type === "desconto_fatura") saldoEmDesconto += amt
    else saldoDisponivel += amt
  }

  return {
    totalIndicacoes,
    emAndamento,
    aprovadas,
    recusadas,
    totalRecebido,
    totalAReceber,
    saldoDisponivel,
    saldoEmDesconto,
  }
}

function buildIndicadorFromProfile(
  row: ProfileRow,
  referrals: ReferralRow[],
  dashboard: DashboardIndicador
): Indicador {
  const aprovadasCount = referrals.filter(
    (r) => r.status === "aprovada" || r.status === "paga"
  ).length

  return {
    id: row.id,
    nome: row.full_name,
    email: row.email,
    telefone: row.phone,
    role: "indicador",
    avatar: row.avatar_url ?? undefined,
    ativo: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    totalIndicacoes: referrals.length,
    indicacoesAprovadas: aprovadasCount,
    totalRecebido: dashboard.totalRecebido,
    saldoDisponivel: dashboard.saldoDisponivel,
    saldoDesconto: dashboard.saldoEmDesconto,
  }
}

export type IndicadorHomeFromSupabase = {
  indicador: Indicador
  dashboard: DashboardIndicador
  recentIndicacoes: Indicacao[]
}

const INDICADOR_HOME_LOG_PREFIX = "[indicador-home:supabase]"

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function devLog(...args: unknown[]): void {
  if (!isDev()) return
  console.log(INDICADOR_HOME_LOG_PREFIX, ...args)
}

/** Último motivo de fallback (apenas dev; para o provider logar após await). */
let devLastIndicadorHomeFailureReason: string | null = null

export function getIndicadorHomeLoadFailureReasonForDev(): string | null {
  if (!isDev()) return null
  return devLastIndicadorHomeFailureReason
}

function devFail(reason: string): null {
  if (isDev()) {
    devLastIndicadorHomeFailureReason = reason
    console.warn(INDICADOR_HOME_LOG_PREFIX, "fallback →", reason)
  }
  return null
}

/**
 * Perfil do usuário autenticado como indicador (sem agregar indicações).
 * Retorna null se não houver sessão, perfil inexistente, role diferente de indicador ou erro.
 */
export async function getCurrentUserProfile(): Promise<Indicador | null> {
  const home = await loadIndicadorHomeFromSupabase()
  return home?.indicador ?? null
}

/**
 * Perfil + métricas do dashboard + últimas indicações a partir do Supabase.
 * Retorna null em qualquer falha (mantém fallback mock na UI).
 */
export async function loadIndicadorHomeFromSupabase(): Promise<IndicadorHomeFromSupabase | null> {
  if (isDev()) devLastIndicadorHomeFailureReason = null

  try {
    devLog("início loadIndicadorHomeFromSupabase")

    const supabase = getSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    const hasSession = Boolean(user && !userError)
    devLog("auth.getUser", {
      hasSession,
      userError: userError?.message ?? null,
      userId: user?.id ?? null,
    })

    if (userError || !user) {
      return devFail(
        userError
          ? `sem usuário autenticado: ${userError.message}`
          : "sem usuário autenticado (user ausente)"
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle()

    devLog("query profiles", {
      error: profileError?.message ?? null,
      code: profileError?.code ?? null,
      hasRow: profile != null,
      rowPreview: profile
        ? {
            id: (profile as ProfileRow).id,
            role: (profile as ProfileRow).role,
            is_active: (profile as ProfileRow).is_active,
          }
        : null,
    })

    if (profileError || !profile) {
      return devFail(
        profileError
          ? `profiles falhou: ${profileError.message} (${profileError.code ?? "sem código"})`
          : "profiles: nenhuma linha para este user.id"
      )
    }

    const row = profile as ProfileRow
    devLog("profile.role", row.role)

    if (row.role !== "indicador") {
      return devFail(
        `role não é indicador: "${row.role}" (esperado "indicador")`
      )
    }

    const { data: refData, error: refError } = await supabase
      .from("referrals")
      .select(
        `
        id,
        indicator_profile_id,
        referred_name,
        referred_phone,
        referred_email,
        referred_address,
        plan_id,
        reward_type,
        reward_amount,
        status,
        commercial_profile_id,
        notes,
        first_invoice_paid,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at,
        updated_at,
        plans ( name )
      `
      )
      .eq("indicator_profile_id", user.id)
      .order("created_at", { ascending: false })

    devLog("query referrals", {
      error: refError?.message ?? null,
      code: refError?.code ?? null,
      rowCount: refData?.length ?? 0,
    })

    if (refError) {
      return devFail(
        `referrals falhou: ${refError.message} (${refError.code ?? "sem código"})`
      )
    }

    const referrals = (refData ?? []) as ReferralRow[]

    const { data: payData, error: payError } = await supabase
      .from("payments")
      .select("amount, status")
      .eq("indicator_profile_id", user.id)

    devLog("query payments", {
      error: payError?.message ?? null,
      code: payError?.code ?? null,
      rowCount: payData?.length ?? 0,
    })

    if (payError) {
      return devFail(
        `payments falhou: ${payError.message} (${payError.code ?? "sem código"})`
      )
    }

    const { data: rewData, error: rewError } = await supabase
      .from("rewards")
      .select("amount, status, reward_type")
      .eq("indicator_profile_id", user.id)

    devLog("query rewards", {
      error: rewError?.message ?? null,
      code: rewError?.code ?? null,
      rowCount: rewData?.length ?? 0,
    })

    if (rewError) {
      return devFail(
        `rewards falhou: ${rewError.message} (${rewError.code ?? "sem código"})`
      )
    }

    const payments = (payData ?? []) as PaymentRow[]
    const rewards = (rewData ?? []) as RewardRow[]

    const dashboard = buildDashboardFromRows(referrals, payments, rewards)
    const indicador = buildIndicadorFromProfile(row, referrals, dashboard)
    const recentIndicacoes = referrals
      .slice(0, 5)
      .map((r) => referralToIndicacao(r, user.id))

    if (isDev()) {
      devLastIndicadorHomeFailureReason = null
      devLog("sucesso: dados Supabase aplicados", {
        indicadorId: indicador.id,
        referrals: referrals.length,
        payments: payments.length,
        rewards: rewards.length,
      })
    }

    return { indicador, dashboard, recentIndicacoes }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return devFail(`exceção não tratada: ${msg}`)
  }
}

// --- Nova indicação (planos + insert em referrals) ---------------------------------

type PlanCatalogRow = {
  id: string
  name: string
  speed_label: string
  price: number | string
  description: string | null
  reward_amount: number | string
  is_active: boolean
  sort_order: number
}

function mapPlanRowToPlano(row: PlanCatalogRow): Plano {
  return {
    id: row.id,
    nome: row.name,
    velocidade: row.speed_label,
    preco: Number(row.price),
    descricao: row.description ?? "",
    valorRecompensa: Number(row.reward_amount),
    ativo: row.is_active,
    ordem: row.sort_order,
  }
}

/**
 * Planos ativos do catálogo Supabase. Retorna null em falha (UI mantém mock).
 */
export async function fetchActivePlansForIndicador(): Promise<Plano[] | null> {
  try {
    const supabase = getSupabaseClient()
    /* Schema real não está no placeholder em types/database.ts */
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { data, error } = await db
      .from("plans")
      .select(
        "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true })

    if (error || !data?.length) return null

    return (data as PlanCatalogRow[]).map(mapPlanRowToPlano)
  } catch {
    return null
  }
}

export type InsertIndicadorReferralInput = {
  referred_name: string
  referred_phone: string
  referred_email?: string | null
  referred_address?: string | null
  plan_id: string
  reward_type: "pix" | "desconto_fatura"
  reward_amount: number
}

/**
 * Insere uma indicação para o usuário autenticado. Não usa DATA_PROVIDER.
 */
export async function insertIndicadorReferral(
  input: InsertIndicadorReferralInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const supabase = getSupabaseClient()
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      return {
        ok: false,
        message: "Sessão não encontrada. Faça login novamente.",
      }
    }

    const email =
      input.referred_email != null && String(input.referred_email).trim() !== ""
        ? String(input.referred_email).trim()
        : null
    const address =
      input.referred_address != null &&
      String(input.referred_address).trim() !== ""
        ? String(input.referred_address).trim()
        : null

    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { error } = await db.from("referrals").insert({
      indicator_profile_id: user.id,
      referred_name: input.referred_name.trim(),
      referred_phone: input.referred_phone.trim(),
      referred_email: email,
      referred_address: address,
      plan_id: input.plan_id,
      reward_type: input.reward_type,
      reward_amount: input.reward_amount,
      status: "pendente",
    })

    if (error) {
      return {
        ok: false,
        message: error.message || "Não foi possível cadastrar a indicação.",
      }
    }

    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg }
  }
}

// --- Lista /indicador/indicacoes (referrals + plans em memória) --------------------

const INDICACOES_LIST_LOG_PREFIX = "[indicador-indicacoes:supabase]"

function devLogIndicacoes(...args: unknown[]): void {
  if (!isDev()) return
  console.log(INDICACOES_LIST_LOG_PREFIX, ...args)
}

function devWarnIndicacoesMock(reason: string): void {
  if (isDev()) {
    console.warn(INDICACOES_LIST_LOG_PREFIX, "fallback mock →", reason)
  }
}

/**
 * Indicações do indicador logado: referrals por user + planos em query separada.
 * Retorna null em falha (UI mantém lista mock).
 */
export async function loadIndicadorReferralsListFromSupabase(): Promise<
  Indicacao[] | null
> {
  try {
    devLogIndicacoes("início loadIndicadorReferralsListFromSupabase")

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    devLogIndicacoes("auth.getUser", {
      hasUser: Boolean(user && !userError),
      userError: userError?.message ?? null,
      userId: user?.id ?? null,
    })

    if (userError || !user) {
      devWarnIndicacoesMock(
        userError
          ? `sem usuário autenticado: ${userError.message}`
          : "sem usuário autenticado (user ausente)"
      )
      return null
    }

    const { data: refData, error: refError } = await db
      .from("referrals")
      .select(
        `
        id,
        indicator_profile_id,
        referred_name,
        referred_phone,
        referred_email,
        referred_address,
        plan_id,
        reward_type,
        reward_amount,
        status,
        commercial_profile_id,
        notes,
        first_invoice_paid,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at,
        updated_at
      `
      )
      .eq("indicator_profile_id", user.id)
      .order("created_at", { ascending: false })

    devLogIndicacoes("query referrals", {
      error: refError?.message ?? null,
      code: refError?.code ?? null,
      rowCount: refData?.length ?? 0,
    })

    if (refError) {
      devWarnIndicacoesMock(
        `referrals falhou: ${refError.message} (${refError.code ?? "sem código"})`
      )
      return null
    }

    const referrals = (refData ?? []) as ReferralRow[]
    const planIds = [...new Set(referrals.map((r) => r.plan_id))]

    const planoById = new Map<string, Plano>()
    if (planIds.length > 0) {
      const { data: plansData, error: plansError } = await db
        .from("plans")
        .select(
          "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
        )
        .in("id", planIds)

      devLogIndicacoes("query plans", {
        error: plansError?.message ?? null,
        code: plansError?.code ?? null,
        rowCount: plansData?.length ?? 0,
        idsDistintos: planIds.length,
      })

      if (plansError) {
        devWarnIndicacoesMock(
          `plans falhou: ${plansError.message} (${plansError.code ?? "sem código"})`
        )
        return null
      }

      for (const pr of plansData ?? []) {
        const p = mapPlanRowToPlano(pr as PlanCatalogRow)
        planoById.set(p.id, p)
      }
    }

    const result = referrals.map((r) =>
      referralRowToIndicacaoMerged(r, user.id, planoById)
    )

    devLogIndicacoes("sucesso", { total: result.length })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devWarnIndicacoesMock(`exceção: ${msg}`)
    return null
  }
}

// --- Detalhe /indicador/indicacoes/[id] -------------------------------------------

const INDICACAO_DETAIL_LOG_PREFIX = "[indicador-indicacao-detail:supabase]"

function devLogIndicacaoDetail(...args: unknown[]): void {
  if (!isDev()) return
  console.log(INDICACAO_DETAIL_LOG_PREFIX, ...args)
}

function devWarnIndicacaoDetailMock(reason: string): void {
  if (isDev()) {
    console.warn(INDICACAO_DETAIL_LOG_PREFIX, "fallback mock →", reason)
  }
}

export type IndicadorReferralDetailResult =
  | { kind: "ok"; indicacao: Indicacao }
  | { kind: "not-found" }
  | { kind: "error" }

/**
 * Uma indicação por id, somente se pertencer ao usuário logado (referral + plan merge).
 */
export async function loadIndicadorReferralDetailFromSupabase(
  referralId: string
): Promise<IndicadorReferralDetailResult> {
  try {
    devLogIndicacaoDetail("início", { referralId })

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    devLogIndicacaoDetail("auth.getUser", {
      hasUser: Boolean(user && !userError),
      userError: userError?.message ?? null,
      userId: user?.id ?? null,
    })

    if (userError || !user) {
      devWarnIndicacaoDetailMock(
        userError
          ? `sem usuário: ${userError.message}`
          : "user ausente"
      )
      return { kind: "error" }
    }

    const { data: row, error: refError } = await db
      .from("referrals")
      .select(
        `
        id,
        indicator_profile_id,
        referred_name,
        referred_phone,
        referred_email,
        referred_address,
        plan_id,
        reward_type,
        reward_amount,
        status,
        commercial_profile_id,
        notes,
        first_invoice_paid,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at,
        updated_at
      `
      )
      .eq("id", referralId)
      .maybeSingle()

    devLogIndicacaoDetail("query referral por id", {
      error: refError?.message ?? null,
      code: refError?.code ?? null,
      hasRow: row != null,
    })

    if (refError) {
      devWarnIndicacaoDetailMock(
        `referrals: ${refError.message} (${refError.code ?? "sem código"})`
      )
      return { kind: "error" }
    }

    if (!row) {
      devLogIndicacaoDetail("sem linha (RLS ou id inexistente)")
      return { kind: "not-found" }
    }

    const refRow = row as ReferralRow
    if (refRow.indicator_profile_id !== user.id) {
      devLogIndicacaoDetail("indicator_profile_id diferente do usuário")
      return { kind: "not-found" }
    }

    const { data: planRow, error: planError } = await db
      .from("plans")
      .select(
        "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
      )
      .eq("id", refRow.plan_id)
      .maybeSingle()

    devLogIndicacaoDetail("query plan", {
      error: planError?.message ?? null,
      code: planError?.code ?? null,
      hasRow: planRow != null,
    })

    if (planError) {
      devWarnIndicacaoDetailMock(
        `plans: ${planError.message} (${planError.code ?? "sem código"})`
      )
      return { kind: "error" }
    }

    const planoById = new Map<string, Plano>()
    if (planRow) {
      planoById.set(
        refRow.plan_id,
        mapPlanRowToPlano(planRow as PlanCatalogRow)
      )
    }

    const indicacao = referralRowToIndicacaoMerged(refRow, user.id, planoById)
    devLogIndicacaoDetail("sucesso", { id: indicacao.id })
    return { kind: "ok", indicacao }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devWarnIndicacaoDetailMock(`exceção: ${msg}`)
    return { kind: "error" }
  }
}
