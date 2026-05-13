import { getSupabaseClient } from "@/lib/supabase/client"
import { PAYMENT_RECEIPTS_BUCKET } from "@/lib/supabase/upload-payment-receipt"
import type { DashboardIndicador } from "@/types/dashboard"
import type { Historico, Lead, LeadStatus } from "@/types/lead"
import type {
  Comercial,
  ComercialDisponibilidade,
  Indicador,
  TipoChavePix,
} from "@/types/profile"
import type {
  Indicacao,
  IndicacaoStatus,
  MarkFirstInvoicePaidErrorCode,
  MarkFirstInvoicePaidResult,
  RecompensaTipo,
} from "@/types/referral"
import type { UserRole } from "@/types/user"
import type { Pagamento, PagamentoKind, PagamentoStatus } from "@/types/payment"
import type { Plano } from "@/types/plan"
import type { NotificationItem } from "@/types/notification"
import type { AuthProfileBasics } from "@/types/auth-profile"

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
  first_invoice_paid_at: string | null
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
  assigned_at?: string | null
  first_response_at?: string | null
  last_interaction_at?: string | null
  redistribution_count?: number
  admin_alerted?: boolean
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
    dataPrimeiraFaturaPaga: row.first_invoice_paid_at
      ? new Date(row.first_invoice_paid_at)
      : undefined,
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
    dataPrimeiraFaturaPaga: row.first_invoice_paid_at
      ? new Date(row.first_invoice_paid_at)
      : undefined,
    dataAprovacao: row.approved_at ? new Date(row.approved_at) : undefined,
    dataRecusa: row.rejected_at ? new Date(row.rejected_at) : undefined,
    motivoRecusa: row.rejection_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/** Perfil mínimo para tabelas admin (lista de indicações). */
function stubIndicadorFromAdminProfile(
  id: string,
  p: {
    full_name: string
    email: string
    phone: string
    cpf?: string | null
    is_active: boolean
    created_at: string
  }
): Indicador {
  return {
    id,
    nome: p.full_name,
    email: p.email,
    telefone: p.phone ?? "",
    role: "indicador",
    cpf: p.cpf ?? undefined,
    ativo: p.is_active,
    createdAt: new Date(p.created_at),
    totalIndicacoes: 0,
    indicacoesAprovadas: 0,
    totalRecebido: 0,
    saldoDisponivel: 0,
    saldoDesconto: 0,
  }
}

function stubComercialFromAdminProfile(
  id: string,
  p: {
    full_name: string
    email: string
    phone: string
    is_active: boolean
    created_at: string
  }
): Comercial {
  return {
    id,
    nome: p.full_name,
    email: p.email,
    telefone: p.phone ?? "",
    role: "comercial",
    ativo: p.is_active,
    createdAt: new Date(p.created_at),
    disponibilidade: "disponivel",
    leadsAtivos: 0,
    vendasRealizadas: 0,
    tempoMedioPrimeiroContato: 0,
  }
}

function buildDashboardFromRows(
  referrals: ReferralRow[],
  rewards: RewardRow[],
  wallet: { saldoDisponivelFromLedger: number; totalCreditosWallet: number }
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

  const totalRecebido = wallet.totalCreditosWallet

  let totalAReceber = 0
  let recompensasPendentesCount = 0
  let recompensasDisponiveisCount = 0
  let valorRecompensasPendentes = 0
  let valorRecompensasDisponiveis = 0
  let saldoEmDesconto = 0
  for (const rw of rewards) {
    const amt = Number(rw.amount)
    if (rw.status === "pendente") {
      recompensasPendentesCount += 1
      valorRecompensasPendentes += amt
      totalAReceber += amt
    }
    if (rw.status === "disponivel" || rw.status === "solicitado") {
      recompensasDisponiveisCount += 1
      valorRecompensasDisponiveis += amt
      if (rw.reward_type === "desconto_fatura") saldoEmDesconto += amt
    }
  }

  const saldoDisponivel = wallet.saldoDisponivelFromLedger

  return {
    totalIndicacoes,
    emAndamento,
    aprovadas,
    recusadas,
    totalRecebido,
    totalAReceber,
    saldoDisponivel,
    saldoEmDesconto,
    recompensasPendentesCount,
    recompensasDisponiveisCount,
    valorRecompensasPendentes,
    valorRecompensasDisponiveis,
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
        first_invoice_paid_at,
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

    const { data: wtLatest, error: wtLatestError } = await supabase
      .from("wallet_transactions")
      .select("balance_after")
      .eq("indicator_profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    devLog("query wallet_transactions (último saldo)", {
      error: wtLatestError?.message ?? null,
      code: wtLatestError?.code ?? null,
      hasRow: wtLatest != null,
    })

    if (wtLatestError) {
      return devFail(
        `wallet_transactions (saldo) falhou: ${wtLatestError.message} (${wtLatestError.code ?? "sem código"})`
      )
    }

    const { data: wtCredits, error: wtCreditsError } = await supabase
      .from("wallet_transactions")
      .select("amount")
      .eq("indicator_profile_id", user.id)
      .eq("transaction_type", "credito")

    devLog("query wallet_transactions (créditos)", {
      error: wtCreditsError?.message ?? null,
      code: wtCreditsError?.code ?? null,
      rowCount: wtCredits?.length ?? 0,
    })

    if (wtCreditsError) {
      return devFail(
        `wallet_transactions (créditos) falhou: ${wtCreditsError.message} (${wtCreditsError.code ?? "sem código"})`
      )
    }

    const rewards = (rewData ?? []) as RewardRow[]

    const saldoDisponivelFromLedger = wtLatest
      ? Number((wtLatest as { balance_after: number | string }).balance_after)
      : 0

    let totalCreditosWallet = 0
    for (const row of wtCredits ?? []) {
      totalCreditosWallet += Number((row as { amount: number | string }).amount)
    }

    const dashboard = buildDashboardFromRows(referrals, rewards, {
      saldoDisponivelFromLedger,
      totalCreditosWallet,
    })
    const indicador = buildIndicadorFromProfile(row, referrals, dashboard)
    const recentIndicacoes = referrals
      .slice(0, 5)
      .map((r) => referralToIndicacao(r, user.id))

    if (isDev()) {
      devLastIndicadorHomeFailureReason = null
      devLog("sucesso: dados Supabase aplicados", {
        indicadorId: indicador.id,
        referrals: referrals.length,
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
 * Planos ativos do catálogo Supabase. Retorna `[]` quando a consulta ok e não há linhas;
 * `null` apenas em erro de rede/RLS/consulta.
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

    if (error) return null
    return ((data ?? []) as PlanCatalogRow[]).map(mapPlanRowToPlano)
  } catch {
    return null
  }
}

/** Catálogo completo de planos (admin). Mesma tabela `plans`, inclui inativos. */
export async function loadAdminPlansCatalogFromSupabase(): Promise<
  Plano[] | null
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { data, error } = await db
      .from("plans")
      .select(
        "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
      )
      .order("sort_order", { ascending: true })

    if (error) return null
    return ((data ?? []) as PlanCatalogRow[]).map(mapPlanRowToPlano)
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

const INDICADOR_INSERT_REFERRAL_LOG_PREFIX = "[indicador-insert-referral:supabase]"

function devLogInsertReferral(...args: unknown[]): void {
  if (!isDev()) return
  console.log(INDICADOR_INSERT_REFERRAL_LOG_PREFIX, ...args)
}

type ComercialAvailabilityRow = {
  commercial_profile_id: string
  created_at: string
}

type ActiveReferralCountRow = {
  commercial_profile_id: string | null
}

type ExpiredReferralSlaRow = {
  id: string
  commercial_profile_id: string | null
  status: string
  assigned_at: string | null
  first_response_at: string | null
  redistribution_count: number
  admin_alerted: boolean | null
}

type NotificationRow = {
  id: string
  profile_id: string
  notification_type: string
  title: string
  message: string
  data: Record<string, unknown> | null
  is_read: boolean
  created_at: string
}

const SLA_REDISTRIBUTION_LOG_PREFIX = "[sla-redistribution:supabase]"
const ADMIN_NOTIFICATIONS_LOG_PREFIX = "[admin-notifications:supabase]"

function devLogSlaRedistribution(...args: unknown[]): void {
  if (!isDev()) return
  console.log(SLA_REDISTRIBUTION_LOG_PREFIX, ...args)
}

function devLogAdminNotifications(...args: unknown[]): void {
  if (!isDev()) return
  console.log(ADMIN_NOTIFICATIONS_LOG_PREFIX, ...args)
}

function devWarnAdminNotifications(reason: string): void {
  if (!isDev()) return
  console.warn(ADMIN_NOTIFICATIONS_LOG_PREFIX, "fallback mock →", reason)
}

const ADMIN_ROLES_ALLOWED_NOTIFICATIONS = new Set([
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
])

export type AdminNotificationItem = {
  id: string
  title: string
  message: string
  type: string
  isRead: boolean
  createdAt: Date
  referralId?: string
}

export type AdminDashboardMetrics = {
  totalReferrals: number
  pendingReferrals: number
  inAttendanceReferrals: number
  approvedReferrals: number
  rejectedReferrals: number
  slaExpiredReferrals: number
  unreadNotifications: number
  totalCommercials: number
  availableCommercials: number
  todayReferrals: number
  totalIndicators: number
  activeIndicators: number
  pendingPaymentsValue: number
  pendingPaymentsCount: number
  totalPaidValue: number
  monthlyData: Array<{
    mes: string
    indicacoes: number
    conversoes: number
  }>
  topIndicadores: Array<{
    nome: string
    conversoes: number
    total: number
  }>
}

export type ProcessExpiredLeadAssignmentsResult = {
  ok: true
  scanned: number
  redistributed: number
  alerted: number
  skipped: number
}
export type ProcessExpiredLeadAssignmentsError = {
  ok: false
  message: string
}

export async function processExpiredLeadAssignments(): Promise<
  ProcessExpiredLeadAssignmentsResult | ProcessExpiredLeadAssignmentsError
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    devLogSlaRedistribution("auth.getUser", {
      hasUser: Boolean(user && !authError),
      userId: user?.id ?? null,
      authError: authError?.message ?? null,
    })

    if (authError || !user) {
      return {
        ok: false,
        message: "Sessão não encontrada para processar redistribuição SLA.",
      }
    }

    const cutoffIso = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { data: expiredRows, error: expiredError } = await db
      .from("referrals")
      .select(
        "id, commercial_profile_id, status, assigned_at, first_response_at, redistribution_count, admin_alerted"
      )
      .eq("status", "em_atendimento")
      .is("first_response_at", null)
      .lt("assigned_at", cutoffIso)
      .eq("redistribution_count", 0)

    devLogSlaRedistribution("leads vencidos por SLA", {
      cutoffIso,
      error: expiredError?.message ?? null,
      code: expiredError?.code ?? null,
      rowCount: expiredRows?.length ?? 0,
      rows: expiredRows ?? [],
    })

    if (expiredError) {
      return {
        ok: false,
        message:
          expiredError.message ||
          "Falha ao consultar leads vencidos por SLA.",
      }
    }

    const expired = (expiredRows ?? []) as ExpiredReferralSlaRow[]
    devLogSlaRedistribution("quantidade de leads vencidos", expired.length)

    let redistributed = 0
    let alerted = 0
    let skipped = 0

    for (const lead of expired) {
      const currentCommercialId = lead.commercial_profile_id
      const { data: availableRows, error: availableError } = await db
        .from("commercial_availability")
        .select("commercial_profile_id, created_at")
        .eq("availability_status", "disponivel")
        .order("created_at", { ascending: true })

      devLogSlaRedistribution("comerciais disponíveis para lead", {
        referralId: lead.id,
        currentCommercialId,
        error: availableError?.message ?? null,
        code: availableError?.code ?? null,
        rowCount: availableRows?.length ?? 0,
      })

      if (availableError) {
        skipped += 1
        continue
      }

      const candidates = ((availableRows ?? []) as ComercialAvailabilityRow[]).filter(
        (row) => row.commercial_profile_id !== currentCommercialId
      )
      const newCommercialId = candidates[0]?.commercial_profile_id ?? null

      devLogSlaRedistribution("comercial anterior/novo", {
        referralId: lead.id,
        previousCommercialId: currentCommercialId,
        newCommercialId,
      })

      if (newCommercialId) {
        const nowIso = new Date().toISOString()
        const { data: updateRows, error: updateError } = await db
          .from("referrals")
          .update({
            commercial_profile_id: newCommercialId,
            assigned_at: nowIso,
            last_interaction_at: nowIso,
            redistribution_count: (lead.redistribution_count ?? 0) + 1,
            status: "em_atendimento",
          })
          .eq("id", lead.id)
          .select(
            "id, commercial_profile_id, assigned_at, last_interaction_at, redistribution_count, status"
          )

        devLogSlaRedistribution("resultado update redistribuição", {
          referralId: lead.id,
          error: updateError?.message ?? null,
          code: updateError?.code ?? null,
          rowCount: updateRows?.length ?? 0,
          rows: updateRows ?? [],
        })

        if (updateError) {
          skipped += 1
          continue
        }

        const { data: historyRows, error: historyError } = await db
          .from("referral_history")
          .insert({
            referral_id: lead.id,
            actor_profile_id: user.id,
            old_status: "em_atendimento",
            new_status: "em_atendimento",
            action_note: "Lead redistribuído automaticamente por SLA",
            metadata: {
              action: "sla_redistribution",
              previous_commercial_id: currentCommercialId,
              new_commercial_id: newCommercialId,
              reason: "no_response_15_minutes",
            },
          })
          .select(
            "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
          )

        devLogSlaRedistribution("resultado history redistribuição", {
          referralId: lead.id,
          error: historyError?.message ?? null,
          code: historyError?.code ?? null,
          rowCount: historyRows?.length ?? 0,
          rows: historyRows ?? [],
        })

        if (historyError) {
          skipped += 1
          continue
        }

        redistributed += 1
        continue
      }

      const { data: adminRows, error: adminsError } = await db
        .from("profiles")
        .select("id")
        .eq("role", "admin_master")

      devLogSlaRedistribution("resultado busca admins para alerta", {
        referralId: lead.id,
        error: adminsError?.message ?? null,
        code: adminsError?.code ?? null,
        rowCount: adminRows?.length ?? 0,
      })

      let notificationErrorMessage: string | null = null
      if (!adminsError && (adminRows?.length ?? 0) > 0) {
        const notificationsPayload = (adminRows ?? []).map((row: unknown) => {
          const admin = row as { id: string }
          return {
            profile_id: admin.id,
            notification_type: "sistema",
            title: "Lead vencido por SLA sem comercial disponível",
            message:
              "Um lead está sem resposta há mais de 15 minutos e não há comercial alternativo disponível para redistribuição.",
            data: {
              action: "sla_no_commercial_available",
              referral_id: lead.id,
              previous_commercial_id: currentCommercialId,
              reason: "no_response_15_minutes",
            },
          }
        })

        const { data: notificationRows, error: notificationError } = await db
          .from("notifications")
          .insert(notificationsPayload)
          .select("id, profile_id, notification_type, created_at")

        devLogSlaRedistribution("resultado notification/admin alert", {
          referralId: lead.id,
          error: notificationError?.message ?? null,
          code: notificationError?.code ?? null,
          rowCount: notificationRows?.length ?? 0,
          rows: notificationRows ?? [],
        })
        if (notificationError) {
          notificationErrorMessage = notificationError.message
        }
      }

      const { data: alertRows, error: alertError } = await db
        .from("referrals")
        .update({ admin_alerted: true })
        .eq("id", lead.id)
        .select("id, admin_alerted")

      devLogSlaRedistribution("resultado update admin_alerted", {
        referralId: lead.id,
        error: alertError?.message ?? null,
        code: alertError?.code ?? null,
        rowCount: alertRows?.length ?? 0,
        rows: alertRows ?? [],
      })

      const historyMetadata: Record<string, unknown> = {
        action: "sla_no_commercial_available",
      }
      if (notificationErrorMessage) {
        historyMetadata.notification_error = notificationErrorMessage
      }
      const { data: noCommercialHistoryRows, error: noCommercialHistoryError } = await db
        .from("referral_history")
        .insert({
          referral_id: lead.id,
          actor_profile_id: user.id,
          old_status: "em_atendimento",
          new_status: "em_atendimento",
          action_note: "Lead vencido por SLA sem comercial disponível",
          metadata: historyMetadata,
        })
        .select(
          "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
        )

      devLogSlaRedistribution("resultado history sem comercial", {
        referralId: lead.id,
        error: noCommercialHistoryError?.message ?? null,
        code: noCommercialHistoryError?.code ?? null,
        rowCount: noCommercialHistoryRows?.length ?? 0,
        rows: noCommercialHistoryRows ?? [],
      })

      if (alertError || noCommercialHistoryError) {
        skipped += 1
        continue
      }
      alerted += 1
    }

    devLogSlaRedistribution("resumo processamento", {
      scanned: expired.length,
      redistributed,
      alerted,
      skipped,
    })

    return {
      ok: true,
      scanned: expired.length,
      redistributed,
      alerted,
      skipped,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isDev()) {
      console.warn(SLA_REDISTRIBUTION_LOG_PREFIX, "exceção", { message: msg })
    }
    return {
      ok: false,
      message: "Erro inesperado ao processar redistribuição automática por SLA.",
    }
  }
}

export async function loadAdminNotificationsFromSupabase(): Promise<
  AdminNotificationItem[] | null
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    devLogAdminNotifications("auth.getUser", {
      hasUser: Boolean(user && !authError),
      userId: user?.id ?? null,
      authError: authError?.message ?? null,
    })

    if (authError || !user) {
      devWarnAdminNotifications(
        authError
          ? `sem sessão válida: ${authError.message}`
          : "sem usuário autenticado"
      )
      return null
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    devLogAdminNotifications("profile", {
      hasProfile: Boolean(profile && !profileError),
      role,
      error: profileError?.message ?? null,
      code: profileError?.code ?? null,
    })

    if (
      profileError ||
      !profile ||
      !role ||
      !ADMIN_ROLES_ALLOWED_NOTIFICATIONS.has(role)
    ) {
      devWarnAdminNotifications(
        profileError
          ? `profiles falhou: ${profileError.message} (${profileError.code ?? "sem código"})`
          : `role sem permissão para notificações admin: "${role}"`
      )
      return null
    }

    const { data: rows, error: notificationsError } = await db
      .from("notifications")
      .select(
        "id, profile_id, notification_type, title, message, data, is_read, created_at"
      )
      .order("created_at", { ascending: false })

    devLogAdminNotifications("query notifications", {
      error: notificationsError?.message ?? null,
      code: notificationsError?.code ?? null,
      rowCount: rows?.length ?? 0,
    })

    if (notificationsError) {
      devWarnAdminNotifications(
        `notifications falhou: ${notificationsError.message} (${notificationsError.code ?? "sem código"})`
      )
      return null
    }

    return (rows ?? []).map((raw: unknown) => {
      const row = raw as NotificationRow
      const referralIdRaw = row.data?.referral_id
      return {
        id: row.id,
        title: row.title,
        message: row.message,
        type: row.notification_type,
        isRead: row.is_read,
        createdAt: new Date(row.created_at),
        referralId:
          typeof referralIdRaw === "string" && referralIdRaw.trim() !== ""
            ? referralIdRaw
            : undefined,
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devWarnAdminNotifications(`exceção: ${msg}`)
    return null
  }
}

const ADMIN_DASHBOARD_LOG_PREFIX = "[admin-dashboard:supabase]"

function devLogAdminDashboard(...args: unknown[]): void {
  if (!isDev()) return
  console.log(ADMIN_DASHBOARD_LOG_PREFIX, ...args)
}

function devWarnAdminDashboard(reason: string): void {
  if (!isDev()) return
  console.warn(ADMIN_DASHBOARD_LOG_PREFIX, "fallback mock →", reason)
}

export async function loadAdminDashboardMetricsFromSupabase(): Promise<AdminDashboardMetrics | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    devLogAdminDashboard("auth.getUser", {
      hasUser: Boolean(user && !authError),
      userId: user?.id ?? null,
      authError: authError?.message ?? null,
    })

    if (authError || !user) {
      devWarnAdminDashboard(
        authError ? `sem sessão válida: ${authError.message}` : "sem usuário autenticado"
      )
      return null
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    devLogAdminDashboard("profile", {
      hasProfile: Boolean(profile && !profileError),
      role,
      error: profileError?.message ?? null,
      code: profileError?.code ?? null,
    })

    if (
      profileError ||
      !profile ||
      !role ||
      !ADMIN_ROLES_ALLOWED_NOTIFICATIONS.has(role)
    ) {
      devWarnAdminDashboard(
        profileError
          ? `profiles falhou: ${profileError.message} (${profileError.code ?? "sem código"})`
          : `role sem permissão para dashboard admin: "${role}"`
      )
      return null
    }

    const fetchCount = async (
      metricName: keyof AdminDashboardMetrics,
      buildQuery: () => ReturnType<typeof db.from>
    ): Promise<number | null> => {
      const { count, error } = await buildQuery()
      devLogAdminDashboard(`métrica ${metricName}`, {
        value: count ?? 0,
        error: error?.message ?? null,
        code: error?.code ?? null,
      })
      if (error) {
        devWarnAdminDashboard(
          `${metricName} falhou: ${error.message} (${error.code ?? "sem código"})`
        )
        return null
      }
      return count ?? 0
    }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const startOfTomorrow = new Date(startOfToday)
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
    const slaCutoffIso = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const totalReferrals = await fetchCount("totalReferrals", () =>
      db.from("referrals").select("id", { count: "exact", head: true })
    )
    if (totalReferrals === null) return null

    const pendingReferrals = await fetchCount("pendingReferrals", () =>
      db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente")
    )
    if (pendingReferrals === null) return null

    const inAttendanceReferrals = await fetchCount("inAttendanceReferrals", () =>
      db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "em_atendimento")
    )
    if (inAttendanceReferrals === null) return null

    const approvedReferrals = await fetchCount("approvedReferrals", () =>
      db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "aprovada")
    )
    if (approvedReferrals === null) return null

    const rejectedReferrals = await fetchCount("rejectedReferrals", () =>
      db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "recusada")
    )
    if (rejectedReferrals === null) return null

    const slaExpiredReferrals = await fetchCount("slaExpiredReferrals", () =>
      db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "em_atendimento")
        .is("first_response_at", null)
        .lt("assigned_at", slaCutoffIso)
    )
    if (slaExpiredReferrals === null) return null

    const unreadNotifications = await fetchCount("unreadNotifications", () =>
      db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false)
    )
    if (unreadNotifications === null) return null

    const { data: roleRows, error: roleRowsError } = await db
      .from("profiles")
      .select("id, role")
    devLogAdminDashboard("profiles roles (raw)", {
      rowCount: roleRows?.length ?? 0,
      error: roleRowsError?.message ?? null,
      code: roleRowsError?.code ?? null,
    })
    if (roleRowsError) {
      devWarnAdminDashboard(
        `profiles roles falhou: ${roleRowsError.message} (${roleRowsError.code ?? "sem código"})`
      )
      return null
    }
    const profileRows = (roleRows ?? []) as Array<{ id: string; role: string }>
    const roleDistribution = profileRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.role] = (acc[row.role] ?? 0) + 1
      return acc
    }, {})
    devLogAdminDashboard("profiles role distribution", roleDistribution)
    const commercialIdsByRole = new Set(
      profileRows.filter((p) => p.role === "comercial").map((p) => p.id)
    )

    const { data: availabilityRows, error: availabilityError } = await db
      .from("commercial_availability")
      .select("commercial_profile_id, availability_status")
    devLogAdminDashboard("commercial_availability (raw)", {
      rowCount: availabilityRows?.length ?? 0,
      error: availabilityError?.message ?? null,
      code: availabilityError?.code ?? null,
    })
    if (availabilityError) {
      devWarnAdminDashboard(
        `commercial_availability falhou: ${availabilityError.message} (${availabilityError.code ?? "sem código"})`
      )
      return null
    }
    const availabilityList = (availabilityRows ?? []) as Array<{
      commercial_profile_id: string
      availability_status: string
    }>
    const allAvailabilityCommercialIds = new Set(
      availabilityList.map((row) => row.commercial_profile_id)
    )
    const availableCommercialIds = new Set(
      availabilityList
        .filter((row) => row.availability_status === "disponivel")
        .map((row) => row.commercial_profile_id)
    )

    const totalCommercialIds = new Set([
      ...commercialIdsByRole,
      ...allAvailabilityCommercialIds,
    ])
    const totalCommercials = totalCommercialIds.size
    const availableCommercials = availableCommercialIds.size
    devLogAdminDashboard("métrica totalCommercials", totalCommercials)
    devLogAdminDashboard("métrica availableCommercials", availableCommercials)

    const todayReferrals = await fetchCount("todayReferrals", () =>
      db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfToday.toISOString())
        .lt("created_at", startOfTomorrow.toISOString())
    )
    if (todayReferrals === null) return null

    const totalIndicators = await fetchCount("totalIndicators", () =>
      db
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "indicador")
    )
    if (totalIndicators === null) return null

    const activeIndicators = await fetchCount("activeIndicators", () =>
      db
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "indicador")
        .eq("is_active", true)
    )
    if (activeIndicators === null) return null

    const { data: paymentRows, error: paymentError } = await db
      .from("payments")
      .select("amount, status")
    devLogAdminDashboard("métrica payments (raw)", {
      rowCount: paymentRows?.length ?? 0,
      error: paymentError?.message ?? null,
      code: paymentError?.code ?? null,
    })
    if (paymentError) {
      devWarnAdminDashboard(
        `payments falhou: ${paymentError.message} (${paymentError.code ?? "sem código"})`
      )
      return null
    }
    const paymentList = (paymentRows ?? []) as PaymentRow[]
    const pendingPayments = paymentList.filter((p) => p.status === "pendente")
    const pendingPaymentsValue = pendingPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    )
    const pendingPaymentsCount = pendingPayments.length
    const totalPaidValue = paymentList
      .filter((p) => p.status === "pago")
      .reduce((sum, p) => sum + Number(p.amount), 0)
    devLogAdminDashboard("métrica pendingPaymentsValue", pendingPaymentsValue)
    devLogAdminDashboard("métrica pendingPaymentsCount", pendingPaymentsCount)
    devLogAdminDashboard("métrica totalPaidValue", totalPaidValue)

    const { data: referralRows, error: referralError } = await db
      .from("referrals")
      .select("created_at, status, indicator_profile_id")
      .order("created_at", { ascending: false })
    devLogAdminDashboard("métrica referrals para gráficos", {
      rowCount: referralRows?.length ?? 0,
      error: referralError?.message ?? null,
      code: referralError?.code ?? null,
    })
    if (referralError) {
      devWarnAdminDashboard(
        `referrals para gráficos falhou: ${referralError.message} (${referralError.code ?? "sem código"})`
      )
      return null
    }

    const now = new Date()
    const monthLabels = Array.from({ length: 6 }).map((_, index) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        mes: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      }
    })
    const monthlyAccumulator = new Map(
      monthLabels.map((m) => [m.key, { mes: m.mes, indicacoes: 0, conversoes: 0 }])
    )

    const indicatorAgg = new Map<string, { total: number; conversoes: number }>()
    for (const row of (referralRows ?? []) as Array<{
      created_at: string
      status: string
      indicator_profile_id: string
    }>) {
      const created = new Date(row.created_at)
      const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`
      const monthEntry = monthlyAccumulator.get(monthKey)
      if (monthEntry) {
        monthEntry.indicacoes += 1
        if (row.status === "aprovada") {
          monthEntry.conversoes += 1
        }
      }

      const current = indicatorAgg.get(row.indicator_profile_id) ?? { total: 0, conversoes: 0 }
      current.total += 1
      if (row.status === "aprovada") {
        current.conversoes += 1
      }
      indicatorAgg.set(row.indicator_profile_id, current)
    }

    const indicatorIds = [...indicatorAgg.keys()]
    let indicatorNameById = new Map<string, string>()
    if (indicatorIds.length > 0) {
      const { data: indicatorProfiles, error: indicatorProfilesError } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", indicatorIds)

      devLogAdminDashboard("métrica topIndicadores/profile names", {
        rowCount: indicatorProfiles?.length ?? 0,
        error: indicatorProfilesError?.message ?? null,
        code: indicatorProfilesError?.code ?? null,
      })
      if (indicatorProfilesError) {
        devWarnAdminDashboard(
          `profiles para topIndicadores falhou: ${indicatorProfilesError.message} (${indicatorProfilesError.code ?? "sem código"})`
        )
        return null
      }

      indicatorNameById = new Map(
        (indicatorProfiles ?? []).map((p: unknown) => {
          const row = p as { id: string; full_name: string }
          return [row.id, row.full_name]
        })
      )
    }

    const monthlyData = monthLabels.map(
      (m) => monthlyAccumulator.get(m.key) ?? { mes: m.mes, indicacoes: 0, conversoes: 0 }
    )
    const topIndicadores = [...indicatorAgg.entries()]
      .sort((a, b) => b[1].conversoes - a[1].conversoes || b[1].total - a[1].total)
      .slice(0, 5)
      .map(([id, agg]) => {
        const nomeCompleto = indicatorNameById.get(id) ?? "Indicador"
        return {
          nome: nomeCompleto.split(" ")[0] ?? "Indicador",
          conversoes: agg.conversoes,
          total: agg.total,
        }
      })

    devLogAdminDashboard("métrica monthlyData", monthlyData)
    devLogAdminDashboard("métrica topIndicadores", topIndicadores)

    return {
      totalReferrals,
      pendingReferrals,
      inAttendanceReferrals,
      approvedReferrals,
      rejectedReferrals,
      slaExpiredReferrals,
      unreadNotifications,
      totalCommercials,
      availableCommercials,
      todayReferrals,
      totalIndicators,
      activeIndicators,
      pendingPaymentsValue,
      pendingPaymentsCount,
      totalPaidValue,
      monthlyData,
      topIndicadores,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devWarnAdminDashboard(`exceção: ${msg}`)
    return null
  }
}

export async function markNotificationAsRead(
  notificationId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    devLogAdminNotifications("markAsRead auth.getUser", {
      hasUser: Boolean(user && !authError),
      userId: user?.id ?? null,
      authError: authError?.message ?? null,
      notificationId,
    })

    if (authError || !user) {
      return { ok: false, message: "Sessão inválida. Faça login novamente." }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    if (
      profileError ||
      !profile ||
      !role ||
      !ADMIN_ROLES_ALLOWED_NOTIFICATIONS.has(role)
    ) {
      return {
        ok: false,
        message: "Acesso negado para marcar notificação como lida.",
      }
    }

    const { data: updatedRows, error: updateError } = await db
      .from("notifications")
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("id", notificationId)
      .select("id, is_read, read_at")

    devLogAdminNotifications("resultado markAsRead", {
      notificationId,
      error: updateError?.message ?? null,
      code: updateError?.code ?? null,
      rowCount: updatedRows?.length ?? 0,
      rows: updatedRows ?? [],
    })

    if (updateError) {
      return {
        ok: false,
        message:
          updateError.message || "Não foi possível marcar a notificação como lida.",
      }
    }

    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg }
  }
}

/**
 * Insere uma indicação para o usuário autenticado. Não usa DATA_PROVIDER.
 */
export async function insertIndicadorReferral(
  input: InsertIndicadorReferralInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    devLogInsertReferral("início")

    const supabase = getSupabaseClient()
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()

    devLogInsertReferral("auth.getUser", {
      hasUser: Boolean(user && !authErr),
      userId: user?.id ?? null,
      authError: authErr?.message ?? null,
    })

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

    const availabilityStatusValue = "disponivel"
    // No schema local usamos availability_status='disponivel' como equivalente de is_available=true.
    const { data: comercialRows, error: comercialError } = await db
      .from("commercial_availability")
      .select("commercial_profile_id, created_at")
      .eq("availability_status", availabilityStatusValue)
      .order("created_at", { ascending: true })

    devLogInsertReferral("resultado bruto query commercial_availability", {
      filter: { availability_status: availabilityStatusValue },
      error: comercialError?.message ?? null,
      code: comercialError?.code ?? null,
      rowCount: comercialRows?.length ?? 0,
      rawRows: comercialRows ?? [],
    })

    if (comercialError) {
      return {
        ok: false,
        message: comercialError.message || "Não foi possível selecionar comercial disponível.",
      }
    }

    const availableRows = (comercialRows ?? []) as ComercialAvailabilityRow[]
    devLogInsertReferral("quantidade comerciais disponíveis", {
      count: availableRows.length,
    })
    if (availableRows.length === 0) {
      devLogInsertReferral(
        "nenhum comercial disponível visível (possível efeito de RLS para usuário indicador)"
      )
    }

    const availableIds = availableRows.map((row) => row.commercial_profile_id)

    const leadCountByComercial = new Map<string, number>()
    if (availableIds.length > 0) {
      const { data: activeReferrals, error: activeReferralsError } = await db
        .from("referrals")
        .select("commercial_profile_id")
        .in("commercial_profile_id", availableIds)
        .in("status", ["em_atendimento", "pendente", "aprovada"])

      devLogInsertReferral("contagem de leads por comercial (linhas ativas)", {
        error: activeReferralsError?.message ?? null,
        code: activeReferralsError?.code ?? null,
        rowCount: activeReferrals?.length ?? 0,
      })

      if (activeReferralsError) {
        return {
          ok: false,
          message:
            activeReferralsError.message ||
            "Não foi possível calcular carga de leads dos comerciais.",
        }
      }

      for (const id of availableIds) {
        leadCountByComercial.set(id, 0)
      }
      for (const raw of (activeReferrals ?? []) as ActiveReferralCountRow[]) {
        if (!raw.commercial_profile_id) continue
        const current = leadCountByComercial.get(raw.commercial_profile_id) ?? 0
        leadCountByComercial.set(raw.commercial_profile_id, current + 1)
      }
    }

    devLogInsertReferral("contagem consolidada de leads por comercial", {
      counts: availableRows.map((row) => ({
        commercial_profile_id: row.commercial_profile_id,
        active_leads: leadCountByComercial.get(row.commercial_profile_id) ?? 0,
        created_at: row.created_at,
      })),
    })

    const selectedCommercial = [...availableRows].sort((a, b) => {
      const countA = leadCountByComercial.get(a.commercial_profile_id) ?? 0
      const countB = leadCountByComercial.get(b.commercial_profile_id) ?? 0
      if (countA !== countB) return countA - countB

      const createdAtCompare = a.created_at.localeCompare(b.created_at)
      if (createdAtCompare !== 0) return createdAtCompare
      return a.commercial_profile_id.localeCompare(b.commercial_profile_id)
    })[0]

    const selectedCommercialId = selectedCommercial?.commercial_profile_id ?? null
    const referralStatus = selectedCommercialId ? "em_atendimento" : "pendente"

    devLogInsertReferral("comercial selecionado", {
      selectedCommercialId,
      selectedActiveLeadCount: selectedCommercialId
        ? (leadCountByComercial.get(selectedCommercialId) ?? 0)
        : null,
      referralStatus,
    })

    const nowIso = new Date().toISOString()
    const insertPayload = {
      indicator_profile_id: user.id,
      referred_name: input.referred_name.trim(),
      referred_phone: input.referred_phone.trim(),
      referred_email: email,
      referred_address: address,
      plan_id: input.plan_id,
      reward_type: input.reward_type,
      reward_amount: input.reward_amount,
      commercial_profile_id: selectedCommercialId,
      status: referralStatus,
      assigned_at: selectedCommercialId ? nowIso : null,
      last_interaction_at: selectedCommercialId ? nowIso : null,
    }
    devLogInsertReferral("payload final do insert", insertPayload)
    devLogInsertReferral("campos SLA no insert", {
      assigned_at: insertPayload.assigned_at,
      first_response_at: null,
      last_interaction_at: insertPayload.last_interaction_at,
      redistribution_count: 0,
      admin_alerted: false,
    })

    const { data: insertedRows, error: insertError } = await db
      .from("referrals")
      .insert(insertPayload)
      .select(
        "id, commercial_profile_id, status, assigned_at, first_response_at, last_interaction_at, redistribution_count, admin_alerted"
      )

    devLogInsertReferral("resultado insert referrals", {
      error: insertError?.message ?? null,
      code: insertError?.code ?? null,
      rowCount: insertedRows?.length ?? 0,
      rows: insertedRows ?? [],
    })
    devLogInsertReferral("resultado insert referrals (campos SLA)", {
      sla: (insertedRows ?? []).map((row: unknown) => {
        const r = row as {
          id: string
          assigned_at?: string | null
          first_response_at?: string | null
          last_interaction_at?: string | null
          redistribution_count?: number
          admin_alerted?: boolean
        }
        return {
          id: r.id,
          assigned_at: r.assigned_at ?? null,
          first_response_at: r.first_response_at ?? null,
          last_interaction_at: r.last_interaction_at ?? null,
          redistribution_count: r.redistribution_count ?? null,
          admin_alerted: r.admin_alerted ?? null,
        }
      }),
    })

    if (insertError) {
      return {
        ok: false,
        message: insertError.message || "Não foi possível cadastrar a indicação.",
      }
    }

    const insertedReferralId =
      (insertedRows?.[0] as { id: string } | undefined)?.id ?? null

    if (insertedReferralId && selectedCommercialId) {
      const { data: histRows, error: histError } = await db
        .from("referral_history")
        .insert({
          referral_id: insertedReferralId,
          actor_profile_id: selectedCommercialId,
          old_status: "pendente",
          new_status: "em_atendimento",
          action_note: "Lead atribuído automaticamente",
          metadata: {
            action: "auto_assign",
            strategy: "least_active_leads",
            selected_commercial_id: selectedCommercialId,
          },
        })
        .select("id, referral_id, old_status, new_status, action_note, metadata")

      devLogInsertReferral("resultado insert referral_history", {
        error: histError?.message ?? null,
        code: histError?.code ?? null,
        rowCount: histRows?.length ?? 0,
        rows: histRows ?? [],
      })

      if (histError) {
        return {
          ok: false,
          message:
            histError.message ||
            "Indicação criada, mas não foi possível registrar o histórico.",
        }
      }
    } else {
      devLogInsertReferral("sem autoatribuição; histórico não criado", {
        insertedReferralId,
        selectedCommercialId,
      })
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
        first_invoice_paid_at,
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

// --- Admin: indicações e indicadores (lista global) -------------------------------

const ADMIN_PORTAL_READ_ROLES = new Set([
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
])

type AdminProfileShortRow = {
  id: string
  full_name: string
  email: string
  phone: string
  cpf: string | null
  is_active: boolean
  created_at: string
}

type ReferralHistoryRow = {
  id: string
  referral_id: string
  actor_profile_id: string | null
  old_status: string | null
  new_status: string
  action_note: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

/**
 * Todas as indicações (admin). Dados reais do Supabase; `null` só em erro / sem permissão.
 */
export async function loadAdminReferralsFromSupabase(): Promise<Indicacao[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PORTAL_READ_ROLES.has(role)) {
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
        first_invoice_paid_at,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at,
        updated_at
      `
      )
      .order("created_at", { ascending: false })
      .limit(2000)

    if (isDev()) {
      console.log("[admin-indicacoes:supabase] raw", { data: refData, error: refError })
    }

    if (refError) {
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

      if (plansError) {
        return null
      }
      for (const pr of plansData ?? []) {
        const p = mapPlanRowToPlano(pr as PlanCatalogRow)
        planoById.set(p.id, p)
      }
    }

    const profileIds = new Set<string>()
    for (const r of referrals) {
      profileIds.add(r.indicator_profile_id)
      if (r.commercial_profile_id) profileIds.add(r.commercial_profile_id)
    }
    const profileList = [...profileIds]

    const profileMap = new Map<string, AdminProfileShortRow>()
    if (profileList.length > 0) {
      const { data: profData, error: profError } = await db
        .from("profiles")
        .select("id, full_name, email, phone, cpf, is_active, created_at")
        .in("id", profileList)

      if (profError) {
        return null
      }
      for (const pr of (profData ?? []) as AdminProfileShortRow[]) {
        profileMap.set(pr.id, pr)
      }
    }

    const mapped: Indicacao[] = referrals.map((r) => {
      const base = referralRowToIndicacaoMerged(r, r.indicator_profile_id, planoById)
      const ip = profileMap.get(r.indicator_profile_id)
      const cp = r.commercial_profile_id
        ? profileMap.get(r.commercial_profile_id)
        : undefined
      return {
        ...base,
        indicador: ip
          ? stubIndicadorFromAdminProfile(ip.id, {
              full_name: ip.full_name,
              email: ip.email,
              phone: ip.phone,
              cpf: ip.cpf,
              is_active: ip.is_active,
              created_at: ip.created_at,
            })
          : undefined,
        comercial:
          cp && r.commercial_profile_id
            ? stubComercialFromAdminProfile(r.commercial_profile_id, {
                full_name: cp.full_name,
                email: cp.email,
                phone: cp.phone,
                is_active: cp.is_active,
                created_at: cp.created_at,
              })
            : undefined,
      }
    })

    if (isDev()) {
      console.log("[admin-indicacoes:supabase] mapped", mapped)
    }

    return mapped
  } catch {
    return null
  }
}

/**
 * Perfis indicador (admin). `null` só em erro / sem permissão.
 */
export async function loadAdminIndicatorsFromSupabase(): Promise<Indicador[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PORTAL_READ_ROLES.has(role)) {
      return null
    }

    const { data: profilesData, error: profErr } = await db
      .from("profiles")
      .select("id, full_name, email, phone, cpf, is_active, created_at, role")
      .eq("role", "indicador")
      .order("created_at", { ascending: false })

    if (isDev()) {
      console.log("[admin-indicadores:supabase] profiles", { data: profilesData, error: profErr })
    }

    if (profErr) {
      return null
    }

    const profs = (profilesData ?? []) as AdminProfileShortRow[]
    const ids = profs.map((p) => p.id)

    const countMap = new Map<string, { total: number; aprovadas: number }>()
    for (const id of ids) {
      countMap.set(id, { total: 0, aprovadas: 0 })
    }

    if (ids.length > 0) {
      const { data: refRows, error: refErr } = await db
        .from("referrals")
        .select("indicator_profile_id, status")
        .in("indicator_profile_id", ids)

      if (refErr) {
        return null
      }
      for (const row of (refRows ?? []) as { indicator_profile_id: string; status: string }[]) {
        const cur = countMap.get(row.indicator_profile_id) ?? { total: 0, aprovadas: 0 }
        cur.total += 1
        if (row.status === "aprovada" || row.status === "paga") cur.aprovadas += 1
        countMap.set(row.indicator_profile_id, cur)
      }
    }

    const balanceMap = new Map<string, number>()
    if (ids.length > 0) {
      const { data: txs, error: txErr } = await db
        .from("wallet_transactions")
        .select("indicator_profile_id, balance_after, created_at")
        .in("indicator_profile_id", ids)
        .order("created_at", { ascending: false })

      if (!txErr && txs) {
        for (const t of txs as {
          indicator_profile_id: string
          balance_after: number | string
        }[]) {
          if (!balanceMap.has(t.indicator_profile_id)) {
            balanceMap.set(t.indicator_profile_id, Number(t.balance_after))
          }
        }
      }
    }

    const mapped: Indicador[] = profs.map((p) => {
      const counts = countMap.get(p.id) ?? { total: 0, aprovadas: 0 }
      return {
        id: p.id,
        nome: p.full_name,
        email: p.email,
        telefone: p.phone ?? "",
        role: "indicador",
        cpf: p.cpf ?? undefined,
        ativo: p.is_active,
        createdAt: new Date(p.created_at),
        totalIndicacoes: counts.total,
        indicacoesAprovadas: counts.aprovadas,
        totalRecebido: 0,
        saldoDisponivel: balanceMap.get(p.id) ?? 0,
        saldoDesconto: 0,
      }
    })

    if (isDev()) {
      console.log("[admin-indicadores:supabase] mapped", mapped)
    }

    return mapped
  } catch {
    return null
  }
}

const REFERRAL_ACTIVE_FOR_COMMERCIAL_STATS = new Set([
  "pendente",
  "em_andamento",
  "em_atendimento",
  "em_negociacao",
])

/**
 * Perfis comercial (admin). `null` só em erro / sem permissão.
 */
export async function loadAdminComerciaisFromSupabase(): Promise<Comercial[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PORTAL_READ_ROLES.has(role)) {
      return null
    }

    const { data: profilesData, error: profErr } = await db
      .from("profiles")
      .select("id, full_name, email, phone, is_active, created_at, updated_at")
      .eq("role", "comercial")
      .order("created_at", { ascending: false })

    if (profErr) {
      return null
    }

    const profs = (profilesData ?? []) as {
      id: string
      full_name: string
      email: string
      phone: string
      is_active: boolean
      created_at: string
      updated_at: string
    }[]
    const ids = profs.map((p) => p.id)

    const availabilityMap = new Map<string, ComercialDisponibilidade>()
    if (ids.length > 0) {
      const { data: avRows, error: avErr } = await db
        .from("commercial_availability")
        .select("commercial_profile_id, availability_status, updated_at")
        .in("commercial_profile_id", ids)
        .order("updated_at", { ascending: false })

      if (!avErr && avRows) {
        for (const row of avRows as {
          commercial_profile_id: string
          availability_status: ComercialDisponibilidade
          updated_at: string
        }[]) {
          if (!availabilityMap.has(row.commercial_profile_id)) {
            availabilityMap.set(row.commercial_profile_id, row.availability_status)
          }
        }
      }
    }

    const statsMap = new Map<string, { ativos: number; vendas: number }>()
    for (const id of ids) {
      statsMap.set(id, { ativos: 0, vendas: 0 })
    }

    if (ids.length > 0) {
      const { data: refRows, error: refErr } = await db
        .from("referrals")
        .select("commercial_profile_id, status")
        .in("commercial_profile_id", ids)

      if (refErr) {
        return null
      }
      for (const row of (refRows ?? []) as {
        commercial_profile_id: string | null
        status: string
      }[]) {
        const cid = row.commercial_profile_id
        if (!cid) continue
        const cur = statsMap.get(cid) ?? { ativos: 0, vendas: 0 }
        if (row.status === "aprovada" || row.status === "paga") {
          cur.vendas += 1
        } else if (REFERRAL_ACTIVE_FOR_COMMERCIAL_STATS.has(row.status)) {
          cur.ativos += 1
        }
        statsMap.set(cid, cur)
      }
    }

    const mapped: Comercial[] = profs.map((p) => {
      const stats = statsMap.get(p.id) ?? { ativos: 0, vendas: 0 }
      const disp: ComercialDisponibilidade =
        availabilityMap.get(p.id) ?? (p.is_active ? "disponivel" : "offline")
      return {
        id: p.id,
        nome: p.full_name,
        email: p.email,
        telefone: p.phone,
        role: "comercial",
        ativo: p.is_active,
        createdAt: new Date(p.created_at),
        updatedAt: new Date(p.updated_at),
        disponibilidade: disp,
        leadsAtivos: stats.ativos,
        vendasRealizadas: stats.vendas,
        tempoMedioPrimeiroContato: 0,
      }
    })

    return mapped
  } catch {
    return null
  }
}

/**
 * Último status de disponibilidade do comercial logado (`commercial_availability`).
 */
export async function loadComercialAvailabilityStatusFromSupabase(): Promise<ComercialDisponibilidade | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    if (profileError || !profile) return null
    if ((profile as { role: string }).role !== "comercial") return null

    const { data: row, error } = await db
      .from("commercial_availability")
      .select("availability_status")
      .eq("commercial_profile_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return null
    }
    if (!row) return null
    return (row as { availability_status: ComercialDisponibilidade })
      .availability_status
  } catch {
    return null
  }
}

/**
 * Histórico de `referral_history` para todos os leads atribuídos ao comercial logado.
 */
export async function loadComercialAssignedHistoryFromSupabase(): Promise<
  Historico[] | null
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    if (profileError || !profile) return null
    if ((profile as { role: string }).role !== "comercial") return null

    const { data: refRows, error: refErr } = await db
      .from("referrals")
      .select("id")
      .eq("commercial_profile_id", user.id)
      .limit(500)

    if (refErr) {
      return null
    }

    const refIds = (refRows ?? []).map((r: { id: string }) => r.id)
    if (refIds.length === 0) {
      return []
    }

    const { data: historyRows, error: historyError } = await db
      .from("referral_history")
      .select(
        "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
      )
      .in("referral_id", refIds)
      .order("created_at", { ascending: false })
      .limit(300)

    if (historyError) {
      return null
    }

    const actorIds = [
      ...new Set(
        (historyRows ?? [])
          .map((h: unknown) => (h as ReferralHistoryRow).actor_profile_id)
          .filter((id: string | null): id is string => Boolean(id))
      ),
    ]

    const actorById = new Map<string, { full_name: string; phone: string | null }>()
    if (actorIds.length > 0) {
      const { data: actorRows, error: actorError } = await db
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", actorIds)
      if (actorError) {
        return null
      }
      for (const row of actorRows ?? []) {
        const actor = row as { id: string; full_name: string; phone: string | null }
        actorById.set(actor.id, {
          full_name: actor.full_name,
          phone: actor.phone,
        })
      }
    }

    const historico: Historico[] = (historyRows ?? []).map((raw: unknown) => {
      const h = raw as ReferralHistoryRow
      const actor = h.actor_profile_id ? actorById.get(h.actor_profile_id) : null
      const acaoBase = h.action_note?.trim() || "Atualização de lead"
      const descricaoStatus =
        h.old_status && h.old_status !== h.new_status
          ? `Status: ${h.old_status} -> ${h.new_status}`
          : `Status: ${h.new_status}`
      const metadataAction =
        h.metadata && typeof h.metadata.action === "string"
          ? `Ação: ${h.metadata.action}`
          : null

      return {
        id: h.id,
        leadId: h.referral_id,
        comercialId: h.actor_profile_id ?? "",
        comercial: h.actor_profile_id
          ? stubComercialProfile(
              h.actor_profile_id,
              actor?.full_name ?? "Comercial",
              actor?.phone ?? ""
            )
          : undefined,
        acao: acaoBase,
        descricao: [descricaoStatus, metadataAction].filter(Boolean).join(" • "),
        createdAt: new Date(h.created_at),
      }
    })

    if (isDev()) {
      console.log("[supabase-query:debug]", {
        query: "loadComercialAssignedHistoryFromSupabase",
        rows: historico.length,
      })
    }

    return historico
  } catch {
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
        first_invoice_paid_at,
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

// --- Comercial /comercial/leads ---------------------------------------------------

const COMERCIAL_LEADS_LOG_PREFIX = "[comercial-leads:supabase]"

function devLogComercialLeads(...args: unknown[]): void {
  if (!isDev()) return
  console.log(COMERCIAL_LEADS_LOG_PREFIX, ...args)
}

function devWarnComercialLeadsMock(reason: string): void {
  if (isDev()) {
    console.warn(COMERCIAL_LEADS_LOG_PREFIX, "fallback mock →", reason)
  }
}

function referralStatusToLeadStatus(status: string): LeadStatus {
  switch (status) {
    case "em_atendimento":
      return "em_atendimento"
    case "em_negociacao":
      return "em_negociacao"
    case "aprovada":
    case "paga":
      return "vendido"
    case "recusada":
      return "perdido"
    case "em_andamento":
      return "em_atendimento"
    case "pendente":
    default:
      return "novo"
  }
}

function stubIndicadorProfile(id: string, nome: string): Indicador {
  return {
    id,
    nome,
    email: "",
    telefone: "",
    role: "indicador",
    ativo: true,
    createdAt: new Date(0),
    totalIndicacoes: 0,
    indicacoesAprovadas: 0,
    totalRecebido: 0,
    saldoDisponivel: 0,
    saldoDesconto: 0,
  }
}

function buildLeadFromReferralRow(
  row: ReferralRow,
  planoById: Map<string, Plano>,
  indicadorNomeById: Map<string, string>
): Lead {
  const indicacaoBase = referralRowToIndicacaoMerged(
    row,
    row.indicator_profile_id,
    planoById
  )
  const nomeIndicador = indicadorNomeById.get(row.indicator_profile_id)
  const indicacao: Indicacao = nomeIndicador
    ? {
        ...indicacaoBase,
        indicador: stubIndicadorProfile(row.indicator_profile_id, nomeIndicador),
      }
    : indicacaoBase

  return {
    id: row.id,
    indicacaoId: row.id,
    indicacao,
    comercialId: row.commercial_profile_id ?? "",
    status: referralStatusToLeadStatus(row.status),
    observacoes: row.notes ? [row.notes] : [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function stubComercialProfile(id: string, nome: string, telefone = "") {
  return {
    id,
    nome,
    email: "",
    telefone,
    role: "comercial" as const,
    disponibilidade: "disponivel" as const,
    leadsAtivos: 0,
    vendasRealizadas: 0,
    tempoMedioPrimeiroContato: 0,
    ativo: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

const ADMIN_ROLES_FOR_DEV_LEADS = new Set([
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
])

/**
 * Leads do comercial logado: referrals atribuídos ou pool (commercial_profile_id nulo).
 * Em development: admin_* pode listar sem filtro (RLS); indicador pode usar OR próprio+pool
 * se `supabase/rls-policies.dev-local.sql` estiver aplicado no projeto local.
 * Retorna null se não for comercial (nem tester dev) ou em caso de erro (UI mantém mock).
 */
export async function loadComercialLeadsFromSupabase(): Promise<Lead[] | null> {
  try {
    devLogComercialLeads("início loadComercialLeadsFromSupabase")

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    const sessaoEncontrada = Boolean(user && !userError)
    devLogComercialLeads("sessão", {
      encontrada: sessaoEncontrada,
      userId: user?.id ?? null,
      authError: userError?.message ?? null,
    })

    if (userError || !user) {
      devWarnComercialLeadsMock(
        userError
          ? `sem sessão válida: ${userError.message}`
          : "sem usuário (sessão ausente)"
      )
      return null
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const profileEncontrado = profile != null && !profileError
    const role = (profile as { role?: string } | null)?.role ?? null

    devLogComercialLeads("profile", {
      encontrado: profileEncontrado,
      erro: profileError?.message ?? null,
      code: profileError?.code ?? null,
      role,
    })

    if (profileError || !profile) {
      devWarnComercialLeadsMock(
        profileError
          ? `query profiles falhou: ${profileError.message} (${profileError.code ?? "sem código"})`
          : "perfil não encontrado para user.id"
      )
      return null
    }

    const roleStr = (profile as { role: string }).role
    const isComercial = roleStr === "comercial"
    const isDevAdminTester = isDev() && ADMIN_ROLES_FOR_DEV_LEADS.has(roleStr)
    const isDevIndicadorPoolTester = isDev() && roleStr === "indicador"

    if (!isComercial && !isDevAdminTester && !isDevIndicadorPoolTester) {
      const msg =
        `/comercial/leads: carregamento Supabase só roda com profile.role=comercial. ` +
        `Role atual: "${roleStr}". ` +
        `Em produção o mock é esperado para não-comercial. ` +
        `Em development, use comercial, ou admin_* (lista sem filtro, RLS admin), ou indicador + pool (aplique supabase/rls-policies.dev-local.sql no banco local).`
      devLogComercialLeads("bloqueio por role", { role: roleStr, NODE_ENV: process.env.NODE_ENV })
      if (isDev()) {
        console.info(COMERCIAL_LEADS_LOG_PREFIX, msg)
      }
      devWarnComercialLeadsMock(
        `role não autorizada para loader: "${roleStr}" (esperado comercial)`
      )
      return null
    }

    if (isDevAdminTester) {
      devLogComercialLeads(
        "modo DEV: admin — query referrals sem filtro de comercial (visibilidade = RLS)"
      )
    }
    if (isDevIndicadorPoolTester) {
      devLogComercialLeads(
        "modo DEV: indicador — OR indicator_profile_id + pool null (pool exige política dev-local no Supabase)"
      )
    }

    const refSelect = `
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
        first_invoice_paid_at,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at,
        updated_at
      `

    let refBuilder = db.from("referrals").select(refSelect)

    if (isComercial) {
      const orFilter = `commercial_profile_id.eq.${user.id},commercial_profile_id.is.null`
      devLogComercialLeads("filtro referrals", { tipo: "comercial", orFilter })
      refBuilder = refBuilder.or(orFilter)
    } else if (isDevAdminTester) {
      devLogComercialLeads("filtro referrals", { tipo: "admin_dev", filtro: "nenhum (só RLS)" })
    } else if (isDevIndicadorPoolTester) {
      const orDev = `indicator_profile_id.eq.${user.id},commercial_profile_id.is.null`
      devLogComercialLeads("filtro referrals", { tipo: "indicador_dev", orFilter: orDev })
      refBuilder = refBuilder.or(orDev)
    }

    const { data: refData, error: refError } = await refBuilder.order(
      "created_at",
      { ascending: false }
    )

    devLogComercialLeads("resultado query referrals", {
      erro: refError?.message ?? null,
      code: refError?.code ?? null,
      details: (refError as { details?: string } | null)?.details ?? null,
      hint: (refError as { hint?: string } | null)?.hint ?? null,
      rowCount: refData?.length ?? 0,
    })

    if (refError) {
      devWarnComercialLeadsMock(
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

      devLogComercialLeads("resultado query plans", {
        erro: plansError?.message ?? null,
        code: plansError?.code ?? null,
        rowCount: plansData?.length ?? 0,
      })

      if (plansError) {
        devWarnComercialLeadsMock(
          `plans falhou: ${plansError.message} (${plansError.code ?? "sem código"})`
        )
        return null
      }

      for (const pr of plansData ?? []) {
        const p = mapPlanRowToPlano(pr as PlanCatalogRow)
        planoById.set(p.id, p)
      }
    }

    const indicatorIds = [...new Set(referrals.map((r) => r.indicator_profile_id))]
    const indicadorNomeById = new Map<string, string>()
    if (indicatorIds.length > 0) {
      const { data: indProfiles, error: indErr } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", indicatorIds)

      devLogComercialLeads("query profiles indicadores", {
        error: indErr?.message ?? null,
        rowCount: indProfiles?.length ?? 0,
      })

      if (!indErr) {
        for (const p of indProfiles ?? []) {
          const row = p as { id: string; full_name: string }
          indicadorNomeById.set(row.id, row.full_name)
        }
      }
    }

    const result = referrals.map((r) =>
      buildLeadFromReferralRow(r, planoById, indicadorNomeById)
    )

    devLogComercialLeads("sucesso", { total: result.length, roleUsada: roleStr })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devWarnComercialLeadsMock(`exceção: ${msg}`)
    return null
  }
}

// --- Comercial /comercial/leads/[id] ---------------------------------------------

const COMERCIAL_LEAD_DETAIL_LOG_PREFIX = "[comercial-lead-detail:supabase]"

function devLogComercialLeadDetail(...args: unknown[]): void {
  if (!isDev()) return
  console.log(COMERCIAL_LEAD_DETAIL_LOG_PREFIX, ...args)
}

function devWarnComercialLeadDetailMock(reason: string): void {
  if (isDev()) {
    console.warn(COMERCIAL_LEAD_DETAIL_LOG_PREFIX, "fallback mock →", reason)
  }
}

export type ComercialLeadDetailsResult =
  | { kind: "ok"; lead: Lead; historico: Historico[] }
  | { kind: "not-found" }
  | { kind: "error" }

export async function loadComercialLeadDetailsFromSupabase(
  referralId: string
): Promise<ComercialLeadDetailsResult> {
  try {
    devLogComercialLeadDetail("início", { referralId })

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    devLogComercialLeadDetail("auth.getUser", {
      hasUser: Boolean(user && !authError),
      userId: user?.id ?? null,
      authError: authError?.message ?? null,
    })

    if (authError || !user) {
      devWarnComercialLeadDetailMock(
        authError
          ? `sem sessão válida: ${authError.message}`
          : "sem usuário autenticado"
      )
      return { kind: "error" }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    devLogComercialLeadDetail("profile do auth user", {
      hasProfile: Boolean(profile && !profileError),
      role,
      error: profileError?.message ?? null,
      code: profileError?.code ?? null,
    })

    const podeVerDetalheComercialLead =
      role === "comercial" ||
      role === "admin_financeiro" ||
      role === "admin_master"

    if (profileError || !profile || !podeVerDetalheComercialLead) {
      devWarnComercialLeadDetailMock(
        profileError
          ? `profiles falhou: ${profileError.message} (${profileError.code ?? "sem código"})`
          : `role não autorizada para detalhe de lead: "${role}"`
      )
      return { kind: "error" }
    }

    const { data: refRow, error: refError } = await db
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
        first_invoice_paid_at,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at,
        updated_at
      `
      )
      .eq("id", referralId)
      .maybeSingle()

    devLogComercialLeadDetail("query referral", {
      hasRow: Boolean(refRow),
      error: refError?.message ?? null,
      code: refError?.code ?? null,
      details: (refError as { details?: string } | null)?.details ?? null,
      hint: (refError as { hint?: string } | null)?.hint ?? null,
    })

    if (refError) {
      devWarnComercialLeadDetailMock(
        `referrals falhou: ${refError.message} (${refError.code ?? "sem código"})`
      )
      return { kind: "error" }
    }

    if (!refRow) {
      devLogComercialLeadDetail("referral não encontrado (id inexistente ou RLS)")
      return { kind: "not-found" }
    }

    const referral = refRow as ReferralRow

    const { data: planRow, error: planError } = await db
      .from("plans")
      .select(
        "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
      )
      .eq("id", referral.plan_id)
      .maybeSingle()

    devLogComercialLeadDetail("query plan", {
      hasRow: Boolean(planRow),
      error: planError?.message ?? null,
      code: planError?.code ?? null,
    })

    if (planError) {
      devWarnComercialLeadDetailMock(
        `plans falhou: ${planError.message} (${planError.code ?? "sem código"})`
      )
      return { kind: "error" }
    }

    const planoById = new Map<string, Plano>()
    if (planRow) {
      const plano = mapPlanRowToPlano(planRow as PlanCatalogRow)
      planoById.set(plano.id, plano)
    }

    const profileIds = [
      ...new Set(
        [referral.indicator_profile_id, referral.commercial_profile_id].filter(
          (id): id is string => Boolean(id)
        )
      ),
    ]
    let profilesById = new Map<
      string,
      { id: string; full_name: string; phone: string | null }
    >()

    if (profileIds.length > 0) {
      const { data: profRows, error: profError } = await db
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", profileIds)

      devLogComercialLeadDetail("query profiles relacionados", {
        error: profError?.message ?? null,
        code: profError?.code ?? null,
        rowCount: profRows?.length ?? 0,
      })

      if (profError) {
        devWarnComercialLeadDetailMock(
          `profiles relacionados falhou: ${profError.message} (${profError.code ?? "sem código"})`
        )
        return { kind: "error" }
      }

      profilesById = new Map(
        (profRows ?? []).map((row: unknown) => {
          const p = row as { id: string; full_name: string; phone: string | null }
          return [p.id, p]
        })
      )
    }

    const indicatorName =
      profilesById.get(referral.indicator_profile_id)?.full_name ?? "Indicador"
    const lead = buildLeadFromReferralRow(
      referral,
      planoById,
      new Map([[referral.indicator_profile_id, indicatorName]])
    )

    const indicatorProfile = profilesById.get(referral.indicator_profile_id)
    if (lead.indicacao) {
      lead.indicacao.indicador = stubIndicadorProfile(
        referral.indicator_profile_id,
        indicatorProfile?.full_name ?? "Indicador"
      )
      if (indicatorProfile?.phone) {
        lead.indicacao.indicador.telefone = indicatorProfile.phone
      }
    }

    const { data: historyRows, error: historyError } = await db
      .from("referral_history")
      .select(
        "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
      )
      .eq("referral_id", referralId)
      .order("created_at", { ascending: false })

    devLogComercialLeadDetail("query referral_history", {
      error: historyError?.message ?? null,
      code: historyError?.code ?? null,
      rowCount: historyRows?.length ?? 0,
    })

    if (historyError) {
      devWarnComercialLeadDetailMock(
        `referral_history falhou: ${historyError.message} (${historyError.code ?? "sem código"})`
      )
      return { kind: "error" }
    }

    const actorIds = [
      ...new Set(
        (historyRows ?? [])
          .map((h: unknown) => (h as ReferralHistoryRow).actor_profile_id)
          .filter((id: string | null): id is string => Boolean(id))
      ),
    ]

    const actorById = new Map<string, { full_name: string; phone: string | null }>()
    if (actorIds.length > 0) {
      const { data: actorRows, error: actorError } = await db
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", actorIds)

      devLogComercialLeadDetail("query actors history", {
        error: actorError?.message ?? null,
        code: actorError?.code ?? null,
        rowCount: actorRows?.length ?? 0,
      })

      if (actorError) {
        devWarnComercialLeadDetailMock(
          `profiles actors falhou: ${actorError.message} (${actorError.code ?? "sem código"})`
        )
        return { kind: "error" }
      }

      for (const row of actorRows ?? []) {
        const actor = row as { id: string; full_name: string; phone: string | null }
        actorById.set(actor.id, {
          full_name: actor.full_name,
          phone: actor.phone,
        })
      }
    }

    const historico: Historico[] = (historyRows ?? []).map((raw: unknown) => {
      const h = raw as ReferralHistoryRow
      const actor = h.actor_profile_id ? actorById.get(h.actor_profile_id) : null
      const acaoBase = h.action_note?.trim() || "Atualização de lead"
      const descricaoStatus =
        h.old_status && h.old_status !== h.new_status
          ? `Status: ${h.old_status} -> ${h.new_status}`
          : `Status: ${h.new_status}`
      const metadataAction =
        h.metadata && typeof h.metadata.action === "string"
          ? `Ação: ${h.metadata.action}`
          : null

      return {
        id: h.id,
        leadId: referralId,
        comercialId: h.actor_profile_id ?? "",
        comercial: h.actor_profile_id
          ? stubComercialProfile(
              h.actor_profile_id,
              actor?.full_name ?? "Comercial",
              actor?.phone ?? ""
            )
          : undefined,
        acao: acaoBase,
        descricao: [descricaoStatus, metadataAction].filter(Boolean).join(" • "),
        createdAt: new Date(h.created_at),
      }
    })

    devLogComercialLeadDetail("sucesso", {
      leadId: lead.id,
      historyCount: historico.length,
    })
    return { kind: "ok", lead, historico }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devWarnComercialLeadDetailMock(`exceção: ${msg}`)
    return { kind: "error" }
  }
}

// --- Primeira mensalidade (financeiro) --------------------------------------------

const FIRST_INVOICE_PAID_LOG_PREFIX = "[first-invoice-paid:supabase]"

function devLogFirstInvoicePaid(...args: unknown[]): void {
  if (!isDev()) return
  console.log(FIRST_INVOICE_PAID_LOG_PREFIX, ...args)
}

/**
 * Role do perfil autenticado (para UI condicional no cliente).
 */
export async function getAuthProfileRoleFromSupabase(): Promise<UserRole | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return null
    const { data: row, error } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    if (error || !row) return null
    return (row as { role: UserRole }).role
  } catch {
    return null
  }
}

/** Ações financeiras sensíveis: saques Pix e 1ª mensalidade (não inclui admin_consulta). */
const ADMIN_FINANCE_MASTER_ROLES = new Set<UserRole>([
  "admin_financeiro",
  "admin_master",
])

async function assertAdminFinanceOrMasterForSensitiveAction(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const role = await getAuthProfileRoleFromSupabase()
  if (!role || !ADMIN_FINANCE_MASTER_ROLES.has(role)) {
    return {
      ok: false,
      message: "Sem permissão para esta ação financeira.",
    }
  }
  return { ok: true }
}

/**
 * Perfil do usuário autenticado (`auth.users` + `public.profiles`).
 */
export async function getAuthProfileBasicsFromSupabase(): Promise<AuthProfileBasics | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return null
    const { data: row, error } = await db
      .from("profiles")
      .select(
        "id, full_name, email, phone, role, avatar_url, created_at"
      )
      .eq("id", user.id)
      .maybeSingle()
    if (error || !row) return null
    const r = row as {
      id: string
      full_name: string | null
      email: string
      phone: string
      role: UserRole
      avatar_url: string | null
      created_at: string
    }
    const profile: AuthProfileBasics = {
      id: r.id,
      fullName: (r.full_name ?? "").trim() || "Usuário",
      email: r.email ?? "",
      phone: r.phone ?? "",
      role: r.role,
      avatarUrl: r.avatar_url ?? null,
      createdAt: r.created_at ?? null,
    }
    if (isDev()) {
      console.log("[auth-profile:debug]", {
        userId: user.id,
        email: user.email,
        profile: row,
        source: "supabase",
      })
    }
    return profile
  } catch {
    return null
  }
}

const MARK_FIRST_INVOICE_ERROR_CODES: MarkFirstInvoicePaidErrorCode[] = [
  "forbidden",
  "referral_not_found",
  "already_paid",
  "reward_not_found",
  "reward_not_pending",
  "already_released",
  "rpc_error",
  "unknown",
]

function parseMarkFirstInvoiceRpcPayload(
  raw: unknown
): MarkFirstInvoicePaidResult {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      code: "unknown",
      message: "Resposta inesperada do servidor.",
    }
  }
  const payload = raw as Record<string, unknown>
  if (payload.ok === false) {
    const codeRaw = payload.code
    const messageRaw = payload.message
    const code =
      typeof codeRaw === "string" &&
      MARK_FIRST_INVOICE_ERROR_CODES.includes(codeRaw as MarkFirstInvoicePaidErrorCode)
        ? (codeRaw as MarkFirstInvoicePaidErrorCode)
        : "unknown"
    return {
      ok: false,
      code,
      message:
        typeof messageRaw === "string"
          ? messageRaw
          : "Não foi possível concluir a operação.",
    }
  }
  if (payload.ok === true) {
    const rewardId = String(payload.reward_id ?? "")
    const transactionId = String(payload.transaction_id ?? "")
    const balanceAfter = Number(payload.balance_after ?? 0)
    if (!rewardId || !transactionId) {
      return {
        ok: false,
        code: "unknown",
        message: "Resposta incompleta do servidor.",
      }
    }
    return { ok: true, rewardId, transactionId, balanceAfter }
  }
  return {
    ok: false,
    code: "unknown",
    message: "Resposta inesperada do servidor.",
  }
}

/**
 * Confirma pagamento da 1ª mensalidade (RPC transacional no Postgres).
 */
export async function markFirstInvoiceAsPaidFromSupabase(
  referralId: string
): Promise<MarkFirstInvoicePaidResult> {
  try {
    const gate = await assertAdminFinanceOrMasterForSensitiveAction()
    if (!gate.ok) {
      return { ok: false, code: "forbidden", message: gate.message }
    }
    devLogFirstInvoicePaid("início markFirstInvoiceAsPaidFromSupabase", {
      referralId,
    })
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const dbRpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: { p_referral_id: string }
      ) => ReturnType<typeof supabase.rpc>
    }

    // Buscar indicator_profile_id antes de chamar RPC (para notificações)
    const { data: referralRow } = await db
      .from("referrals")
      .select("indicator_profile_id")
      .eq("id", referralId)
      .maybeSingle()
    const indicatorProfileId = (referralRow as { indicator_profile_id?: string } | null)
      ?.indicator_profile_id ?? null

    const { data, error } = await dbRpc.rpc("mark_first_invoice_paid", {
      p_referral_id: referralId,
    })

    devLogFirstInvoicePaid("rpc mark_first_invoice_paid", {
      referralId,
      error: error?.message ?? null,
      code: error?.code ?? null,
      data,
    })

    if (error) {
      return {
        ok: false,
        code: "rpc_error",
        message:
          error.message ||
          "Falha ao confirmar primeira mensalidade. Verifique se a função SQL foi aplicada no projeto.",
      }
    }

    const result = parseMarkFirstInvoiceRpcPayload(data)

    if (result.ok && indicatorProfileId) {
      // Evento 2 — primeira mensalidade confirmada
      void insertNotification({
        profile_id: indicatorProfileId,
        notification_type: "recompensa",
        title: "Primeira mensalidade confirmada",
        message: "A primeira mensalidade do indicado foi confirmada.",
        data: {
          action: "first_invoice_paid",
          referral_id: referralId,
          reward_id: result.rewardId,
          wallet_transaction_id: result.transactionId,
        },
      })

      // Evento 3 — recompensa disponível (mark_first_invoice_paid libera a reward para 'disponivel')
      void insertNotification({
        profile_id: indicatorProfileId,
        notification_type: "recompensa",
        title: "Recompensa liberada",
        message: "Sua recompensa já está disponível para saque ou desconto.",
        data: {
          action: "reward_available",
          referral_id: referralId,
          reward_id: result.rewardId,
          balance_after: result.balanceAfter,
        },
      })
    }

    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devLogFirstInvoicePaid("exceção", msg)
    return { ok: false, code: "unknown", message: msg }
  }
}

// --- Ação Comercial: Assumir lead -------------------------------------------------

type ClaimLeadResult = { ok: true } | { ok: false; message: string }
export type ComercialLeadUpdateStatus =
  | "em_atendimento"
  | "aguardando_instalacao"
  | "vendido"
  | "recusado"
  | "sem_viabilidade"

type UpdateComercialLeadStatusResult =
  | { ok: true }
  | { ok: false; message: string }

const COMERCIAL_LEAD_UPDATE_LOG_PREFIX = "[comercial-lead-update:supabase]"

function devLogComercialLeadUpdate(...args: unknown[]): void {
  if (!isDev()) return
  console.log(COMERCIAL_LEAD_UPDATE_LOG_PREFIX, ...args)
}

function mapComercialUpdateStatusToReferralStatus(
  status: ComercialLeadUpdateStatus
): string {
  switch (status) {
    case "em_atendimento":
      return "em_atendimento"
    case "aguardando_instalacao":
      return "em_negociacao"
    case "vendido":
      return "aprovada"
    case "recusado":
    case "sem_viabilidade":
      return "recusada"
    default:
      return "em_atendimento"
  }
}

export async function updateComercialLeadStatus(
  referralId: string,
  newStatus: ComercialLeadUpdateStatus,
  note?: string
): Promise<UpdateComercialLeadStatusResult> {
  try {
    devLogComercialLeadUpdate("início", {
      referralId,
      newStatus,
      hasNote: Boolean(note?.trim()),
    })

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    devLogComercialLeadUpdate("auth.getUser", {
      hasUser: Boolean(user && !authError),
      userId: user?.id ?? null,
      authError: authError?.message ?? null,
    })

    if (authError || !user) {
      return {
        ok: false,
        message: "Sessão não encontrada. Faça login novamente.",
      }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    devLogComercialLeadUpdate("profile", {
      hasProfile: Boolean(profile && !profileError),
      role,
      error: profileError?.message ?? null,
      code: profileError?.code ?? null,
    })

    if (profileError || !profile || role !== "comercial") {
      if (isDev()) {
        console.warn(COMERCIAL_LEAD_UPDATE_LOG_PREFIX, "role inválida para update", {
          role,
          error: profileError?.message ?? null,
          code: profileError?.code ?? null,
        })
      }
      return {
        ok: false,
        message: "Apenas usuários com perfil comercial podem atualizar o lead.",
      }
    }

    const { data: referralBefore, error: referralBeforeError } = await db
      .from("referrals")
      .select(
        "id, status, notes, first_response_at, last_interaction_at, indicator_profile_id, reward_amount, reward_type"
      )
      .eq("id", referralId)
      .maybeSingle()

    devLogComercialLeadUpdate("row antes do update", {
      error: referralBeforeError?.message ?? null,
      code: referralBeforeError?.code ?? null,
      row: referralBefore ?? null,
    })

    if (referralBeforeError || !referralBefore) {
      return {
        ok: false,
        message: "Lead não encontrado para atualização.",
      }
    }

    const before = referralBefore as {
      status: string
      notes: string | null
      first_response_at: string | null
      last_interaction_at: string | null
      indicator_profile_id: string
      reward_amount: number | string
      reward_type: "pix" | "desconto_fatura" | string
    }
    const oldStatus = before.status
    const finalStatus = mapComercialUpdateStatusToReferralStatus(newStatus)
    const nextReferralStatus = finalStatus
    devLogComercialLeadUpdate("decisão criação de recompensa", {
      requestedStatus: newStatus,
      finalStatus,
      shouldCreateReward:
        finalStatus === "aprovada" && (referralBefore as { status?: string } | null)?.status !== "aprovada",
      referralId,
      indicator_profile_id: before.indicator_profile_id,
      reward_amount: before.reward_amount,
      reward_type: before.reward_type,
    })
    const noteTrimmed = note?.trim() ?? ""
    const nowIso = new Date().toISOString()
    const updatePayload: {
      status: string
      notes?: string
      last_interaction_at: string
      first_response_at: string
    } = {
      status: nextReferralStatus,
      last_interaction_at: nowIso,
      first_response_at: before.first_response_at ?? nowIso,
    }
    if (noteTrimmed) {
      updatePayload.notes = noteTrimmed
    }

    const { data: updateRows, error: updateError } = await db
      .from("referrals")
      .update(updatePayload)
      .eq("id", referralId)
      .select(
        "id, status, notes, updated_at, first_response_at, last_interaction_at, assigned_at"
      )

    devLogComercialLeadUpdate("resultado update referrals", {
      error: updateError?.message ?? null,
      code: updateError?.code ?? null,
      payload: updatePayload,
      rowCount: updateRows?.length ?? 0,
      rows: updateRows ?? [],
    })
    devLogComercialLeadUpdate("resultado update referrals (campos SLA)", {
      sla: (updateRows ?? []).map((row: unknown) => {
        const r = row as {
          id: string
          assigned_at?: string | null
          first_response_at?: string | null
          last_interaction_at?: string | null
        }
        return {
          id: r.id,
          assigned_at: r.assigned_at ?? null,
          first_response_at: r.first_response_at ?? null,
          last_interaction_at: r.last_interaction_at ?? null,
        }
      }),
    })

    if (updateError) {
      if (isDev()) {
        console.warn(COMERCIAL_LEAD_UPDATE_LOG_PREFIX, "falha update referrals", {
          message: updateError.message,
          code: updateError.code ?? null,
          details: (updateError as { details?: string }).details ?? null,
          hint: (updateError as { hint?: string }).hint ?? null,
        })
      }
      return {
        ok: false,
        message: "Não foi possível atualizar o status do lead.",
      }
    }

    const historyNote = noteTrimmed || `Status alterado para ${newStatus}`
    const { data: historyRows, error: historyError } = await db
      .from("referral_history")
      .insert({
        referral_id: referralId,
        actor_profile_id: user.id,
        old_status: oldStatus,
        new_status: nextReferralStatus,
        action_note: historyNote,
        metadata: {
          action: "status_change",
          requested_status: newStatus,
        },
      })
      .select(
        "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
      )

    devLogComercialLeadUpdate("resultado insert referral_history", {
      error: historyError?.message ?? null,
      code: historyError?.code ?? null,
      rowCount: historyRows?.length ?? 0,
      rows: historyRows ?? [],
    })

    if (historyError) {
      if (isDev()) {
        console.warn(
          COMERCIAL_LEAD_UPDATE_LOG_PREFIX,
          "falha insert referral_history",
          {
            message: historyError.message,
            code: historyError.code ?? null,
            details: (historyError as { details?: string }).details ?? null,
            hint: (historyError as { hint?: string }).hint ?? null,
          }
        )
      }
      return {
        ok: false,
        message: "Status atualizado, mas houve falha ao registrar histórico.",
      }
    }

    devLogComercialLeadUpdate("fluxo recompensa (venda → reward pendente)", {
      oldStatus: (referralBefore as { status?: string } | null)?.status,
      finalStatus,
      referralId,
    })

    if (
      finalStatus === "aprovada" &&
      (referralBefore as { status?: string } | null)?.status !== "aprovada"
    ) {
      const { data: existingReward, error: existingRewardError } = await db
        .from("rewards")
        .select("id, referral_id, status")
        .eq("referral_id", referralId)
        .maybeSingle()

      devLogComercialLeadUpdate("verificação reward existente", {
        referralId,
        hasReward: Boolean(existingReward),
        error: existingRewardError?.message ?? null,
        code: existingRewardError?.code ?? null,
      })

      if (existingRewardError) {
        return {
          ok: false,
          message: `Status atualizado, mas falhou ao verificar recompensa existente: ${existingRewardError.message}`,
        }
      }

      if (!existingReward) {
        const rewardPayload = {
          referral_id: referralId,
          indicator_profile_id: before.indicator_profile_id,
          amount: Number(before.reward_amount),
          reward_type:
            before.reward_type === "desconto_fatura" ? "desconto_fatura" : "pix",
          status: "pendente",
          available_at: null,
          paid_at: null,
        }

        const { data: rewardRows, error: rewardError } = await db
          .from("rewards")
          .insert(rewardPayload)
          .select(
            "id, referral_id, indicator_profile_id, amount, reward_type, status, available_at, paid_at"
          )

        devLogComercialLeadUpdate("resultado insert rewards", {
          referralId,
          payload: rewardPayload,
          error: rewardError?.message ?? null,
          code: rewardError?.code ?? null,
          details: (rewardError as { details?: string } | null)?.details ?? null,
          rowCount: rewardRows?.length ?? 0,
        })

        if (rewardError) {
          return {
            ok: false,
            message:
              `Falha ao criar recompensa automática: ${rewardError.message} ` +
              `(code: ${rewardError.code ?? "sem código"}) ` +
              `(details: ${(rewardError as { details?: string }).details ?? "sem detalhes"})`,
          }
        }

        const { data: rewardHistoryRows, error: rewardHistoryError } = await db
          .from("referral_history")
          .insert({
            referral_id: referralId,
            actor_profile_id: user.id,
            old_status: nextReferralStatus,
            new_status: nextReferralStatus,
            action_note: "Recompensa gerada automaticamente",
            metadata: { action: "reward_created" },
          })
          .select(
            "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
          )

        devLogComercialLeadUpdate("resultado insert referral_history reward_created", {
          referralId,
          error: rewardHistoryError?.message ?? null,
          code: rewardHistoryError?.code ?? null,
          details:
            (rewardHistoryError as { details?: string } | null)?.details ?? null,
          rowCount: rewardHistoryRows?.length ?? 0,
        })

        if (rewardHistoryError) {
          return {
            ok: false,
            message:
              "Recompensa criada, mas falhou ao registrar histórico de criação da recompensa.",
          }
        }

        // Evento 1 — notificar indicador: recompensa gerada
        const createdReward = (rewardRows as { id?: string }[] | null)?.[0]
        void insertNotification({
          profile_id: before.indicator_profile_id,
          notification_type: "recompensa",
          title: "Recompensa gerada",
          message:
            "Sua indicação foi aprovada e uma recompensa foi gerada. Ela será liberada após confirmação da primeira mensalidade.",
          data: {
            action: "reward_created",
            referral_id: referralId,
            reward_id: createdReward?.id ?? null,
          },
        })
      } else {
        devLogComercialLeadUpdate("reward já existe; não duplica", {
          referralId,
          existingRewardId: (existingReward as { id?: string } | null)?.id ?? null,
        })
      }
    }

    const { data: referralAfter, error: referralAfterError } = await db
      .from("referrals")
      .select(
        "id, status, notes, updated_at, first_response_at, last_interaction_at, assigned_at"
      )
      .eq("id", referralId)
      .maybeSingle()

    devLogComercialLeadUpdate("row depois do update", {
      error: referralAfterError?.message ?? null,
      code: referralAfterError?.code ?? null,
      row: referralAfter ?? null,
    })

    if (referralAfterError || !referralAfter) {
      return {
        ok: false,
        message: "Não foi possível confirmar a atualização do lead.",
      }
    }

    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isDev()) {
      console.warn(COMERCIAL_LEAD_UPDATE_LOG_PREFIX, "exceção", { message: msg })
    }
    return {
      ok: false,
      message: "Erro inesperado ao atualizar o lead.",
    }
  }
}

export async function claimComercialLead(
  referralId: string
): Promise<ClaimLeadResult> {
  try {
    devLogComercialLeads("claim: início", { referralId })

    const useMock =
      process.env.NEXT_PUBLIC_DATA_PROVIDER === "mock" ||
      process.env.DATA_PROVIDER === "mock"
    if (useMock) {
      if (isDev()) {
        devLogComercialLeads("claim: mock provider — pulando RPC", { referralId })
      }
      return { ok: true }
    }

    const supabase = getSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    devLogComercialLeads("claim: auth.getUser", {
      hasUser: Boolean(user && !userError),
      userId: user?.id ?? null,
      authError: userError?.message ?? null,
    })

    if (userError || !user) {
      if (isDev()) {
        console.warn(COMERCIAL_LEADS_LOG_PREFIX, "claim: sessão inválida", {
          message: userError?.message ?? "usuário ausente",
        })
      }
      return {
        ok: false,
        message: "Sessão não encontrada. Faça login novamente.",
      }
    }

    const dbRpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: { p_referral_id: string }
      ) => ReturnType<typeof supabase.rpc>
    }

    const { data, error } = await dbRpc.rpc("claim_referral_lead", {
      p_referral_id: referralId,
    })

    devLogComercialLeads("claim: RPC claim_referral_lead", {
      error: error?.message ?? null,
      code: (error as { code?: string } | null)?.code ?? null,
      data: data ?? null,
    })

    if (error) {
      if (isDev()) {
        console.warn(COMERCIAL_LEADS_LOG_PREFIX, "claim: erro RPC", {
          message: error.message,
          code: error.code ?? null,
        })
      }
      return {
        ok: false,
        message: error.message || "Não foi possível assumir este lead.",
      }
    }

    let payload = data as Record<string, unknown> | null
    if (typeof data === "string") {
      try {
        payload = JSON.parse(data) as Record<string, unknown>
      } catch {
        payload = null
      }
    }

    const okFlag = payload?.ok === true
    const code = typeof payload?.code === "string" ? payload.code : "unknown"
    const msgFromServer =
      typeof payload?.message === "string" ? payload.message : null

    if (payload && okFlag) {
      devLogComercialLeads("claim: sucesso", {
        referralId: payload.referral_id,
        commercialProfileId: payload.commercial_profile_id,
      })
      return { ok: true }
    }

    const messageByCode: Record<string, string> = {
      not_found: "Lead não encontrado para assumir.",
      already_claimed: "Este lead já foi assumido por outro comercial.",
      forbidden:
        msgFromServer ??
        "Apenas usuários com perfil comercial podem assumir leads.",
      unauthorized:
        msgFromServer ?? "Sessão não encontrada. Faça login novamente.",
    }
    const message =
      messageByCode[code] ??
      msgFromServer ??
      "Não foi possível assumir este lead."

    if (isDev()) {
      console.warn(COMERCIAL_LEADS_LOG_PREFIX, "claim: RPC retornou ok=false", {
        code,
        payload,
      })
    }

    return { ok: false, message }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isDev()) {
      console.warn(COMERCIAL_LEADS_LOG_PREFIX, "claim: exceção", { message: msg })
    }
    return {
      ok: false,
      message: "Erro inesperado ao assumir lead.",
    }
  }
}

// --- Pagamentos / saque Pix -------------------------------------------------------

const PIX_WITHDRAWAL_LOG_PREFIX = "[pix-withdrawal:supabase]"

function devLogPixWithdrawal(...args: unknown[]): void {
  if (!isDev()) return
  console.log(PIX_WITHDRAWAL_LOG_PREFIX, ...args)
}

function devWarnPixWithdrawal(reason: string): void {
  if (!isDev()) return
  console.warn(PIX_WITHDRAWAL_LOG_PREFIX, "fallback / aviso →", reason)
}

type PaymentRowDb = {
  id: string
  indicator_profile_id: string
  referral_id: string | null
  reward_id: string | null
  amount: number | string
  reward_type: string
  status: string
  due_date: string
  paid_at: string | null
  receipt_url: string | null
  notes: string | null
  approved_by_profile_id: string | null
  created_at: string
  updated_at: string
  payment_kind?: string | null
  rejection_reason?: string | null
  pix_key_snapshot?: string | null
  pix_key_type?: string | null
  wallet_debit_transaction_id?: string | null
  referrals?: {
    referred_name: string
    plan_id: string
  } | null
}

function mapPaymentStatusDb(s: string): PagamentoStatus {
  const allowed: PagamentoStatus[] = [
    "pendente",
    "aprovado",
    "pago",
    "cancelado",
    "rejeitado",
  ]
  return (allowed.includes(s as PagamentoStatus) ? s : "pendente") as PagamentoStatus
}

function mapPaymentKindDb(k: string | null | undefined): PagamentoKind {
  return k === "pix_withdrawal" ? "pix_withdrawal" : "referral_reward"
}

function mapTipoChavePix(t: string | null | undefined): import("@/types/profile").TipoChavePix | undefined {
  if (!t) return undefined
  const v = ["cpf", "cnpj", "email", "telefone", "aleatoria"] as const
  return v.includes(t as (typeof v)[number]) ? (t as (typeof v)[number]) : undefined
}

function paymentRowToPagamento(row: PaymentRowDb): Pagamento {
  const kind = mapPaymentKindDb(row.payment_kind)
  const ref = row.referrals
  const indicacaoStub: import("@/types/referral").Indicacao | undefined =
    row.referral_id && ref
      ? {
          id: row.referral_id,
          indicadorId: row.indicator_profile_id,
          nomeIndicado: ref.referred_name,
          telefoneIndicado: "",
          planoId: ref.plan_id,
          tipoRecompensa: row.reward_type === "desconto_fatura" ? "desconto_fatura" : "pix",
          valorRecompensa: Number(row.amount),
          status: "aprovada",
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }
      : undefined

  return {
    id: row.id,
    indicadorId: row.indicator_profile_id,
    indicacaoId: row.referral_id ?? undefined,
    indicacao: indicacaoStub,
    valor: Number(row.amount),
    tipo: row.reward_type === "desconto_fatura" ? "desconto_fatura" : "pix",
    status: mapPaymentStatusDb(row.status),
    dataVencimento: new Date(row.due_date),
    dataPagamento: row.paid_at ? new Date(row.paid_at) : undefined,
    comprovanteUrl: row.receipt_url ?? undefined,
    observacoes: row.notes ?? undefined,
    aprovadoPor: row.approved_by_profile_id ?? undefined,
    kind,
    motivoRejeicao: row.rejection_reason ?? undefined,
    pixChaveSnapshot: row.pix_key_snapshot ?? undefined,
    pixTipoChave: mapTipoChavePix(row.pix_key_type),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * `receipt_url` no formato `payment-receipts/pix-withdrawals/...` vira URL assinada (bucket privado)
 * ou URL pública (fallback) para uso em links da UI.
 */
async function expandPaymentReceiptUrlsInPagamentos(
  list: Pagamento[]
): Promise<Pagamento[]> {
  const supabase = getSupabaseClient()
  return Promise.all(
    list.map(async (p) => {
      const raw = p.comprovanteUrl
      if (!raw) return p
      if (/^https?:\/\//i.test(raw)) return p
      const prefix = `${PAYMENT_RECEIPTS_BUCKET}/`
      if (!raw.startsWith(prefix)) return p
      const objectPath = raw.slice(prefix.length)
      const { data: signed, error } = await supabase.storage
        .from(PAYMENT_RECEIPTS_BUCKET)
        .createSignedUrl(objectPath, 3600)
      if (!error && signed?.signedUrl) {
        return { ...p, comprovanteUrl: signed.signedUrl }
      }
      const pub = supabase.storage.from(PAYMENT_RECEIPTS_BUCKET).getPublicUrl(objectPath).data
        .publicUrl
      return { ...p, comprovanteUrl: pub || p.comprovanteUrl }
    })
  )
}

function parsePixWithdrawalRpc(raw: unknown): import("@/types/payment").PixWithdrawalRpcResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "invalid_response", message: "Resposta inválida do servidor." }
  }
  const o = raw as Record<string, unknown>
  if (o.ok === false) {
    return {
      ok: false,
      code: String(o.code ?? "error"),
      message: String(o.message ?? "Operação não concluída."),
    }
  }
  if (o.ok === true) {
    return {
      ok: true,
      paymentId: o.payment_id != null ? String(o.payment_id) : undefined,
      status: o.status != null ? String(o.status) : undefined,
      balanceAfter:
        o.balance_after != null && typeof o.balance_after === "number"
          ? o.balance_after
          : o.balance_after != null
            ? Number(o.balance_after)
            : undefined,
      walletTransactionId:
        o.wallet_transaction_id != null ? String(o.wallet_transaction_id) : undefined,
    }
  }
  return { ok: false, code: "invalid_response", message: "Resposta inválida do servidor." }
}

// ============================================================
// NOTIFICAÇÕES INTERNAS
// ============================================================

const NOTIFICATIONS_LOG_PREFIX = "[notifications:supabase]"

function devLogNotification(...args: unknown[]): void {
  if (!isDev()) return
  console.log(NOTIFICATIONS_LOG_PREFIX, ...args)
}

type NotificationPayload = {
  profile_id: string
  notification_type: "sistema" | "indicacao" | "pagamento" | "recompensa" | "carteira" | "seguranca"
  title: string
  message: string
  data?: Record<string, unknown>
}

/**
 * Insere uma notificação interna.
 * Nunca lança exceção: se falhar, apenas loga em dev e retorna silenciosamente.
 */
async function insertNotification(payload: NotificationPayload): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const row = {
      profile_id: payload.profile_id,
      notification_type: payload.notification_type,
      title: payload.title,
      message: payload.message,
      data: payload.data ?? {},
      is_read: false,
    }
    const { error } = await db.from("notifications").insert(row)
    if (error) {
      devLogNotification("falha ao inserir notificação", {
        title: payload.title,
        profile_id: payload.profile_id,
        error: error.message,
        code: error.code ?? null,
      })
    } else {
      devLogNotification("notificação inserida", { title: payload.title, profile_id: payload.profile_id })
    }
  } catch (e) {
    devLogNotification("exceção ao inserir notificação", e instanceof Error ? e.message : String(e))
  }
}

/**
 * Insere notificações para todos os admins com roles financeiro/master.
 * Nunca lança exceção.
 */
async function insertNotificationForAdmins(
  payload: Omit<NotificationPayload, "profile_id">
): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { data: admins, error: adminsError } = await db
      .from("profiles")
      .select("id")
      .in("role", ["admin_financeiro", "admin_master"])
      .eq("is_active", true)
    if (adminsError || !admins) {
      devLogNotification("falha ao buscar admins para notificação", adminsError?.message ?? "sem dados")
      return
    }
    await Promise.all(
      (admins as { id: string }[]).map((a) =>
        insertNotification({ ...payload, profile_id: a.id })
      )
    )
  } catch (e) {
    devLogNotification("exceção em insertNotificationForAdmins", e instanceof Error ? e.message : String(e))
  }
}

// --- Central de notificações (usuário logado) -------------------------------------

const USER_NOTIFICATIONS_LOG_PREFIX = "[user-notifications:supabase]"

function devLogUserNotifications(...args: unknown[]): void {
  if (!isDev()) return
  console.log(USER_NOTIFICATIONS_LOG_PREFIX, ...args)
}

function devWarnUserNotifications(reason: string): void {
  if (!isDev()) return
  console.warn(USER_NOTIFICATIONS_LOG_PREFIX, reason)
}

/**
 * Lista notificações do usuário autenticado (RLS: profile_id = auth.uid()).
 */
export async function loadUserNotificationsFromSupabase(): Promise<NotificationItem[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      devWarnUserNotifications(`load: sem usuário (${authError?.message ?? "auth"})`)
      return null
    }
    const { data: rows, error } = await db
      .from("notifications")
      .select("id, title, message, notification_type, data, is_read, read_at, created_at")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200)

    if (error) {
      devWarnUserNotifications(`query falhou: ${error.message} (${error.code ?? "sem código"})`)
      return null
    }

    const list: NotificationItem[] = (rows ?? []).map((raw: unknown) => {
      const row = raw as {
        id: string
        title: string
        message: string
        notification_type: string
        data: Record<string, unknown> | null
        is_read: boolean
        read_at: string | null
        created_at: string
      }
      return {
        id: row.id,
        title: row.title,
        message: row.message,
        notificationType: row.notification_type,
        data: row.data ?? {},
        isRead: row.is_read,
        readAt: row.read_at ? new Date(row.read_at) : null,
        createdAt: new Date(row.created_at),
      }
    })

    const unreadCount = list.filter((n) => !n.isRead).length
    devLogUserNotifications("load", {
      total: list.length,
      unreadCount,
    })

    return list
  } catch (e) {
    devWarnUserNotifications(`load exceção: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * Contagem de notificações não lidas do usuário autenticado.
 */
export async function countUserUnreadNotificationsFromSupabase(): Promise<number | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return null
    const { count, error } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .eq("is_read", false)

    if (error) {
      devWarnUserNotifications(`count falhou: ${error.message}`)
      return null
    }
    const unreadCount = count ?? 0
    devLogUserNotifications("unread count", { unreadCount })
    return unreadCount
  } catch (e) {
    devWarnUserNotifications(`count exceção: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * Marca uma notificação como lida (somente se pertencer ao usuário).
 */
export async function markUserNotificationAsRead(
  notificationId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return { ok: false, message: "Sessão inválida. Faça login novamente." }
    }
    const now = new Date().toISOString()
    const { data: updated, error } = await db
      .from("notifications")
      .update({ is_read: true, read_at: now })
      .eq("id", notificationId)
      .eq("profile_id", user.id)
      .select("id, is_read, read_at")

    devLogUserNotifications("markUserNotificationAsRead", {
      notificationId,
      error: error?.message ?? null,
      rowCount: updated?.length ?? 0,
    })

    if (error) {
      return {
        ok: false,
        message: error.message || "Não foi possível marcar como lida.",
      }
    }
    if (!updated || updated.length === 0) {
      return { ok: false, message: "Notificação não encontrada ou sem permissão." }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devWarnUserNotifications(`markOne exceção: ${msg}`)
    return { ok: false, message: msg }
  }
}

/**
 * Marca todas as notificações do usuário como lidas.
 */
export async function markAllUserNotificationsAsRead(): Promise<
  { ok: true; updated: number } | { ok: false; message: string }
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return { ok: false, message: "Sessão inválida. Faça login novamente." }
    }
    const now = new Date().toISOString()
    const { data: updatedRows, error } = await db
      .from("notifications")
      .update({ is_read: true, read_at: now })
      .eq("profile_id", user.id)
      .eq("is_read", false)
      .select("id")

    devLogUserNotifications("markAllUserNotificationsAsRead", {
      updated: updatedRows?.length ?? 0,
      error: error?.message ?? null,
    })

    if (error) {
      return {
        ok: false,
        message: error.message || "Falha ao marcar todas como lidas.",
      }
    }
    return { ok: true, updated: updatedRows?.length ?? 0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg }
  }
}

// ============================================================
// SAQUES PIX — RPC HELPER
// ============================================================

async function rpcPixWithdrawal(
  fn: string,
  args: Record<string, string | number>
): Promise<import("@/types/payment").PixWithdrawalRpcResult> {
  try {
    const supabase = getSupabaseClient()
    const dbRpc = supabase as unknown as {
      rpc: (name: string, params: Record<string, string | number>) => ReturnType<typeof supabase.rpc>
    }
    devLogPixWithdrawal("rpc", fn, args)
    const { data, error } = await dbRpc.rpc(fn, args)
    devLogPixWithdrawal("rpc resultado", fn, { error: error?.message ?? null, data })
    if (error) {
      const err = error as { message?: string; details?: string; hint?: string }
      const parts = [err.message, err.details, err.hint].filter(
        (s): s is string => typeof s === "string" && s.length > 0
      )
      return {
        ok: false,
        code: "rpc_error",
        message: parts.join(" · ") || `Falha ao executar ${fn}.`,
      }
    }
    return parsePixWithdrawalRpc(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, code: "exception", message: msg }
  }
}

/** Retorna `indicator_profile_id` do payment, ou null se não encontrado. Nunca lança. */
async function fetchPaymentIndicatorId(paymentId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { data } = await db
      .from("payments")
      .select("indicator_profile_id")
      .eq("id", paymentId)
      .maybeSingle()
    return (data as { indicator_profile_id?: string } | null)?.indicator_profile_id ?? null
  } catch {
    return null
  }
}

export async function requestPixWithdrawalFromSupabase(
  amount: number
): Promise<import("@/types/payment").PixWithdrawalRpcResult> {
  const result = await rpcPixWithdrawal("request_pix_withdrawal", { p_amount: amount })

  if (result.ok) {
    // Evento 4 — notificar admins financeiro/master
    void insertNotificationForAdmins({
      notification_type: "carteira",
      title: "Novo saque Pix solicitado",
      message: "Um indicador solicitou saque Pix e aguarda análise.",
      data: {
        action: "pix_withdrawal_requested",
        payment_id: result.paymentId ?? null,
      },
    })
  }

  return result
}

export async function approvePixWithdrawalFromSupabase(
  paymentId: string
): Promise<import("@/types/payment").PixWithdrawalRpcResult> {
  const gate = await assertAdminFinanceOrMasterForSensitiveAction()
  if (!gate.ok) {
    return { ok: false, code: "forbidden", message: gate.message }
  }
  const result = await rpcPixWithdrawal("approve_pix_withdrawal", { p_payment_id: paymentId })

  if (result.ok) {
    // Evento 5 — notificar indicador: saque aprovado
    const indicatorId = await fetchPaymentIndicatorId(paymentId)
    if (indicatorId) {
      void insertNotification({
        profile_id: indicatorId,
        notification_type: "carteira",
        title: "Saque Pix aprovado",
        message: "Sua solicitação de saque Pix foi aprovada e aguarda envio.",
        data: {
          action: "pix_withdrawal_approved",
          payment_id: paymentId,
        },
      })
    }
  }

  return result
}

export async function rejectPixWithdrawalFromSupabase(
  paymentId: string,
  reason: string
): Promise<import("@/types/payment").PixWithdrawalRpcResult> {
  const gate = await assertAdminFinanceOrMasterForSensitiveAction()
  if (!gate.ok) {
    return { ok: false, code: "forbidden", message: gate.message }
  }
  const result = await rpcPixWithdrawal("reject_pix_withdrawal", {
    p_payment_id: paymentId,
    p_reason: reason,
  })

  if (result.ok) {
    // Evento 6 — notificar indicador: saque rejeitado
    const indicatorId = await fetchPaymentIndicatorId(paymentId)
    if (indicatorId) {
      const reasonTrimmed = reason.trim()
      const message = reasonTrimmed
        ? `Sua solicitação de saque Pix foi rejeitada. Motivo: ${reasonTrimmed}`
        : "Sua solicitação de saque Pix foi rejeitada."
      void insertNotification({
        profile_id: indicatorId,
        notification_type: "carteira",
        title: "Saque Pix rejeitado",
        message,
        data: {
          action: "pix_withdrawal_rejected",
          payment_id: paymentId,
          reason: reasonTrimmed || null,
        },
      })
    }
  }

  return result
}

export async function completePixWithdrawalFromSupabase(
  paymentId: string,
  receiptUrl: string
): Promise<import("@/types/payment").PixWithdrawalRpcResult> {
  const gate = await assertAdminFinanceOrMasterForSensitiveAction()
  if (!gate.ok) {
    return { ok: false, code: "forbidden", message: gate.message }
  }
  const result = await rpcPixWithdrawal("complete_pix_withdrawal", {
    p_payment_id: paymentId,
    p_receipt_url: receiptUrl,
  })

  if (result.ok) {
    // Evento 7 — notificar indicador: saque concluído
    const indicatorId = await fetchPaymentIndicatorId(paymentId)
    if (indicatorId) {
      void insertNotification({
        profile_id: indicatorId,
        notification_type: "carteira",
        title: "Saque Pix concluído",
        message: "Seu saque Pix foi concluído. O comprovante já está disponível.",
        data: {
          action: "pix_withdrawal_completed",
          payment_id: paymentId,
        },
      })
    }
  }

  return result
}

/**
 * Saldo atual (último balance_after) do indicador logado.
 */
export async function loadIndicadorWalletBalanceFromSupabase(): Promise<number | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null
    const { data, error } = await db
      .from("wallet_transactions")
      .select("balance_after")
      .eq("indicator_profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      devWarnPixWithdrawal(`wallet_transactions: ${error.message}`)
      return null
    }
    if (!data) return 0
    return Number((data as { balance_after: number | string }).balance_after)
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return null
  }
}

export type WalletTransactionListItem = {
  id: string
  tipo: string
  valor: number
  descricao: string
  saldoApos: number
  createdAt: Date
}

/**
 * Últimas movimentações da carteira do indicador logado.
 */
export async function loadIndicadorWalletTransactionsFromSupabase(
  limit = 25
): Promise<WalletTransactionListItem[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null
    const { data, error } = await db
      .from("wallet_transactions")
      .select("id, transaction_type, amount, description, balance_after, created_at")
      .eq("indicator_profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) {
      devWarnPixWithdrawal(`wallet list: ${error.message}`)
      return null
    }
    return (data ?? []).map((raw: unknown) => {
      const row = raw as {
        id: string
        transaction_type: string
        amount: number | string
        description: string
        balance_after: number | string
        created_at: string
      }
      return {
        id: row.id,
        tipo: row.transaction_type,
        valor: Number(row.amount),
        descricao: row.description,
        saldoApos: Number(row.balance_after),
        createdAt: new Date(row.created_at),
      }
    })
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return null
  }
}

export type IndicadorCarteiraSupabasePayload = {
  userId: string
  availableBalance: number
  pendingRewardsTotal: number
  creditTotal: number
  discountBalance: number
  movimentacoes: WalletTransactionListItem[]
  chavePix: string | null
  rewardsCount: number
}

/**
 * Carteira do indicador autenticado: saldo (último balance_after), totais e movimentações.
 * Retorna null se não houver sessão, perfil inexistente ou role diferente de indicador.
 * Em erro de consulta após autenticar, preenche com zeros e lista vazia (não simula dados).
 */
export async function loadIndicadorCarteiraFromSupabase(): Promise<IndicadorCarteiraSupabasePayload | null> {
  const supabase = getSupabaseClient()
  const db = supabase as unknown as {
    from: (t: string) => ReturnType<typeof supabase.from>
  }
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (profileError || !profile) return null
  if ((profile as { role: string }).role !== "indicador") return null

  const uid = user.id

  try {
    const [wtLatestRes, wtCreditsRes, rewardsRes, movRes, pixRes] = await Promise.all([
      db
        .from("wallet_transactions")
        .select("balance_after")
        .eq("indicator_profile_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("wallet_transactions")
        .select("amount")
        .eq("indicator_profile_id", uid)
        .eq("transaction_type", "credito"),
      db
        .from("rewards")
        .select("amount, status, reward_type")
        .eq("indicator_profile_id", uid),
      db
        .from("wallet_transactions")
        .select("id, transaction_type, amount, description, balance_after, created_at")
        .eq("indicator_profile_id", uid)
        .order("created_at", { ascending: false })
        .limit(30),
      db
        .from("pix_keys")
        .select("key_value")
        .eq("profile_id", uid)
        .eq("is_primary", true)
        .maybeSingle(),
    ])

    if (wtLatestRes.error) {
      devWarnPixWithdrawal(`carteira saldo: ${wtLatestRes.error.message}`)
    }
    if (wtCreditsRes.error) {
      devWarnPixWithdrawal(`carteira créditos: ${wtCreditsRes.error.message}`)
    }
    if (rewardsRes.error) {
      devWarnPixWithdrawal(`carteira rewards: ${rewardsRes.error.message}`)
    }
    if (movRes.error) {
      devWarnPixWithdrawal(`carteira movimentações: ${movRes.error.message}`)
    }
    if (pixRes.error) {
      devWarnPixWithdrawal(`carteira pix_keys: ${pixRes.error.message}`)
    }

    const availableBalance =
      !wtLatestRes.error && wtLatestRes.data
        ? Number((wtLatestRes.data as { balance_after: number | string }).balance_after)
        : 0

    let creditTotal = 0
    if (!wtCreditsRes.error && wtCreditsRes.data) {
      for (const row of wtCreditsRes.data as { amount: number | string }[]) {
        creditTotal += Number(row.amount)
      }
    }

    const rewards = !rewardsRes.error && rewardsRes.data
      ? (rewardsRes.data as RewardRow[])
      : []

    let pendingRewardsTotal = 0
    let discountBalance = 0
    for (const rw of rewards) {
      const amt = Number(rw.amount)
      if (rw.status === "pendente") pendingRewardsTotal += amt
      if (
        (rw.status === "disponivel" || rw.status === "solicitado") &&
        rw.reward_type === "desconto_fatura"
      ) {
        discountBalance += amt
      }
    }

    const movimentacoes: WalletTransactionListItem[] =
      !movRes.error && movRes.data
        ? (movRes.data as unknown[]).map((raw: unknown) => {
            const row = raw as {
              id: string
              transaction_type: string
              amount: number | string
              description: string
              balance_after: number | string
              created_at: string
            }
            return {
              id: row.id,
              tipo: row.transaction_type,
              valor: Number(row.amount),
              descricao: row.description,
              saldoApos: Number(row.balance_after),
              createdAt: new Date(row.created_at),
            }
          })
        : []

    const chavePix =
      !pixRes.error && pixRes.data
        ? String((pixRes.data as { key_value: string }).key_value)
        : null

    const rewardsCount = rewards.length

    if (isDev()) {
      console.log("[wallet:debug]", {
        userId: uid,
        availableBalance,
        pendingRewardsTotal,
        creditTotal,
        transactionsCount: movimentacoes.length,
        rewardsCount,
      })
    }

    return {
      userId: uid,
      availableBalance,
      pendingRewardsTotal,
      creditTotal,
      discountBalance,
      movimentacoes,
      chavePix,
      rewardsCount,
    }
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return {
      userId: uid,
      availableBalance: 0,
      pendingRewardsTotal: 0,
      creditTotal: 0,
      discountBalance: 0,
      movimentacoes: [],
      chavePix: null,
      rewardsCount: 0,
    }
  }
}

/**
 * Chave Pix primária do indicador logado. Sem linha → `{ keyType: "cpf", keyValue: "" }`.
 * `null` só em erro / perfil não indicador.
 */
export async function loadIndicadorPrimaryPixKeyFromSupabase(): Promise<{
  keyType: TipoChavePix
  keyValue: string
} | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) return null
    if ((profile as { role: string }).role !== "indicador") return null

    const { data, error } = await db
      .from("pix_keys")
      .select("key_type, key_value")
      .eq("profile_id", user.id)
      .eq("is_primary", true)
      .maybeSingle()

    if (error) {
      devWarnPixWithdrawal(`pix_keys chave-pix: ${error.message}`)
      return null
    }

    if (!data) {
      return { keyType: "cpf", keyValue: "" }
    }

    const row = data as { key_type: string; key_value: string }
    const allowed: TipoChavePix[] = ["cpf", "cnpj", "email", "telefone", "aleatoria"]
    const keyType = (allowed.includes(row.key_type as TipoChavePix)
      ? row.key_type
      : "cpf") as TipoChavePix

    return { keyType, keyValue: row.key_value ?? "" }
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return null
  }
}

const PAYMENTS_SELECT = `
  id,
  indicator_profile_id,
  referral_id,
  reward_id,
  amount,
  reward_type,
  status,
  due_date,
  paid_at,
  receipt_url,
  notes,
  approved_by_profile_id,
  created_at,
  updated_at,
  payment_kind,
  rejection_reason,
  pix_key_snapshot,
  pix_key_type,
  wallet_debit_transaction_id,
  referrals ( referred_name, plan_id )
`

/**
 * Pagamentos do indicador logado (inclui saques Pix).
 */
export async function loadIndicadorPagamentosFromSupabase(): Promise<Pagamento[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      devWarnPixWithdrawal("sem sessão para listar pagamentos")
      return null
    }
    const { data, error } = await db
      .from("payments")
      .select(PAYMENTS_SELECT)
      .eq("indicator_profile_id", user.id)
      .order("created_at", { ascending: false })
    if (error) {
      devWarnPixWithdrawal(`payments: ${error.message}`)
      return null
    }
    const mapped = ((data ?? []) as PaymentRowDb[]).map(paymentRowToPagamento)
    return await expandPaymentReceiptUrlsInPagamentos(mapped)
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return null
  }
}

const ADMIN_PAYMENT_ROLES = new Set(["admin_master", "admin_financeiro", "admin_consulta"])

const ADMIN_PIX_PENDING_BADGE_ROLES = new Set(["admin_master", "admin_financeiro"])

/**
 * Quantidade de saques Pix aguardando ação do financeiro (pendente ou aprovado aguardando comprovante).
 * Apenas `admin_master` ou `admin_financeiro`. Retorna 0 se não houver linhas; null em falha de consulta ou sem permissão.
 */
export async function countAdminPendingPixWithdrawalsFromSupabase(): Promise<
  number | null
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PIX_PENDING_BADGE_ROLES.has(role)) {
      return null
    }

    const { count, error } = await db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("payment_kind", "pix_withdrawal")
      .in("status", ["pendente", "aprovado"])

    if (error) {
      devWarnPixWithdrawal(
        `countAdminPendingPixWithdrawals: ${error.message}`
      )
      return null
    }
    return count ?? 0
  } catch (e) {
    devWarnPixWithdrawal(
      e instanceof Error ? e.message : String(e)
    )
    return null
  }
}

const SIDEBAR_COUNTS_LOG_PREFIX = "[sidebar-counts:supabase]"

function devWarnSidebarCounts(reason: string): void {
  if (isDev()) {
    console.warn(SIDEBAR_COUNTS_LOG_PREFIX, reason)
  }
}

/**
 * Leads em pipeline do comercial: referrals atribuídas ao usuário ou em pool (`commercial_profile_id` nulo),
 * com status `pendente`, `em_atendimento`, `em_andamento` ou `em_negociacao`.
 */
export async function countComercialPipelineReferralsFromSupabase(): Promise<
  number | null
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || role !== "comercial") {
      return null
    }

    const orFilter = `commercial_profile_id.eq.${user.id},commercial_profile_id.is.null`
    const { count, error } = await db
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .or(orFilter)
      .in("status", ["pendente", "em_atendimento", "em_andamento", "em_negociacao"])

    if (error) {
      devWarnSidebarCounts(`countComercialPipelineReferrals: ${error.message}`)
      return null
    }
    return count ?? 0
  } catch (e) {
    devWarnSidebarCounts(
      `countComercialPipelineReferrals exceção: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

/**
 * Retornos agendados futuros do comercial. O schema atual de `referrals` não possui campo de data de retorno;
 * retorna 0 para comercial autenticado e `null` sem sessão ou se não for comercial.
 */
export async function countComercialScheduledReturnsFromSupabase(): Promise<
  number | null
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || role !== "comercial") {
      return null
    }
    return 0
  } catch (e) {
    devWarnSidebarCounts(
      `countComercialScheduledReturns exceção: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

/**
 * Total de indicações visíveis ao admin (mesmas roles que `loadAdminReferralsFromSupabase`).
 */
export async function countAdminReferralsFromSupabase(): Promise<number | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PORTAL_READ_ROLES.has(role)) {
      return null
    }

    const { count, error } = await db
      .from("referrals")
      .select("id", { count: "exact", head: true })

    if (error) {
      devWarnSidebarCounts(`countAdminReferrals: ${error.message}`)
      return null
    }
    return count ?? 0
  } catch (e) {
    devWarnSidebarCounts(
      `countAdminReferrals exceção: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

/**
 * Indicadores ativos (`role = indicador` e `is_active = true`).
 */
export async function countAdminActiveIndicadoresFromSupabase(): Promise<
  number | null
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PORTAL_READ_ROLES.has(role)) {
      return null
    }

    const { count, error } = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "indicador")
      .eq("is_active", true)

    if (error) {
      devWarnSidebarCounts(`countAdminActiveIndicadores: ${error.message}`)
      return null
    }
    return count ?? 0
  } catch (e) {
    devWarnSidebarCounts(
      `countAdminActiveIndicadores exceção: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

/**
 * Lista saques Pix (admin). Filtro por status opcional.
 */
export async function loadAdminPixWithdrawalsFromSupabase(
  status?: "pendente" | "aprovado" | "pago" | "rejeitado" | "todos"
): Promise<Pagamento[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      return null
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role, email, full_name")
      .eq("id", user.id)
      .maybeSingle()

    const role = ((profile as { role?: UserRole } | null)?.role ?? null) as UserRole | null
    if (profileError || !role || !ADMIN_FINANCE_MASTER_ROLES.has(role)) {
      devWarnPixWithdrawal(
        `role sem acesso à lista admin: ${role} (profileError: ${profileError?.message ?? "nenhum"})`
      )
      return null
    }

    let q = db
      .from("payments")
      .select(PAYMENTS_SELECT)
      .eq("payment_kind", "pix_withdrawal")
      .order("created_at", { ascending: false })

    /**
     * Status em `public.payment_status`: pendente | aprovado | pago | cancelado | rejeitado
     * (schema.sql). Esta tela só lista saques em análise ou aguardando comprovante.
     */
    if (status === "pendente" || status === "aprovado") {
      q = q.in("status", ["pendente", "aprovado"]).eq("status", status)
    } else if (status && status !== "todos") {
      q = q.eq("status", status)
    } else {
      q = q.in("status", ["pendente", "aprovado"])
    }

    const { data, error } = await q
    if (error) {
      devWarnPixWithdrawal(`admin payments: ${error.message}`)
      return null
    }

    const rows = (data ?? []) as PaymentRowDb[]
    const indicatorIds = [...new Set(rows.map((r) => r.indicator_profile_id))]
    const profileMap = new Map<string, AdminProfileShortRow>()
    if (indicatorIds.length > 0) {
      const { data: profs, error: pErr } = await db
        .from("profiles")
        .select("id, full_name, email, phone, cpf, is_active, created_at")
        .in("id", indicatorIds)
      if (!pErr && profs) {
        for (const pr of profs as AdminProfileShortRow[]) {
          profileMap.set(pr.id, pr)
        }
      }
    }

    const mappedBase = rows.map((row) => {
      const p = paymentRowToPagamento(row)
      const pr = profileMap.get(row.indicator_profile_id)
      if (pr) {
        p.indicador = stubIndicadorFromAdminProfile(row.indicator_profile_id, {
          full_name: pr.full_name,
          email: pr.email,
          phone: pr.phone,
          cpf: pr.cpf,
          is_active: pr.is_active,
          created_at: pr.created_at,
        })
      }
      return p
    })
    const mapped = await expandPaymentReceiptUrlsInPagamentos(mappedBase)

    return mapped
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * Todos os pagamentos (admin): indicações e saques Pix.
 */
export async function loadAdminAllPaymentsFromSupabase(): Promise<Pagamento[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PAYMENT_ROLES.has(role)) {
      devWarnPixWithdrawal(`role sem acesso à lista admin pagamentos: ${role}`)
      return null
    }

    const { data, error } = await db
      .from("payments")
      .select(PAYMENTS_SELECT)
      .order("created_at", { ascending: false })
      .limit(500)

    if (error) {
      devWarnPixWithdrawal(`admin all payments: ${error.message}`)
      return null
    }
    const mapped = ((data ?? []) as PaymentRowDb[]).map(paymentRowToPagamento)
    return await expandPaymentReceiptUrlsInPagamentos(mapped)
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * Detalhe de um indicador (admin): perfil, indicações e pagamentos do perfil.
 */
export async function loadAdminIndicatorDetailFromSupabase(
  indicatorProfileId: string
): Promise<{ indicador: Indicador; indicacoes: Indicacao[]; pagamentos: Pagamento[] } | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: adminProf, error: adminErr } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const adminRole = (adminProf as { role?: string } | null)?.role ?? null
    if (adminErr || !adminRole || !ADMIN_PORTAL_READ_ROLES.has(adminRole)) {
      return null
    }

    const { data: pRow, error: pErr } = await db
      .from("profiles")
      .select("id, full_name, email, phone, cpf, is_active, created_at, role")
      .eq("id", indicatorProfileId)
      .maybeSingle()

    if (pErr || !pRow || (pRow as { role: string }).role !== "indicador") {
      return null
    }

    const p = pRow as AdminProfileShortRow

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
        first_invoice_paid_at,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at,
        updated_at
      `
      )
      .eq("indicator_profile_id", indicatorProfileId)
      .order("created_at", { ascending: false })

    if (refError) {
      return null
    }

    const referrals = (refData ?? []) as ReferralRow[]
    let aprovadas = 0
    for (const r of referrals) {
      if (r.status === "aprovada" || r.status === "paga") aprovadas += 1
    }

    const planIds = [...new Set(referrals.map((r) => r.plan_id))]
    const planoById = new Map<string, Plano>()
    if (planIds.length > 0) {
      const { data: plansData, error: plansError } = await db
        .from("plans")
        .select(
          "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
        )
        .in("id", planIds)
      if (plansError) {
        return null
      }
      for (const pr of plansData ?? []) {
        const pl = mapPlanRowToPlano(pr as PlanCatalogRow)
        planoById.set(pl.id, pl)
      }
    }

    const profileIds = new Set<string>()
    profileIds.add(p.id)
    for (const r of referrals) {
      if (r.commercial_profile_id) profileIds.add(r.commercial_profile_id)
    }
    const profileMap = new Map<string, AdminProfileShortRow>()
    profileMap.set(p.id, p)
    const extraIds = [...profileIds].filter((x) => x !== p.id)
    if (extraIds.length > 0) {
      const { data: profData, error: profError } = await db
        .from("profiles")
        .select("id, full_name, email, phone, cpf, is_active, created_at")
        .in("id", extraIds)
      if (profError) {
        return null
      }
      for (const pr of (profData ?? []) as AdminProfileShortRow[]) {
        profileMap.set(pr.id, pr)
      }
    }

    const indicacoes: Indicacao[] = referrals.map((r) => {
      const base = referralRowToIndicacaoMerged(r, r.indicator_profile_id, planoById)
      const ip = profileMap.get(r.indicator_profile_id)
      const cp = r.commercial_profile_id
        ? profileMap.get(r.commercial_profile_id)
        : undefined
      return {
        ...base,
        indicador: ip
          ? stubIndicadorFromAdminProfile(ip.id, {
              full_name: ip.full_name,
              email: ip.email,
              phone: ip.phone,
              cpf: ip.cpf,
              is_active: ip.is_active,
              created_at: ip.created_at,
            })
          : undefined,
        comercial:
          cp && r.commercial_profile_id
            ? stubComercialFromAdminProfile(r.commercial_profile_id, {
                full_name: cp.full_name,
                email: cp.email,
                phone: cp.phone,
                is_active: cp.is_active,
                created_at: cp.created_at,
              })
            : undefined,
      }
    })

    let saldoDisponivel = 0
    const { data: wtRow, error: wtErr } = await db
      .from("wallet_transactions")
      .select("balance_after")
      .eq("indicator_profile_id", indicatorProfileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!wtErr && wtRow) {
      saldoDisponivel = Number((wtRow as { balance_after: number | string }).balance_after)
    }

    const indicador: Indicador = {
      ...stubIndicadorFromAdminProfile(p.id, {
        full_name: p.full_name,
        email: p.email,
        phone: p.phone,
        cpf: p.cpf,
        is_active: p.is_active,
        created_at: p.created_at,
      }),
      totalIndicacoes: referrals.length,
      indicacoesAprovadas: aprovadas,
      totalRecebido: 0,
      saldoDisponivel,
      saldoDesconto: 0,
    }

    const { data: payData, error: payErr } = await db
      .from("payments")
      .select(PAYMENTS_SELECT)
      .eq("indicator_profile_id", indicatorProfileId)
      .order("created_at", { ascending: false })
      .limit(200)

    if (payErr) {
      return null
    }
    const pagamentosRaw = ((payData ?? []) as PaymentRowDb[]).map(paymentRowToPagamento)
    const pagamentos = await expandPaymentReceiptUrlsInPagamentos(pagamentosRaw)

    if (isDev()) {
      console.log("[supabase-query:debug]", {
        query: "loadAdminIndicatorDetailFromSupabase",
        indicatorProfileId,
        indicacoes: indicacoes.length,
        pagamentos: pagamentos.length,
      })
    }

    return { indicador, indicacoes, pagamentos }
  } catch {
    return null
  }
}

/**
 * Histórico de auditoria de um pagamento (admin).
 */
export async function loadPaymentAuditTrailFromSupabase(
  paymentId: string
): Promise<import("@/types/payment").AuditoriaPagamentoItem[] | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PAYMENT_ROLES.has(role)) return null

    const { data, error } = await db
      .from("audit_logs")
      .select("id, actor_profile_id, action, old_data, new_data, metadata, created_at")
      .eq("entity_name", "payment")
      .eq("entity_id", paymentId)
      .order("created_at", { ascending: true })

    if (error) {
      devWarnPixWithdrawal(`audit_logs: ${error.message}`)
      return null
    }

    const mapAction = (a: string): import("@/types/payment").AuditoriaPagamentoAcao => {
      const allowed: import("@/types/payment").AuditoriaPagamentoAcao[] = [
        "create",
        "update",
        "delete",
        "approve",
        "reject",
        "login",
        "logout",
      ]
      return (allowed.includes(a as import("@/types/payment").AuditoriaPagamentoAcao)
        ? a
        : "update") as import("@/types/payment").AuditoriaPagamentoAcao
    }

    return (data ?? []).map((raw: unknown) => {
      const row = raw as {
        id: string
        actor_profile_id: string | null
        action: string
        old_data: Record<string, unknown> | null
        new_data: Record<string, unknown> | null
        metadata: Record<string, unknown> | null
        created_at: string
      }
      return {
        id: row.id,
        acao: mapAction(row.action),
        actorProfileId: row.actor_profile_id,
        createdAt: new Date(row.created_at),
        dadosAnteriores: row.old_data,
        dadosNovos: row.new_data,
        metadata: row.metadata ?? {},
      }
    })
  } catch (e) {
    devWarnPixWithdrawal(e instanceof Error ? e.message : String(e))
    return null
  }
}
