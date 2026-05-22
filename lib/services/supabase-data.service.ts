import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  getCommercialSlaLevel,
  devLogCommercialSlaLevel,
} from "@/lib/commercial-sla"
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
import {
  NOTIFICATIONS_SELECT,
  NOTIFICATIONS_DB,
  buildNotificationInsertRow,
  buildNotificationMarkReadUpdate,
  mapNotificationRowFromDb,
} from "@/lib/notifications-db-map"
import {
  createNotificationForProfileFromSupabase,
  notifyAdminsOfNewReferralFromSupabase,
  notifyIndicatorRewardReleasedFromSupabase,
} from "@/lib/services/notification.service"
import type { AuthProfileBasics } from "@/types/auth-profile"
import {
  getLostReasonLabel,
  isComercialLeadRejectStatus,
  logCommercialLeadDetail,
  logIndicatorReferralDetail,
  logLeadLostReason,
  logLeadReject,
} from "@/lib/referral-lost-reasons"
import { moveReferralPipelineStageFromSupabase } from "@/lib/services/pipeline.service"

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
  lost_reason?: string | null
  lost_notes?: string | null
  lost_at?: string | null
  pipeline_stage?: string | null
  created_at: string
  updated_at: string
  assigned_at?: string | null
  first_response_at?: string | null
  last_interaction_at?: string | null
  redistribution_count?: number
  last_redistributed_at?: string | null
  previous_commercial_profile_id?: string | null
  sla_redistributed?: boolean
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

function computeReferralSlaFields(row: ReferralRow): {
  slaLevel: ReturnType<typeof getCommercialSlaLevel>
  slaOverdue: boolean
} {
  const slaLevel = getCommercialSlaLevel({
    commercialProfileId: row.commercial_profile_id,
    assignedAt: row.assigned_at,
    firstResponseAt: row.first_response_at,
    status: row.status,
  })
  if (slaLevel !== "none") {
    devLogCommercialSlaLevel(slaLevel, {
      referralId: row.id,
      commercialProfileId: row.commercial_profile_id,
      assignedAt: row.assigned_at,
      status: row.status,
    })
  }
  return { slaLevel, slaOverdue: slaLevel !== "none" }
}

function mapRedistributionFields(row: ReferralRow) {
  return {
    redistributionCount: row.redistribution_count ?? 0,
    lastRedistributedAt: row.last_redistributed_at
      ? new Date(row.last_redistributed_at)
      : undefined,
    previousCommercialId: row.previous_commercial_profile_id ?? undefined,
    slaRedistributed: Boolean(row.sla_redistributed),
  }
}

function mapReferralLostFields(row: ReferralRow): {
  motivoRecusa?: string
  observacoesRecusa?: string
  dataRecusa?: Date
} {
  const rawReason = row.lost_reason?.trim() || row.rejection_reason?.trim() || ""
  const motivoRecusa =
    getLostReasonLabel(rawReason || null) ?? (rawReason || undefined)
  const observacoesRecusa = row.lost_notes?.trim() || undefined
  const dataRecusa = row.rejected_at
    ? new Date(row.rejected_at)
    : row.lost_at
      ? new Date(row.lost_at)
      : undefined
  return {
    motivoRecusa: motivoRecusa || undefined,
    observacoesRecusa,
    dataRecusa,
  }
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
    atribuidoEm: row.assigned_at ? new Date(row.assigned_at) : undefined,
    primeiroContatoEm: row.first_response_at
      ? new Date(row.first_response_at)
      : undefined,
    ...mapReferralLostFields(row),
    ...computeReferralSlaFields(row),
    ...mapRedistributionFields(row),
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
    atribuidoEm: row.assigned_at ? new Date(row.assigned_at) : undefined,
    primeiroContatoEm: row.first_response_at
      ? new Date(row.first_response_at)
      : undefined,
    ...mapReferralLostFields(row),
    ...computeReferralSlaFields(row),
    ...mapRedistributionFields(row),
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

type NotificationRow = Record<string, unknown>

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
          return buildNotificationInsertRow({
            profile_id: admin.id,
            title: "Lead vencido por SLA sem comercial disponível",
            message:
              "Um lead está sem resposta há mais de 15 minutos e não há comercial alternativo disponível para redistribuição.",
            notificationType: "sistema",
            metadata: {
              action: "sla_no_commercial_available",
              referral_id: lead.id,
              previous_commercial_id: currentCommercialId,
              reason: "no_response_15_minutes",
            },
          })
        })

        const { data: notificationRows, error: notificationError } = await db
          .from("notifications")
          .insert(notificationsPayload)
          .select(`id, profile_id, ${NOTIFICATIONS_DB.notificationType}, created_at`)

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
      .select(NOTIFICATIONS_SELECT)
      .order(NOTIFICATIONS_DB.createdAt, { ascending: false })

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

    return (rows ?? []).flatMap((raw: unknown) => {
      const row = raw as NotificationRow
      const mapped = mapNotificationRowFromDb(row, null)
      if (!mapped) return []
      const referralIdRaw = mapped.metadata?.referral_id
      return {
        id: mapped.id,
        title: mapped.title,
        message: mapped.message,
        type: mapped.type,
        isRead: mapped.read,
        createdAt: mapped.createdAt,
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
        .eq(NOTIFICATIONS_DB.isRead, false)
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
      .update(buildNotificationMarkReadUpdate())
      .eq("id", notificationId)
      .select(`id, ${NOTIFICATIONS_DB.isRead}, ${NOTIFICATIONS_DB.readAt}`)

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

    // Distribuição automática: trigger AFTER INSERT + RPC assign_referral_to_next_commercial
    const insertPayload = {
      indicator_profile_id: user.id,
      referred_name: input.referred_name.trim(),
      referred_phone: input.referred_phone.trim(),
      referred_email: email,
      referred_address: address,
      plan_id: input.plan_id,
      reward_type: input.reward_type,
      reward_amount: input.reward_amount,
      commercial_profile_id: null,
      status: "pendente" as const,
      assigned_at: null,
      last_interaction_at: null,
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

    if (insertedReferralId) {
      devLogInsertReferral("notify admins — disparo", { insertedReferralId })
      void notifyAdminsOfNewReferralFromSupabase({ referralId: insertedReferralId })
    } else {
      devLogInsertReferral("notify admins omitido — insert sem id retornado", {
        rowCount: insertedRows?.length ?? 0,
        insertError: insertError?.message ?? null,
      })
    }

    devLogInsertReferral(
      "distribuição automática delegada ao trigger assign_referral_to_next_commercial",
      { insertedReferralId }
    )

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

/** Metadados de diagnóstico dos loaders de referrals (admin / comercial). */
export type ReferralsLoadMeta = {
  authUserId: string | null
  profileId: string | null
  role: string | null
  queryLabel: string
  filter: string | null
  selectColumns: string
  referralRowCount: number
  commercialProfileIdsSample: string[]
}

export type ReferralsLoadResult<T> =
  | { ok: true; data: T[]; meta: ReferralsLoadMeta }
  | {
      ok: false
      data: []
      error: string
      code?: string
      details?: string
      hint?: string
      meta: ReferralsLoadMeta
    }

const REFERRALS_LIST_SELECT_CORE = `
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

const REFERRALS_LIST_SELECT_EXTENDED = `
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
        assigned_at,
        first_response_at,
        redistribution_count,
        last_redistributed_at,
        previous_commercial_profile_id,
        sla_redistributed,
        created_at,
        updated_at
      `

function isMissingColumnPostgrestError(
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

function formatPostgrestError(error: {
  message?: string
  code?: string
  details?: string
  hint?: string
} | null): string {
  if (!error) return "Erro desconhecido na consulta."
  return [
    error.message,
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ]
    .filter(Boolean)
    .join(" | ")
}

function buildReferralsLoadMeta(
  partial: Partial<ReferralsLoadMeta>
): ReferralsLoadMeta {
  return {
    authUserId: null,
    profileId: null,
    role: null,
    queryLabel: "referrals",
    filter: null,
    selectColumns: REFERRALS_LIST_SELECT_EXTENDED,
    referralRowCount: 0,
    commercialProfileIdsSample: [],
    ...partial,
  }
}

function sampleCommercialProfileIds(rows: ReferralRow[], limit = 8): string[] {
  const ids: string[] = []
  for (const r of rows) {
    if (r.commercial_profile_id && !ids.includes(r.commercial_profile_id)) {
      ids.push(r.commercial_profile_id)
      if (ids.length >= limit) return ids
    }
  }
  return ids
}

type ReferralsDb = {
  from: (t: string) => ReturnType<ReturnType<typeof getSupabaseClient>["from"]>
}

async function fetchReferralsListRows(
  db: ReferralsDb,
  opts: {
    logTag: "admin-indicacoes" | "commercial-leads"
    queryLabel: string
    applyFilter?: (qb: ReturnType<ReferralsDb["from"]>) => ReturnType<ReferralsDb["from"]>
  }
): Promise<{
  rows: ReferralRow[]
  selectUsed: string
  error: { message?: string; code?: string; details?: string; hint?: string } | null
}> {
  const selects = [REFERRALS_LIST_SELECT_EXTENDED, REFERRALS_LIST_SELECT_CORE]
  let lastError: {
    message?: string
    code?: string
    details?: string
    hint?: string
  } | null = null

  for (let i = 0; i < selects.length; i++) {
    const selectUsed = selects[i]
    let qb = db.from("referrals").select(selectUsed)
    if (opts.applyFilter) {
      qb = opts.applyFilter(qb)
    }
    const queryDesc = `${opts.queryLabel} | referrals.select`

    try {
      const { data } = await qb
        .order("created_at", { ascending: false })
        .limit(2000)
        .throwOnError()
      const rows = (data ?? []) as ReferralRow[]
      console.log(`[${opts.logTag}:supabase-query]`, {
        query: queryDesc,
        selectVariant: i === 0 ? "extended" : "core",
        rowsReturned: rows.length,
        error: null,
      })
      return { rows, selectUsed, error: null }
    } catch (thrown) {
      const error =
        thrown &&
        typeof thrown === "object" &&
        "message" in thrown
          ? (thrown as {
              message?: string
              code?: string
              details?: string
              hint?: string
            })
          : { message: thrown instanceof Error ? thrown.message : String(thrown) }
      lastError = error
      console.error(`[${opts.logTag}:error]`, error)
      console.log(`[${opts.logTag}:supabase-query]`, {
        query: queryDesc,
        selectVariant: i === 0 ? "extended" : "core",
        rowsReturned: 0,
        error,
      })
      if (isMissingColumnPostgrestError(error) && i < selects.length - 1) {
        console.warn(
          `[${opts.logTag}:error] coluna ausente — retry com SELECT reduzido`
        )
        continue
      }
      return { rows: [], selectUsed, error }
    }
  }

  return { rows: [], selectUsed: selects[selects.length - 1]!, error: lastError }
}

async function loadPlansMapForReferralRows(
  db: ReferralsDb,
  referrals: ReferralRow[],
  logTag: "admin-indicacoes" | "commercial-leads"
): Promise<Map<string, Plano>> {
  const planoById = new Map<string, Plano>()
  const planIds = [...new Set(referrals.map((r) => r.plan_id))]
  if (planIds.length === 0) return planoById

  try {
    const { data: plansData } = await db
      .from("plans")
      .select(
        "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
      )
      .in("id", planIds)
      .throwOnError()
    for (const pr of plansData ?? []) {
      const p = mapPlanRowToPlano(pr as PlanCatalogRow)
      planoById.set(p.id, p)
    }
    console.log(`[${logTag}:supabase-query]`, {
      query: "plans.in(planIds)",
      rowsReturned: plansData?.length ?? 0,
      error: null,
    })
  } catch (thrown) {
    const error =
      thrown &&
      typeof thrown === "object" &&
      "message" in thrown
        ? thrown
        : { message: thrown instanceof Error ? thrown.message : String(thrown) }
    console.error(`[${logTag}:error]`, { step: "plans", error })
    console.log(`[${logTag}:supabase-query]`, {
      query: "plans.in(planIds)",
      rowsReturned: 0,
      error,
    })
  }
  return planoById
}

/**
 * Todas as indicações (admin). Sem filtro de status/pipeline na query principal.
 */
export async function loadAdminReferralsFromSupabase(): Promise<
  ReferralsLoadResult<Indicacao>
> {
  let meta = buildReferralsLoadMeta({
    queryLabel: "referrals.admin.all",
    filter: null,
  })

  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as ReferralsDb
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()

    meta = { ...meta, authUserId: user?.id ?? null }

    if (authErr || !user) {
      const error = authErr?.message ?? "Sessão ausente"
      console.error("[admin-indicacoes:error]", { step: "auth", error: authErr ?? error })
      return { ok: false, data: [], error, meta }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const profileId = (profile as { id?: string } | null)?.id ?? user.id
    const role = (profile as { role?: string } | null)?.role ?? null
    meta = { ...meta, profileId, role }

    console.log("[admin-indicacoes:session]", {
      authUserId: user.id,
      profileId,
      role,
      profileError: profileError?.message ?? null,
    })

    if (profileError || !role || !ADMIN_PORTAL_READ_ROLES.has(role)) {
      const error =
        profileError?.message ??
        `Sem permissão admin (role=${role ?? "ausente"})`
      console.error("[admin-indicacoes:error]", { step: "profile", error })
      return {
        ok: false,
        data: [],
        error,
        code: profileError?.code,
        meta,
      }
    }

    const { rows: referrals, selectUsed, error: refError } =
      await fetchReferralsListRows(db, {
        logTag: "admin-indicacoes",
        queryLabel: "referrals.admin.all",
      })

    meta = {
      ...meta,
      selectColumns: selectUsed,
      referralRowCount: referrals.length,
      commercialProfileIdsSample: sampleCommercialProfileIds(referrals),
    }

    if (refError) {
      return {
        ok: false,
        data: [],
        error: formatPostgrestError(refError),
        code: refError.code,
        details: refError.details,
        hint: refError.hint,
        meta,
      }
    }

    const planoById = await loadPlansMapForReferralRows(
      db,
      referrals,
      "admin-indicacoes"
    )

    const profileIds = new Set<string>()
    for (const r of referrals) {
      profileIds.add(r.indicator_profile_id)
      if (r.commercial_profile_id) profileIds.add(r.commercial_profile_id)
      if (r.previous_commercial_profile_id) {
        profileIds.add(r.previous_commercial_profile_id)
      }
    }
    const profileList = [...profileIds]

    const profileMap = new Map<string, AdminProfileShortRow>()
    if (profileList.length > 0) {
      try {
        const { data: profData } = await db
          .from("profiles")
          .select("id, full_name, email, phone, cpf, is_active, created_at")
          .in("id", profileList)
          .throwOnError()
        for (const pr of (profData ?? []) as AdminProfileShortRow[]) {
          profileMap.set(pr.id, pr)
        }
        console.log("[admin-indicacoes:supabase-query]", {
          query: "profiles.in(ids)",
          rowsReturned: profData?.length ?? 0,
          error: null,
        })
      } catch (thrown) {
        const error =
          thrown &&
          typeof thrown === "object" &&
          "message" in thrown
            ? thrown
            : {
                message:
                  thrown instanceof Error ? thrown.message : String(thrown),
              }
        console.error("[admin-indicacoes:error]", { step: "profiles", error })
        console.log("[admin-indicacoes:supabase-query]", {
          query: "profiles.in(ids)",
          rowsReturned: 0,
          error,
        })
      }
    }

    const mapped: Indicacao[] = referrals.map((r) => {
      const base = referralRowToIndicacaoMerged(r, r.indicator_profile_id, planoById)
      const ip = profileMap.get(r.indicator_profile_id)
      const cp = r.commercial_profile_id
        ? profileMap.get(r.commercial_profile_id)
        : undefined
      const prevCp = r.previous_commercial_profile_id
        ? profileMap.get(r.previous_commercial_profile_id)
        : undefined
      return {
        ...base,
        previousCommercialNome: prevCp?.full_name ?? undefined,
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

    console.log("[admin-indicacoes:result]", {
      authUserId: meta.authUserId,
      profileId: meta.profileId,
      role: meta.role,
      referralRowCount: meta.referralRowCount,
      mappedCount: mapped.length,
      commercialProfileIdsSample: meta.commercialProfileIdsSample,
    })

    return { ok: true, data: mapped, meta }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error("[admin-indicacoes:error]", e)
    return { ok: false, data: [], error, meta }
  }
}

const ADMIN_REFERRAL_MUTATION_ROLES = new Set<UserRole>(["admin_master", "admin_financeiro"])

const ADMIN_REFERRAL_STATUS_VALUES = new Set<string>([
  "pendente",
  "em_andamento",
  "em_atendimento",
  "em_negociacao",
  "aprovada",
  "recusada",
])

export type AdminReferralMutationResult =
  | { ok: true }
  | { ok: false; message: string }

export type AdminReferralDetailResult =
  | { kind: "ok"; indicacao: Indicacao; historico: Historico[] }
  | { kind: "not-found" }
  | { kind: "error" }

function logAdminReferralsAssign(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[admin-referrals:assign]", ...args)
}

function logAdminReferralsStatus(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[admin-referrals:status]", ...args)
}

function logAdminAssignUpdate(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[admin-assign:update]", ...args)
}

function logAdminStatusUpdate(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[admin-status:update]", ...args)
}

function uuidEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false
  const na = String(a).replace(/-/g, "").toLowerCase()
  const nb = String(b).replace(/-/g, "").toLowerCase()
  return na.length > 0 && na === nb
}

function mapReferralHistoryRowsToHistorico(
  referralId: string,
  historyRows: unknown[],
  actorById: Map<string, { full_name: string; phone: string | null }>
): Historico[] {
  return (historyRows ?? []).map((raw: unknown) => {
    const h = raw as ReferralHistoryRow
    const actor = h.actor_profile_id ? actorById.get(h.actor_profile_id) : null
    const meta =
      h.metadata && typeof h.metadata === "object"
        ? (h.metadata as Record<string, unknown>)
        : null
    const metaAction =
      meta && typeof meta.action === "string" ? meta.action : null
    const lostReasonRaw =
      meta && typeof meta.lost_reason === "string" ? meta.lost_reason : null
    const lostNotesRaw =
      meta && typeof meta.lost_notes === "string" ? meta.lost_notes : null
    const lostReasonLabel = getLostReasonLabel(lostReasonRaw) ?? lostReasonRaw

    const isRejectEvent =
      metaAction === "lead_lost" ||
      metaAction === "referral_rejected" ||
      h.new_status === "recusada"

    let acao = h.action_note?.trim() || "Atualização de lead"
    if (isRejectEvent) {
      acao = acao || "Lead recusado"
    }

    const descParts: string[] = []
    if (h.old_status && h.old_status !== h.new_status) {
      descParts.push(`Status: ${h.old_status} → ${h.new_status}`)
    } else if (h.new_status) {
      descParts.push(`Status: ${h.new_status}`)
    }
    if (lostReasonLabel) {
      descParts.push(`Motivo: ${lostReasonLabel}`)
    }
    if (lostNotesRaw?.trim()) {
      descParts.push(`Observação: ${lostNotesRaw.trim()}`)
    }
    if (!isRejectEvent && metaAction) {
      descParts.push(`Ação: ${metaAction}`)
    }

    return {
      id: h.id,
      leadId: referralId,
      comercialId: h.actor_profile_id ?? "",
      comercial: h.actor_profile_id
        ? stubComercialProfile(
            h.actor_profile_id,
            actor?.full_name ?? "Ator",
            actor?.phone ?? ""
          )
        : undefined,
      acao,
      descricao: descParts.filter(Boolean).join(" • "),
      createdAt: new Date(h.created_at),
    }
  })
}

/**
 * Detalhe de uma indicação para o painel admin (leitura: admin_consulta | admin_financeiro | admin_master).
 */
export async function loadAdminReferralDetailFromSupabase(
  referralId: string
): Promise<AdminReferralDetailResult> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return { kind: "error" }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const role = (profile as { role?: string } | null)?.role ?? null
    if (profileError || !role || !ADMIN_PORTAL_READ_ROLES.has(role)) {
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
        lost_reason,
        lost_notes,
        lost_at,
        created_at,
        updated_at,
        assigned_at,
        first_response_at,
        last_interaction_at
      `
      )
      .eq("id", referralId)
      .maybeSingle()

    if (refError || !row) {
      if (isDev()) {
        console.log("[admin-indicacoes:detail]", { referralId, error: refError?.message })
      }
      return refError ? { kind: "error" } : { kind: "not-found" }
    }

    logLeadLostReason("admin-detail-load", (row as ReferralRow).lost_reason)

    const refRow = row as ReferralRow

    const { data: planRow, error: planError } = await db
      .from("plans")
      .select(
        "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
      )
      .eq("id", refRow.plan_id)
      .maybeSingle()

    if (planError) {
      return { kind: "error" }
    }

    const planoById = new Map<string, Plano>()
    if (planRow) {
      planoById.set(refRow.plan_id, mapPlanRowToPlano(planRow as PlanCatalogRow))
    }

    const profileIds = new Set<string>()
    profileIds.add(refRow.indicator_profile_id)
    if (refRow.commercial_profile_id) profileIds.add(refRow.commercial_profile_id)

    const profileMap = new Map<string, AdminProfileShortRow>()
    const profileList = [...profileIds]
    if (profileList.length > 0) {
      const { data: profData, error: profError } = await db
        .from("profiles")
        .select("id, full_name, email, phone, cpf, is_active, created_at")
        .in("id", profileList)

      if (profError) {
        return { kind: "error" }
      }
      for (const pr of (profData ?? []) as AdminProfileShortRow[]) {
        profileMap.set(pr.id, pr)
      }
    }

    const ip = profileMap.get(refRow.indicator_profile_id)
    const cp = refRow.commercial_profile_id
      ? profileMap.get(refRow.commercial_profile_id)
      : undefined

    const indicacao: Indicacao = {
      ...referralRowToIndicacaoMerged(refRow, refRow.indicator_profile_id, planoById),
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
        cp && refRow.commercial_profile_id
          ? stubComercialFromAdminProfile(refRow.commercial_profile_id, {
              full_name: cp.full_name,
              email: cp.email,
              phone: cp.phone,
              is_active: cp.is_active,
              created_at: cp.created_at,
            })
          : undefined,
    }

    const { data: historyRows, error: historyError } = await db
      .from("referral_history")
      .select(
        "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
      )
      .eq("referral_id", referralId)
      .order("created_at", { ascending: false })

    if (historyError) {
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

      if (actorError) {
        return { kind: "error" }
      }
      for (const row of actorRows ?? []) {
        const a = row as { id: string; full_name: string; phone: string | null }
        actorById.set(a.id, { full_name: a.full_name, phone: a.phone })
      }
    }

    const historico = mapReferralHistoryRowsToHistorico(
      referralId,
      historyRows ?? [],
      actorById
    )

    return { kind: "ok", indicacao, historico }
  } catch {
    return { kind: "error" }
  }
}

/**
 * Admin atribui comercial ao referral. Apenas admin_master | admin_financeiro.
 */
export async function assignReferralToCommercialFromSupabase(
  referralId: string,
  commercialProfileId: string
): Promise<AdminReferralMutationResult> {
  if (isDataProviderMock()) {
    logAdminReferralsAssign("bloqueado — DATA_PROVIDER/NEXT_PUBLIC_DATA_PROVIDER = mock")
    return { ok: false, message: "Indisponível no modo mock." }
  }

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
      logAdminReferralsAssign("sem sessão")
      return { ok: false, message: "Sessão inválida." }
    }

    const { data: actorProfile, error: actorProfileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const actorRole = (actorProfile as { role?: UserRole } | null)?.role ?? null
    if (actorProfileError || !actorRole || !ADMIN_REFERRAL_MUTATION_ROLES.has(actorRole)) {
      logAdminReferralsAssign("perfil sem permissão", { actorRole })
      return { ok: false, message: "Sem permissão para atribuir comercial." }
    }

    const { data: target, error: targetErr } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", commercialProfileId)
      .maybeSingle()
    const targetRole = (target as { role?: string } | null)?.role
    if (targetErr || !target || targetRole !== "comercial") {
      logAdminReferralsAssign("comercial inválido", { commercialProfileId, targetErr })
      return { ok: false, message: "Comercial inválido ou inativo." }
    }

    const { data: refRow, error: refFetchErr } = await db
      .from("referrals")
      .select("id, status, commercial_profile_id")
      .eq("id", referralId)
      .maybeSingle()

    if (refFetchErr || !refRow) {
      logAdminReferralsAssign("referral não encontrado", { referralId, refFetchErr })
      return { ok: false, message: "Indicação não encontrada." }
    }

    const current = refRow as { id: string; status: string; commercial_profile_id: string | null }
    const oldStatus = current.status
    const nowIso = new Date().toISOString()

    const nextStatus = oldStatus === "pendente" ? "em_atendimento" : oldStatus

    logAdminAssignUpdate("request", {
      referralId,
      commercialProfileId,
      nextStatus,
      oldStatus,
    })

    const {
      data: updated,
      error: updateErr,
    } = await db
      .from("referrals")
      .update({
        commercial_profile_id: commercialProfileId,
        status: nextStatus,
        assigned_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", referralId)
      .select("id, commercial_profile_id, status, assigned_at, updated_at")
      .single()

    const updatedRow = updated as {
      id: string
      commercial_profile_id: string | null
      status: string
      assigned_at: string | null
      updated_at: string
    } | null

    const codeAssign = (updateErr as { code?: string } | null)?.code
    logAdminAssignUpdate("response", {
      updateErr: updateErr?.message ?? null,
      code: codeAssign ?? null,
      updatedRow,
    })

    const assignConfirmed =
      !updateErr &&
      Boolean(updatedRow) &&
      updatedRow!.id === referralId &&
      uuidEqual(updatedRow!.commercial_profile_id, commercialProfileId) &&
      updatedRow!.status === nextStatus &&
      Boolean(updatedRow!.assigned_at) &&
      Boolean(updatedRow!.updated_at)

    const noRowOrRls = !assignConfirmed

    if (noRowOrRls) {
      const code = (updateErr as { code?: string } | null)?.code
      logAdminReferralsAssign("update sem efeito ou divergente", {
        updateErr: updateErr?.message ?? null,
        code: code ?? null,
        updatedRow,
        esperado: { commercial_profile_id: commercialProfileId, status: nextStatus },
      })
      const hint =
        code === "PGRST116" || !updatedRow
          ? " Nenhuma linha foi atualizada (permissão RLS ou política desatualizada no Supabase)."
          : ""
      return {
        ok: false,
        message:
          (updateErr?.message ||
            "O banco não confirmou a atribuição (0 linhas ou valor divergente).") + hint,
      }
    }

    logAdminAssignUpdate("validated", {
      referralId,
      commercialProfileId,
      nextStatus,
      assigned_at: updatedRow!.assigned_at,
    })

    const { error: histErr } = await db.from("referral_history").insert({
      referral_id: referralId,
      actor_profile_id: user.id,
      old_status: oldStatus,
      new_status: nextStatus,
      action_note: "Comercial atribuído pelo admin",
      metadata: {
        action: "admin_assign_commercial",
        selected_commercial_id: commercialProfileId,
      },
    })

    if (histErr) {
      logAdminReferralsAssign("histórico falhou (referral já atualizado)", {
        message: histErr.message,
      })
      return { ok: false, message: histErr.message || "Atribuição salva, mas falhou ao registrar histórico." }
    }

    logAdminReferralsAssign("ok", { referralId, commercialProfileId, nextStatus })

    void createNotificationForProfileFromSupabase({
      profileId: commercialProfileId,
      notificationType: "indicacao",
      title: "Novo lead atribuído",
      message: "Um novo lead foi atribuído para você.",
      data: {
        action: "admin_assign_commercial",
        referral_id: referralId,
      },
      actionUrl: `/comercial/leads/${referralId}`,
    })

    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logAdminReferralsAssign("exceção", { msg })
    return { ok: false, message: "Erro inesperado ao atribuir comercial." }
  }
}

/**
 * Admin altera status do referral. Apenas admin_master | admin_financeiro.
 */
export type ReferralRejectOptions = {
  lostReason?: string
  lostNotes?: string
  note?: string
}

function isMissingColumnReferralError(
  error: { code?: string; message?: string } | null | undefined
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

function buildRejectReferralPatch(opts: {
  lostReason: string
  lostNotes?: string
  note?: string
  nowIso: string
}): Record<string, unknown> {
  const reasonLabel = getLostReasonLabel(opts.lostReason) ?? opts.lostReason
  const lostNotesTrimmed = opts.lostNotes?.trim() ?? ""
  const noteTrimmed = opts.note?.trim() ?? ""
  const patch: Record<string, unknown> = {
    rejected_at: opts.nowIso,
    rejection_reason: reasonLabel,
    lost_reason: opts.lostReason,
    pipeline_stage: "perdido",
    lost_at: opts.nowIso,
  }
  if (lostNotesTrimmed) {
    patch.lost_notes = lostNotesTrimmed
  }
  if (noteTrimmed) {
    patch.notes = noteTrimmed
  } else if (lostNotesTrimmed) {
    patch.notes = lostNotesTrimmed
  }
  return patch
}

export async function updateAdminReferralStatusFromSupabase(
  referralId: string,
  newStatus: IndicacaoStatus,
  options?: ReferralRejectOptions
): Promise<AdminReferralMutationResult> {
  if (isDataProviderMock()) {
    logAdminReferralsStatus("bloqueado — mock")
    return { ok: false, message: "Indisponível no modo mock." }
  }

  if (newStatus === "paga") {
    return { ok: false, message: "Status 'paga' não pode ser definido manualmente aqui." }
  }

  if (!ADMIN_REFERRAL_STATUS_VALUES.has(newStatus)) {
    logAdminReferralsStatus("status inválido", { newStatus })
    return { ok: false, message: "Status inválido." }
  }

  if (newStatus === "recusada" && !options?.lostReason?.trim()) {
    return { ok: false, message: "Selecione o motivo da recusa." }
  }

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
      return { ok: false, message: "Sessão inválida." }
    }

    const { data: actorProfile, error: actorProfileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const actorRole = (actorProfile as { role?: UserRole } | null)?.role ?? null
    if (actorProfileError || !actorRole || !ADMIN_REFERRAL_MUTATION_ROLES.has(actorRole)) {
      logAdminReferralsStatus("sem permissão", { actorRole })
      return { ok: false, message: "Sem permissão para alterar status." }
    }

    const { data: refRow, error: refFetchErr } = await db
      .from("referrals")
      .select("id, status, approved_at, rejected_at")
      .eq("id", referralId)
      .maybeSingle()

    if (refFetchErr || !refRow) {
      logAdminReferralsStatus("referral não encontrado", { referralId })
      return { ok: false, message: "Indicação não encontrada." }
    }

    const row = refRow as {
      id: string
      status: string
      approved_at: string | null
      rejected_at: string | null
    }
    const oldStatus = row.status
    const nowIso = new Date().toISOString()

    const patch: Record<string, unknown> = {
      status: newStatus,
      updated_at: nowIso,
    }

    if (newStatus === "aprovada" && !row.approved_at) {
      patch.approved_at = nowIso
    }
    if (newStatus === "recusada" && options?.lostReason) {
      Object.assign(
        patch,
        buildRejectReferralPatch({
          lostReason: options.lostReason,
          lostNotes: options.lostNotes,
          nowIso,
        })
      )
      logLeadReject("admin", { referralId, lostReason: options.lostReason })
      logLeadLostReason("admin", options.lostReason, options.lostNotes)
    }

    logAdminStatusUpdate("request", { referralId, newStatus, oldStatus, patch })

    const {
      data: updated,
      error: updateErr,
    } = await db
      .from("referrals")
      .update(patch)
      .eq("id", referralId)
      .select("id, status, approved_at, rejected_at, updated_at")
      .single()

    const updatedRow = updated as {
      id: string
      status: string
      approved_at: string | null
      rejected_at: string | null
      updated_at: string
    } | null

    const codeStatus = (updateErr as { code?: string } | null)?.code
    logAdminStatusUpdate("response", {
      updateErr: updateErr?.message ?? null,
      code: codeStatus ?? null,
      updatedRow,
    })

    let statusConfirmed =
      !updateErr &&
      Boolean(updatedRow) &&
      updatedRow!.id === referralId &&
      updatedRow!.status === newStatus &&
      Boolean(updatedRow!.updated_at)

    if (newStatus === "aprovada") {
      statusConfirmed = statusConfirmed && Boolean(updatedRow!.approved_at)
    }
    if (newStatus === "recusada") {
      statusConfirmed = statusConfirmed && Boolean(updatedRow!.rejected_at)
    }

    const noRowOrRls = !statusConfirmed

    if (noRowOrRls) {
      const code = (updateErr as { code?: string } | null)?.code
      logAdminReferralsStatus("update sem efeito ou divergente", {
        updateErr: updateErr?.message ?? null,
        code: code ?? null,
        updatedRow,
        esperadoStatus: newStatus,
      })
      const hint =
        code === "PGRST116" || !updatedRow
          ? " Nenhuma linha foi atualizada (RLS). Verifique referrals_update_policy no Supabase."
          : ""
      return {
        ok: false,
        message:
          (updateErr?.message ||
            "O banco não confirmou a mudança de status (0 linhas ou valor divergente).") + hint,
      }
    }

    logAdminStatusUpdate("validated", {
      referralId,
      newStatus,
      approved_at: updatedRow!.approved_at,
      rejected_at: updatedRow!.rejected_at,
    })

    const rejectLabel =
      newStatus === "recusada" && options?.lostReason
        ? getLostReasonLabel(options.lostReason) ?? options.lostReason
        : null

    const { error: histErr } = await db.from("referral_history").insert({
      referral_id: referralId,
      actor_profile_id: user.id,
      old_status: oldStatus,
      new_status: newStatus,
      action_note:
        newStatus === "recusada" ? "Lead recusado" : "Status alterado pelo admin",
      metadata:
        newStatus === "recusada" && options?.lostReason
          ? {
              action: "referral_rejected",
              lost_reason: options.lostReason,
              lost_reason_label: rejectLabel,
              lost_notes: options.lostNotes?.trim() || null,
              from: oldStatus,
              to: newStatus,
            }
          : {
              action: "admin_status_change",
              from: oldStatus,
              to: newStatus,
            },
    })

    if (histErr) {
      logAdminReferralsStatus("histórico falhou (status já persistido)", {
        message: histErr.message,
      })
    }

    if (newStatus === "aprovada") {
      const ensureReward = await ensureRewardForReferralFromSupabase(referralId, {
        actorProfileId: user.id,
      })
      if (!ensureReward.ok) {
        logAdminReferralsStatus("falha ao garantir recompensa", {
          message: ensureReward.message,
        })
        return { ok: false, message: ensureReward.message }
      }
    }

    if (newStatus === "recusada" && options?.lostReason) {
      const pipelineLabel =
        getLostReasonLabel(options.lostReason) ?? options.lostReason
      const pipe = await moveReferralPipelineStageFromSupabase(
        referralId,
        "perdido",
        undefined,
        pipelineLabel
      )
      if (!pipe.ok && isDev()) {
        logAdminReferralsStatus("pipeline perdido (não bloqueante)", {
          message: pipe.message,
        })
      }
    }

    if (oldStatus !== newStatus && isDev()) {
      console.log("[notification:status-change]", {
        referralId,
        oldStatus,
        newStatus,
        lostReason: options?.lostReason ?? null,
        via: "db_trigger",
        source: "updateAdminReferralStatus",
      })
    }

    logAdminReferralsStatus("ok", { referralId, oldStatus, newStatus })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logAdminReferralsStatus("exceção", { msg })
    return { ok: false, message: "Erro inesperado ao alterar status." }
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
 * Disponibilidade do comercial (`commercial_lead_settings` + fallback legado).
 */
export async function loadComercialAvailabilityStatusFromSupabase(): Promise<ComercialDisponibilidade | null> {
  const { loadComercialLeadSettingsFromSupabase, mapSettingsToDisponibilidade } =
    await import("@/lib/services/commercial-lead.service")
  const settings = await loadComercialLeadSettingsFromSupabase()
  if (settings) {
    return mapSettingsToDisponibilidade(settings.isAvailable, settings.receivingLeads)
  }
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

    const { data: row, error } = await db
      .from("commercial_availability")
      .select("availability_status")
      .eq("commercial_profile_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !row) return "disponivel"
    return (row as { availability_status: ComercialDisponibilidade }).availability_status
  } catch {
    return "disponivel"
  }
}

export async function saveComercialAvailabilityStatusFromSupabase(
  status: ComercialDisponibilidade
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { saveComercialAvailabilityStatusFromSupabase: save } = await import(
    "@/lib/services/commercial-lead.service"
  )
  return save(status)
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
  | { kind: "ok"; indicacao: Indicacao; historico: Historico[] }
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
        lost_reason,
        lost_notes,
        lost_at,
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
    logIndicatorReferralDetail("loaded", {
      id: indicacao.id,
      status: indicacao.status,
      motivoRecusa: indicacao.motivoRecusa ?? null,
    })

    const { data: historyRows, error: historyError } = await db
      .from("referral_history")
      .select(
        "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
      )
      .eq("referral_id", referralId)
      .order("created_at", { ascending: false })

    const historico: Historico[] = []
    if (!historyError && historyRows) {
      const actorIds = [
        ...new Set(
          historyRows
            .map((h: unknown) => (h as ReferralHistoryRow).actor_profile_id)
            .filter((id: string | null): id is string => Boolean(id))
        ),
      ]
      const actorById = new Map<string, { full_name: string; phone: string | null }>()
      if (actorIds.length > 0) {
        const { data: actorRows } = await db
          .from("profiles")
          .select("id, full_name, phone")
          .in("id", actorIds)
        for (const a of actorRows ?? []) {
          const row = a as { id: string; full_name: string; phone: string | null }
          actorById.set(row.id, {
            full_name: row.full_name,
            phone: row.phone,
          })
        }
      }
      historico.push(
        ...mapReferralHistoryRowsToHistorico(referralId, historyRows, actorById)
      )
    }

    devLogIndicacaoDetail("sucesso", { id: indicacao.id, historyCount: historico.length })
    return { kind: "ok", indicacao, historico }
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
  indicadorNomeById: Map<string, string>,
  previousComercialNomeById: Map<string, string> = new Map()
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

  const slaFields = computeReferralSlaFields(row)
  const redistributionFields = mapRedistributionFields(row)
  const previousCommercialNome = row.previous_commercial_profile_id
    ? previousComercialNomeById.get(row.previous_commercial_profile_id)
    : undefined

  return {
    id: row.id,
    indicacaoId: row.id,
    indicacao: {
      ...indicacao,
      ...slaFields,
      ...redistributionFields,
      previousCommercialNome,
    },
    comercialId: row.commercial_profile_id ?? "",
    status: referralStatusToLeadStatus(row.status),
    observacoes: row.notes ? [row.notes] : [],
    assignedAt: row.assigned_at ? new Date(row.assigned_at) : null,
    firstResponseAt: row.first_response_at
      ? new Date(row.first_response_at)
      : null,
    ...slaFields,
    ...redistributionFields,
    previousCommercialNome,
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
 * Leads do comercial logado: referrals atribuídos (profile.id) ou pool (commercial_profile_id nulo).
 * Filtro usa profiles.id — não auth.uid() solto — alinhado a commercial_profile_id no banco.
 */
export async function loadComercialLeadsFromSupabase(): Promise<
  ReferralsLoadResult<Lead>
> {
  let meta = buildReferralsLoadMeta({
    queryLabel: "referrals.comercial.assigned_or_pool",
    filter: null,
  })

  try {
    devLogComercialLeads("início loadComercialLeadsFromSupabase")

    const supabase = getSupabaseClient()
    const db = supabase as unknown as ReferralsDb

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    meta = { ...meta, authUserId: user?.id ?? null }

    devLogComercialLeads("sessão", {
      encontrada: Boolean(user && !userError),
      authUserId: user?.id ?? null,
      authError: userError?.message ?? null,
    })

    if (userError || !user) {
      const error =
        userError?.message ?? "Sem usuário (sessão ausente)"
      console.error("[commercial-leads:error]", { step: "auth", error: userError ?? error })
      return { ok: false, data: [], error, meta }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) {
      const error =
        profileError?.message ?? "Perfil não encontrado para user.id"
      console.error("[commercial-leads:error]", { step: "profile", error: profileError ?? error })
      return {
        ok: false,
        data: [],
        error,
        code: profileError?.code,
        meta,
      }
    }

    const profileRow = profile as { id: string; role: string }
    const profileId = profileRow.id
    const roleStr = profileRow.role
    meta = { ...meta, profileId, role: roleStr }

    if (profileId !== user.id) {
      console.warn("[commercial-leads:session]", {
        authUserId: user.id,
        profileId,
        note: "auth.uid() difere de profiles.id — filtro usa profileId",
      })
    }

    console.log("[commercial-leads:session]", {
      authUserId: user.id,
      profileId,
      role: roleStr,
    })

    const isComercial = roleStr === "comercial"
    const isDevAdminTester = isDev() && ADMIN_ROLES_FOR_DEV_LEADS.has(roleStr)
    const isDevIndicadorPoolTester = isDev() && roleStr === "indicador"

    if (!isComercial && !isDevAdminTester && !isDevIndicadorPoolTester) {
      const error =
        `Role "${roleStr}" não autorizada para /comercial/leads (esperado comercial)`
      console.error("[commercial-leads:error]", { step: "role", error, role: roleStr })
      devWarnComercialLeadsMock(error)
      return { ok: false, data: [], error, meta }
    }

    let filterDesc: string | null = null
    const applyFilter = (qb: ReturnType<ReferralsDb["from"]>) => {
      if (isComercial) {
        filterDesc = `commercial_profile_id.eq.${profileId},commercial_profile_id.is.null`
        devLogComercialLeads("filtro referrals", {
          tipo: "comercial",
          profileId,
          orFilter: filterDesc,
        })
        return qb.or(filterDesc)
      }
      if (isDevAdminTester) {
        filterDesc = "(dev admin — só RLS)"
        devLogComercialLeads("filtro referrals", { tipo: "admin_dev", profileId })
        return qb
      }
      filterDesc = `indicator_profile_id.eq.${profileId},commercial_profile_id.is.null`
      devLogComercialLeads("filtro referrals", {
        tipo: "indicador_dev",
        profileId,
        orFilter: filterDesc,
      })
      return qb.or(filterDesc)
    }

    meta = { ...meta, filter: filterDesc }

    const { rows: referrals, selectUsed, error: refError } =
      await fetchReferralsListRows(db, {
        logTag: "commercial-leads",
        queryLabel: "referrals.comercial.assigned_or_pool",
        applyFilter,
      })

    meta = {
      ...meta,
      selectColumns: selectUsed,
      referralRowCount: referrals.length,
      commercialProfileIdsSample: sampleCommercialProfileIds(referrals),
    }

    if (refError) {
      return {
        ok: false,
        data: [],
        error: formatPostgrestError(refError),
        code: refError.code,
        details: refError.details,
        hint: refError.hint,
        meta,
      }
    }

    const planoById = await loadPlansMapForReferralRows(
      db,
      referrals,
      "commercial-leads"
    )

    const profileIdsForNames = new Set<string>()
    for (const r of referrals) {
      profileIdsForNames.add(r.indicator_profile_id)
      if (r.previous_commercial_profile_id) {
        profileIdsForNames.add(r.previous_commercial_profile_id)
      }
    }
    const indicadorNomeById = new Map<string, string>()
    const previousComercialNomeById = new Map<string, string>()
    if (profileIdsForNames.size > 0) {
      try {
        const { data: indProfiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", [...profileIdsForNames])
          .throwOnError()
        for (const p of indProfiles ?? []) {
          const prof = p as { id: string; full_name: string }
          indicadorNomeById.set(prof.id, prof.full_name)
          previousComercialNomeById.set(prof.id, prof.full_name)
        }
        console.log("[commercial-leads:supabase-query]", {
          query: "profiles.in(indicatorIds)",
          rowsReturned: indProfiles?.length ?? 0,
          error: null,
        })
      } catch (thrown) {
        const error =
          thrown &&
          typeof thrown === "object" &&
          "message" in thrown
            ? thrown
            : {
                message:
                  thrown instanceof Error ? thrown.message : String(thrown),
              }
        console.error("[commercial-leads:error]", { step: "profiles", error })
      }
    }

    const result = referrals.map((r) =>
      buildLeadFromReferralRow(
        r,
        planoById,
        indicadorNomeById,
        previousComercialNomeById
      )
    )

    console.log("[commercial-leads:result]", {
      authUserId: meta.authUserId,
      profileId: meta.profileId,
      role: meta.role,
      filter: meta.filter,
      referralRowCount: meta.referralRowCount,
      mappedCount: result.length,
      commercialProfileIdsSample: meta.commercialProfileIdsSample,
    })

    devLogComercialLeads("sucesso", { total: result.length, roleUsada: roleStr })
    return { ok: true, data: result, meta }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error("[commercial-leads:error]", e)
    devWarnComercialLeadsMock(`exceção: ${error}`)
    return { ok: false, data: [], error, meta }
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

const REFERRAL_DETAIL_SELECT_CORE = `
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

const REFERRAL_DETAIL_SELECT_EXTENDED = `
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
        assigned_at,
        first_response_at,
        lost_reason,
        lost_notes,
        lost_at,
        redistribution_count,
        previous_commercial_profile_id,
        sla_redistributed,
        last_redistributed_at,
        created_at,
        updated_at
      `

const COMERCIAL_LEAD_DETAIL_READ_ROLES = new Set([
  "comercial",
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
])

type IndicatorPublicProfileRpc = {
  ok?: boolean
  id?: string
  name?: string
  email?: string | null
  phone?: string | null
  message?: string
}

export type ResolvedIndicatorProfile = {
  id: string
  nome: string
  email: string
  telefone: string
  found: boolean
  source: "rpc" | "profiles" | "fallback"
}

async function resolveIndicatorProfileForCommercialLead(
  supabase: ReturnType<typeof getSupabaseClient>,
  db: ReferralsDb,
  referralId: string,
  indicatorProfileId: string
): Promise<ResolvedIndicatorProfile> {
  const fallback: ResolvedIndicatorProfile = {
    id: indicatorProfileId,
    nome: "Indicador não identificado",
    email: "",
    telefone: "",
    found: false,
    source: "fallback",
  }

  try {
    const dbRpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: { p_referral_id: string }
      ) => Promise<{ data: IndicatorPublicProfileRpc | null; error: { message: string } | null }>
    }
    const { data: rpcData, error: rpcError } = await dbRpc.rpc(
      "get_referral_indicator_public_profile",
      { p_referral_id: referralId }
    )

    if (!rpcError && rpcData?.ok && rpcData.id) {
      const resolved: ResolvedIndicatorProfile = {
        id: rpcData.id,
        nome: (rpcData.name ?? "").trim() || "Indicador não identificado",
        email: rpcData.email?.trim() ?? "",
        telefone: rpcData.phone?.trim() ?? "",
        found: Boolean((rpcData.name ?? "").trim()),
        source: "rpc",
      }
      console.log("[commercial-lead-detail:indicator]", {
        referralId,
        indicator_profile_id: indicatorProfileId,
        indicatorProfileFound: true,
        indicatorName: resolved.nome,
        indicatorEmail: resolved.email || null,
        source: resolved.source,
        rpcMessage: rpcData.message ?? null,
      })
      return resolved
    }

    if (rpcError) {
      console.error("[commercial-lead-detail:error]", {
        step: "indicator-rpc",
        error: rpcError,
      })
    } else if (rpcData && !rpcData.ok) {
      console.warn("[commercial-lead-detail:indicator]", {
        referralId,
        indicator_profile_id: indicatorProfileId,
        rpcOk: false,
        rpcMessage: rpcData.message ?? null,
      })
    }
  } catch (thrown) {
    console.error("[commercial-lead-detail:error]", {
      step: "indicator-rpc-exception",
      thrown,
    })
  }

  const { data: indicatorProfileRow, error: indicatorProfError } = await db
    .from("profiles")
    .select("id, full_name, phone, email")
    .eq("id", indicatorProfileId)
    .maybeSingle()

  const prof = indicatorProfileRow as {
    id: string
    full_name: string | null
    phone: string | null
    email: string | null
  } | null

  const nome =
    prof?.full_name?.trim() ||
    prof?.email?.trim() ||
    "Indicador não identificado"

  const resolved: ResolvedIndicatorProfile = {
    id: indicatorProfileId,
    nome,
    email: prof?.email?.trim() ?? "",
    telefone: prof?.phone?.trim() ?? "",
    found: Boolean(prof && (prof.full_name?.trim() || prof.email?.trim())),
    source: prof ? "profiles" : "fallback",
  }

  console.log("[commercial-lead-detail:indicator]", {
    referralId,
    indicator_profile_id: indicatorProfileId,
    indicatorProfileFound: resolved.found,
    indicatorName: resolved.nome,
    indicatorEmail: resolved.email || null,
    source: resolved.source,
    profilesError: indicatorProfError?.message ?? null,
    profilesCode: indicatorProfError?.code ?? null,
  })

  if (indicatorProfError) {
    console.error("[commercial-lead-detail:error]", {
      step: "indicator-profiles",
      error: indicatorProfError,
    })
  }

  return resolved
}

async function fetchReferralRowForComercialDetail(
  db: ReferralsDb,
  referralId: string
): Promise<{
  row: ReferralRow | null
  selectVariant: "extended" | "core"
  error: { message?: string; code?: string } | null
}> {
  const selects: Array<{ variant: "extended" | "core"; sql: string }> = [
    { variant: "extended", sql: REFERRAL_DETAIL_SELECT_EXTENDED },
    { variant: "core", sql: REFERRAL_DETAIL_SELECT_CORE },
  ]
  let lastError: { message?: string; code?: string } | null = null

  for (let i = 0; i < selects.length; i++) {
    const { variant, sql } = selects[i]!
    const { data, error } = await db
      .from("referrals")
      .select(sql)
      .eq("id", referralId)
      .maybeSingle()

    console.log("[commercial-lead-detail:query]", {
      referralId,
      selectVariant: variant,
      hasRow: Boolean(data),
      error: error ?? null,
    })

    if (!error && data) {
      return { row: data as ReferralRow, selectVariant: variant, error: null }
    }

    if (!error && !data) {
      return { row: null, selectVariant: variant, error: null }
    }

    lastError = error
    console.error("[commercial-lead-detail:error]", {
      step: "referrals.select",
      selectVariant: variant,
      error,
    })

    if (isMissingColumnReferralError(error) && i < selects.length - 1) {
      console.warn("[commercial-lead-detail:retry-core]", {
        reason: error?.message,
        referralId,
      })
      continue
    }

    return { row: null, selectVariant: variant, error }
  }

  return {
    row: null,
    selectVariant: "core",
    error: lastError,
  }
}

export type ComercialLeadDetailsResult =
  | { kind: "ok"; lead: Lead; historico: Historico[] }
  | { kind: "not-found"; message?: string }
  | {
      kind: "unauthorized"
      message: string
    }
  | { kind: "error"; message: string; code?: string }

export async function loadComercialLeadDetailsFromSupabase(
  referralId: string
): Promise<ComercialLeadDetailsResult> {
  try {
    devLogComercialLeadDetail("início", { referralId })

    const supabase = getSupabaseClient()
    const db = supabase as unknown as ReferralsDb

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      const message = authError?.message ?? "Sessão inválida."
      console.error("[commercial-lead-detail:error]", { step: "auth", message })
      return { kind: "error", message }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle()

    const profileRow = profile as { id: string; role: string } | null
    const profileId = profileRow?.id ?? user.id
    const role = profileRow?.role ?? null

    console.log("[commercial-lead-detail:session]", {
      authUserId: user.id,
      profileId,
      role,
      referralId,
      profileError: profileError?.message ?? null,
    })

    if (profileError || !profileRow || !role) {
      const message =
        profileError?.message ?? "Perfil não encontrado para o usuário logado."
      console.error("[commercial-lead-detail:error]", { step: "profile", message })
      return { kind: "error", message, code: profileError?.code }
    }

    if (!COMERCIAL_LEAD_DETAIL_READ_ROLES.has(role)) {
      const message = `Perfil "${role}" não pode abrir detalhe de lead comercial.`
      console.error("[commercial-lead-detail:error]", { step: "role", message })
      return { kind: "error", message }
    }

    const { row: refRow, selectVariant, error: refError } =
      await fetchReferralRowForComercialDetail(db, referralId)

    if (refError) {
      const message =
        refError.message ??
        "Erro ao carregar o lead. Verifique se os patches SQL (lost_reason/lost_notes) foram aplicados."
      return { kind: "error", message, code: refError.code }
    }

    if (!refRow) {
      console.log("[commercial-lead-detail:result]", {
        kind: "not-found",
        referralId,
        profileId,
        selectVariant,
      })
      return {
        kind: "not-found",
        message: "Lead não encontrado ou sem permissão de leitura (RLS).",
      }
    }

    const referral = refRow
    const isAdminReader =
      role === "admin_master" ||
      role === "admin_financeiro" ||
      role === "admin_consulta"

    if (
      role === "comercial" &&
      referral.commercial_profile_id &&
      !uuidEqual(referral.commercial_profile_id, profileId)
    ) {
      console.log("[commercial-lead-detail:result]", {
        kind: "unauthorized",
        referralId,
        profileId,
        commercial_profile_id: referral.commercial_profile_id,
        status: referral.status,
      })
      return {
        kind: "unauthorized",
        message: "Lead não autorizado para este comercial.",
      }
    }

    if (role === "comercial" && !referral.commercial_profile_id) {
      console.log("[commercial-lead-detail:result]", {
        kind: "unauthorized",
        referralId,
        profileId,
        note: "lead sem commercial_profile_id (pool)",
      })
      return {
        kind: "unauthorized",
        message:
          "Este lead ainda não está atribuído a você. Assuma o lead na lista antes de abrir o detalhe.",
      }
    }

    const planoById = new Map<string, Plano>()
    const { data: planRow, error: planError } = await db
      .from("plans")
      .select(
        "id, name, speed_label, price, description, reward_amount, is_active, sort_order"
      )
      .eq("id", referral.plan_id)
      .maybeSingle()

    if (planError) {
      console.error("[commercial-lead-detail:error]", {
        step: "plans",
        error: planError,
      })
    } else if (planRow) {
      planoById.set(referral.plan_id, mapPlanRowToPlano(planRow as PlanCatalogRow))
    }

    const indicatorResolved = await resolveIndicatorProfileForCommercialLead(
      supabase,
      db,
      referralId,
      referral.indicator_profile_id
    )

    const lead = buildLeadFromReferralRow(
      referral,
      planoById,
      new Map([[referral.indicator_profile_id, indicatorResolved.nome]])
    )

    if (lead.indicacao) {
      lead.indicacao.indicador = stubIndicadorProfile(
        indicatorResolved.id,
        indicatorResolved.nome
      )
      if (indicatorResolved.telefone) {
        lead.indicacao.indicador.telefone = indicatorResolved.telefone
      }
      if (indicatorResolved.email) {
        lead.indicacao.indicador.email = indicatorResolved.email
      }
      const lost = mapReferralLostFields(referral)
      lead.indicacao.motivoRecusa = lost.motivoRecusa
      lead.indicacao.observacoesRecusa = lost.observacoesRecusa
      lead.indicacao.dataRecusa = lost.dataRecusa
    }

    let historico: Historico[] = []
    const { data: historyRows, error: historyError } = await db
      .from("referral_history")
      .select(
        "id, referral_id, actor_profile_id, old_status, new_status, action_note, metadata, created_at"
      )
      .eq("referral_id", referralId)
      .order("created_at", { ascending: false })

    if (historyError) {
      console.error("[commercial-lead-detail:error]", {
        step: "referral_history",
        error: historyError,
      })
    } else {
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
          console.error("[commercial-lead-detail:error]", {
            step: "history-actors",
            error: actorError,
          })
        } else {
          for (const row of actorRows ?? []) {
            const actor = row as {
              id: string
              full_name: string
              phone: string | null
            }
            actorById.set(actor.id, {
              full_name: actor.full_name,
              phone: actor.phone,
            })
          }
        }
      }

      historico = mapReferralHistoryRowsToHistorico(
        referralId,
        historyRows ?? [],
        actorById
      )
    }

    console.log("[commercial-lead-detail:result]", {
      kind: "ok",
      leadId: lead.id,
      status: referral.status,
      commercial_profile_id: referral.commercial_profile_id,
      profileId,
      isAdminReader,
      selectVariant,
      historyCount: historico.length,
      indicator_profile_id: referral.indicator_profile_id,
    })

    return { kind: "ok", lead, historico }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[commercial-lead-detail:error]", { step: "exception", message })
    devWarnComercialLeadDetailMock(`exceção: ${message}`)
    return { kind: "error", message }
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

export type EnsureRewardForReferralResult =
  | { ok: true; rewardId: string; created: boolean }
  | { ok: false; message: string }

const ENSURE_REWARD_LOG_PREFIX = "[ensure-reward:supabase]"

function devLogEnsureReward(...args: unknown[]): void {
  if (!isDev()) return
  console.log(ENSURE_REWARD_LOG_PREFIX, ...args)
}

/**
 * Garante uma recompensa pendente vinculada ao referral (idempotente por referral_id).
 */
export async function ensureRewardForReferralFromSupabase(
  referralId: string,
  options?: {
    actorProfileId?: string | null
    skipNotification?: boolean
  }
): Promise<EnsureRewardForReferralResult> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const { data: refRow, error: refError } = await db
      .from("referrals")
      .select("id, indicator_profile_id, reward_amount, reward_type, status")
      .eq("id", referralId)
      .maybeSingle()

    if (refError || !refRow) {
      devLogEnsureReward("referral não encontrada", { referralId, refError })
      return { ok: false, message: "Indicação não encontrada." }
    }

    const ref = refRow as {
      id: string
      indicator_profile_id: string | null
      reward_amount: number | string | null
      reward_type: string | null
      status: string
    }

    if (!ref.indicator_profile_id) {
      return { ok: false, message: "Indicação sem indicador vinculado." }
    }

    const amount = Number(ref.reward_amount)
    if (!Number.isFinite(amount) || amount < 0) {
      return {
        ok: false,
        message: "Valor de recompensa inválido ou ausente na indicação.",
      }
    }

    const { data: existingRows, error: existingError } = await db
      .from("rewards")
      .select("id, referral_id, status, amount, created_at")
      .eq("referral_id", referralId)
      .order("created_at", { ascending: true })

    if (existingError) {
      return {
        ok: false,
        message: `Falha ao verificar recompensa: ${existingError.message}`,
      }
    }

    const existingList = (existingRows ?? []) as {
      id: string
      referral_id: string
      status: string
      amount: number | string
    }[]

    if (existingList.length > 1) {
      devLogEnsureReward("DUPLICATA: mais de uma reward para o mesmo referral_id", {
        referralId,
        rewardIds: existingList.map((r) => r.id),
        count: existingList.length,
      })
    }

    if (existingList.length > 0) {
      const primary = existingList[0]
      devLogEnsureReward("reward já existe", {
        referralId,
        rewardId: primary.id,
        status: primary.status,
        amount: Number(primary.amount),
      })
      return {
        ok: true,
        rewardId: primary.id,
        created: false,
      }
    }

    const rewardType =
      ref.reward_type === "desconto_fatura" ? "desconto_fatura" : "pix"

    const rewardPayload = {
      referral_id: referralId,
      indicator_profile_id: ref.indicator_profile_id,
      amount,
      reward_type: rewardType,
      status: "pendente" as const,
      available_at: null,
      paid_at: null,
    }

    const { data: insertedRows, error: insertError } = await db
      .from("rewards")
      .insert(rewardPayload)
      .select("id")

    if (insertError) {
      const code = (insertError as { code?: string }).code
      if (code === "23505") {
        const { data: raced, error: racedError } = await db
          .from("rewards")
          .select("id")
          .eq("referral_id", referralId)
          .maybeSingle()
        if (!racedError && raced) {
          return {
            ok: true,
            rewardId: (raced as { id: string }).id,
            created: false,
          }
        }
      }
      devLogEnsureReward("falha insert reward", { referralId, insertError })
      return {
        ok: false,
        message: `Falha ao criar recompensa: ${insertError.message}`,
      }
    }

    const rewardId = (insertedRows as { id?: string }[] | null)?.[0]?.id
    if (!rewardId) {
      return { ok: false, message: "Recompensa criada sem identificador retornado." }
    }

    devLogEnsureReward("reward criada", { referralId, rewardId })

    const actorProfileId = options?.actorProfileId ?? null
    if (actorProfileId) {
      const { error: histError } = await db.from("referral_history").insert({
        referral_id: referralId,
        actor_profile_id: actorProfileId,
        old_status: ref.status,
        new_status: ref.status,
        action_note: "Recompensa gerada automaticamente",
        metadata: { action: "reward_created" },
      })
      if (histError) {
        devLogEnsureReward("histórico reward_created falhou", histError.message)
      }
    }

    if (!options?.skipNotification) {
      void insertNotification({
        profile_id: ref.indicator_profile_id,
        notification_type: "recompensa",
        title: "Recompensa gerada",
        message:
          "Sua indicação foi aprovada e uma recompensa foi gerada. Ela será liberada após confirmação da primeira mensalidade.",
        data: {
          action: "reward_created",
          referral_id: referralId,
          reward_id: rewardId,
        },
      })
    }

    return { ok: true, rewardId, created: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devLogEnsureReward("exceção", msg)
    return { ok: false, message: msg || "Erro ao garantir recompensa." }
  }
}

/** UI e gate client: admin financeiro/master ou comercial atribuído ao lead. */
export function canConfirmFirstInvoice(params: {
  role: UserRole | null | undefined
  authUserId: string | null | undefined
  commercialProfileId: string | null | undefined
}): boolean {
  const { role, authUserId, commercialProfileId } = params
  if (!role) return false
  if (role === "admin_master" || role === "admin_financeiro") return true
  if (role === "comercial") {
    return Boolean(
      authUserId &&
        commercialProfileId &&
        commercialProfileId === authUserId
    )
  }
  return false
}

async function assertCanMarkFirstInvoicePaid(
  referralId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = getSupabaseClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, message: "Sessão não encontrada. Faça login novamente." }
  }

  const role = await getAuthProfileRoleFromSupabase()
  const { data: row, error } = await (
    supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
  )
    .from("referrals")
    .select("commercial_profile_id")
    .eq("id", referralId)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, message: "Indicação não encontrada." }
  }

  const commercialProfileId =
    (row as { commercial_profile_id?: string | null }).commercial_profile_id ??
    null

  if (
    !canConfirmFirstInvoice({
      role,
      authUserId: user.id,
      commercialProfileId,
    })
  ) {
    if (role === "comercial") {
      return {
        ok: false,
        message:
          "Apenas o comercial atribuído pode confirmar a primeira mensalidade.",
      }
    }
    return { ok: false, message: "Sem permissão para esta ação financeira." }
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

async function resolveIdempotentFirstInvoiceCredit(
  referralId: string
): Promise<Extract<MarkFirstInvoicePaidResult, { ok: true }> | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const { data: rewardRow, error: rewardError } = await db
      .from("rewards")
      .select("id")
      .eq("referral_id", referralId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (rewardError || !rewardRow) return null

    const rewardId = (rewardRow as { id: string }).id

    const { data: txRow, error: txError } = await db
      .from("wallet_transactions")
      .select("id, balance_after")
      .eq("reward_id", rewardId)
      .eq("transaction_type", "credito")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (txError || !txRow) return null

    const tx = txRow as { id: string; balance_after: number | string }
    return {
      ok: true,
      rewardId,
      transactionId: tx.id,
      balanceAfter: Math.max(0, Number(tx.balance_after)),
    }
  } catch {
    return null
  }
}

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
    const gate = await assertCanMarkFirstInvoicePaid(referralId)
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

    let result = parseMarkFirstInvoiceRpcPayload(data)

    if (
      !result.ok &&
      (result.code === "already_paid" || result.code === "already_released")
    ) {
      const idempotent = await resolveIdempotentFirstInvoiceCredit(referralId)
      if (idempotent) {
        devLogFirstInvoicePaid("resolvido como idempotente (crédito existente)", {
          referralId,
          idempotent,
        })
        result = idempotent
      }
    }

    const isIdempotentSuccess =
      result.ok &&
      Boolean(
        data &&
          typeof data === "object" &&
          (data as Record<string, unknown>).idempotent === true
      )

    if (result.ok && !isIdempotentSuccess) {
      if (isDev()) {
        console.log("[indicador:reward-release]", {
          referralId,
          rewardId: result.rewardId,
          transactionId: result.transactionId,
          balanceAfter: result.balanceAfter,
        })
      }
      void notifyIndicatorRewardReleasedFromSupabase(referralId)
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
  options?: ReferralRejectOptions
): Promise<UpdateComercialLeadStatusResult> {
  const note = options?.note
  try {
    devLogComercialLeadUpdate("início", {
      referralId,
      newStatus,
      hasNote: Boolean(note?.trim()),
      hasLostReason: Boolean(options?.lostReason),
    })

    if (isComercialLeadRejectStatus(newStatus) && !options?.lostReason?.trim()) {
      logLeadReject("comercial-validation", { referralId, newStatus })
      return { ok: false, message: "Selecione o motivo da recusa ou perda." }
    }

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

    const profileRow = profile as { id: string; role: string } | null
    const profileId = profileRow?.id ?? user.id
    const role = profileRow?.role ?? null
    devLogComercialLeadUpdate("profile", {
      hasProfile: Boolean(profile && !profileError),
      profileId,
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
    const updatePayload: Record<string, unknown> = {
      status: nextReferralStatus,
      last_interaction_at: nowIso,
      first_response_at: before.first_response_at ?? nowIso,
    }
    if (noteTrimmed && !isComercialLeadRejectStatus(newStatus)) {
      updatePayload.notes = noteTrimmed
    }
    if (finalStatus === "aprovada" && oldStatus !== "aprovada") {
      updatePayload.approved_at = nowIso
    }
    if (finalStatus === "recusada" && options?.lostReason) {
      Object.assign(
        updatePayload,
        buildRejectReferralPatch({
          lostReason: options.lostReason,
          lostNotes: options.lostNotes,
          note: noteTrimmed || undefined,
          nowIso,
        })
      )
      logLeadReject("comercial", { referralId, lostReason: options.lostReason })
      logLeadLostReason("comercial", options.lostReason, options.lostNotes)
    }

    let updateRows: unknown[] | null = null
    let updateError: { message: string; code?: string } | null = null

    const runUpdate = async (payload: Record<string, unknown>) =>
      db
        .from("referrals")
        .update(payload)
        .eq("id", referralId)
        .eq("commercial_profile_id", profileId)
        .select(
          "id, status, notes, updated_at, first_response_at, last_interaction_at, assigned_at"
        )

    const first = await runUpdate(updatePayload)
    updateRows = first.data
    updateError = first.error

    if (
      updateError &&
      isMissingColumnReferralError(updateError) &&
      finalStatus === "recusada" &&
      options?.lostReason
    ) {
      const minimal: Record<string, unknown> = {
        status: nextReferralStatus,
        last_interaction_at: nowIso,
        first_response_at: before.first_response_at ?? nowIso,
        rejected_at: nowIso,
        rejection_reason:
          getLostReasonLabel(options.lostReason) ?? options.lostReason,
      }
      const noteVal = options.lostNotes?.trim() || noteTrimmed
      if (noteVal) minimal.notes = noteVal
      logLeadReject("comercial-retry-minimal", { referralId })
      const second = await runUpdate(minimal)
      updateRows = second.data
      updateError = second.error
    }

    const updateRowsData = updateRows
    const updateErrorFinal = updateError

    devLogComercialLeadUpdate("resultado update referrals", {
      error: updateErrorFinal?.message ?? null,
      code: updateErrorFinal?.code ?? null,
      payload: updatePayload,
      rowCount: updateRowsData?.length ?? 0,
      rows: updateRowsData ?? [],
    })
    devLogComercialLeadUpdate("resultado update referrals (campos SLA)", {
      sla: (updateRowsData ?? []).map((row: unknown) => {
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

    if (updateErrorFinal) {
      if (isDev()) {
        console.warn(COMERCIAL_LEAD_UPDATE_LOG_PREFIX, "falha update referrals", {
          message: updateErrorFinal.message,
          code: updateErrorFinal.code ?? null,
          details: (updateErrorFinal as { details?: string }).details ?? null,
          hint: (updateErrorFinal as { hint?: string }).hint ?? null,
        })
      }
      return {
        ok: false,
        message: "Não foi possível atualizar o status do lead.",
      }
    }

    const updatedRow = (updateRowsData?.[0] ?? null) as {
      id?: string
      status?: string
    } | null
    const updateConfirmed =
      Boolean(updatedRow) &&
      updatedRow!.id === referralId &&
      updatedRow!.status === nextReferralStatus

    if (!updateConfirmed) {
      devLogComercialLeadUpdate("update sem efeito (RLS ou lead não atribuído ao comercial)", {
        referralId,
        commercialProfileId: profileId,
        rowCount: updateRowsData?.length ?? 0,
        updatedRow,
        esperadoStatus: nextReferralStatus,
      })
      return {
        ok: false,
        message:
          "Não foi possível atualizar o lead. Verifique se o lead está atribuído a você ou assuma o lead antes.",
      }
    }

    if (oldStatus !== nextReferralStatus) {
      if (isDev()) {
        console.log("[notification:status-change]", {
          source: "updateComercialLeadStatus",
          referralId,
          oldStatus,
          newStatus: nextReferralStatus,
          requestedStatus: newStatus,
          lostReason: options?.lostReason ?? null,
          via: "db_trigger",
        })
        console.log("[indicator:trigger]", {
          source: "updateComercialLeadStatus",
          referralId,
          oldStatus,
          nextReferralStatus,
        })
      }
    }

    const rejectLabel =
      finalStatus === "recusada" && options?.lostReason
        ? getLostReasonLabel(options.lostReason) ?? options.lostReason
        : null
    const historyNote =
      finalStatus === "recusada"
        ? "Lead recusado"
        : noteTrimmed || `Status alterado para ${newStatus}`
    const { data: historyRows, error: historyError } = await db
      .from("referral_history")
      .insert({
        referral_id: referralId,
        actor_profile_id: user.id,
        old_status: oldStatus,
        new_status: nextReferralStatus,
        action_note: historyNote,
        metadata:
          finalStatus === "recusada" && options?.lostReason
            ? {
                action: "lead_lost",
                lost_reason: options.lostReason,
                lost_reason_label: rejectLabel,
                lost_notes: options.lostNotes?.trim() || null,
                requested_status: newStatus,
              }
            : {
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

    if (historyError && isDev()) {
      console.warn(COMERCIAL_LEAD_UPDATE_LOG_PREFIX, "falha insert referral_history", {
        message: historyError.message,
        code: historyError.code ?? null,
      })
    }

    if (
      finalStatus === "aprovada" &&
      (referralBefore as { status?: string } | null)?.status !== "aprovada"
    ) {
      const ensureReward = await ensureRewardForReferralFromSupabase(referralId, {
        actorProfileId: user.id,
      })
      devLogComercialLeadUpdate("ensureRewardForReferral (venda → aprovada)", {
        referralId,
        ensureReward,
      })
      if (!ensureReward.ok) {
        return {
          ok: false,
          message: ensureReward.message,
        }
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

    if (finalStatus === "recusada" && options?.lostReason) {
      const pipelineLabel =
        getLostReasonLabel(options.lostReason) ?? options.lostReason
      const pipe = await moveReferralPipelineStageFromSupabase(
        referralId,
        "perdido",
        undefined,
        pipelineLabel
      )
      if (!pipe.ok && isDev()) {
        console.warn(COMERCIAL_LEAD_UPDATE_LOG_PREFIX, "pipeline perdido", pipe.message)
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

function devLogPixApprove(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[pix-approve]", ...args)
}

function devLogPixReject(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[pix-reject]", ...args)
}

function devLogWalletLedger(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[wallet-ledger]", ...args)
}

function devWarnPixWithdrawal(reason: string): void {
  if (!isDev()) return
  console.warn(PIX_WITHDRAWAL_LOG_PREFIX, "fallback / aviso →", reason)
}

const PIX_KEY_TYPES_ALLOWED: TipoChavePix[] = [
  "cpf",
  "cnpj",
  "email",
  "telefone",
  "aleatoria",
]

function devLogPixKey(tag: string, payload?: unknown): void {
  if (!isDev()) return
  const label = `[pix-key:${tag}]`
  if (payload !== undefined) {
    console.log(label, payload)
  } else {
    console.log(label)
  }
}

function normalizePixKeyType(keyType: string): TipoChavePix {
  return PIX_KEY_TYPES_ALLOWED.includes(keyType as TipoChavePix)
    ? (keyType as TipoChavePix)
    : "cpf"
}

function isPixWithdrawalRpcIdempotent(raw: unknown): boolean {
  return (
    Boolean(raw) &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>).idempotent === true
  )
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
    const code = String(o.code ?? "error")
    if (code === "already_completed" || code === "open_withdrawal_exists") {
      devLogPixWithdrawal("rpc erro de negócio", { code, message: o.message })
    }
    return {
      ok: false,
      code,
      message: String(o.message ?? "Operação não concluída."),
    }
  }
  if (o.ok === true) {
    const idempotent = isPixWithdrawalRpcIdempotent(o)
    const result = {
      ok: true as const,
      idempotent,
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
    if (idempotent) {
      devLogWalletLedger("operação idempotente (sem efeito duplicado)", result)
    }
    return result
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
  action_url?: string | null
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
    const row = buildNotificationInsertRow({
      profile_id: payload.profile_id,
      title: payload.title,
      message: payload.message,
      notificationType: payload.notification_type,
      metadata: payload.data ?? {},
      actionUrl: payload.action_url ?? null,
    })
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
    const { data: profileRow } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    const userRole = (profileRow as { role?: import("@/types/user").UserRole } | null)
      ?.role ?? null

    const { data: rows, error } = await db
      .from("notifications")
      .select(NOTIFICATIONS_SELECT)
      .eq(NOTIFICATIONS_DB.profileId, user.id)
      .order(NOTIFICATIONS_DB.createdAt, { ascending: false })
      .limit(200)

    if (error) {
      devWarnUserNotifications(`query falhou: ${error.message} (${error.code ?? "sem código"})`)
      return null
    }

    const list: NotificationItem[] = (rows ?? [])
      .map((raw: unknown) =>
        mapNotificationRowFromDb(raw as Record<string, unknown>, userRole)
      )
      .filter((item: NotificationItem | null): item is NotificationItem => item != null)

    const unreadCount = list.filter((n) => !n.read).length
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
      .eq(NOTIFICATIONS_DB.profileId, user.id)
      .eq(NOTIFICATIONS_DB.isRead, false)

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
    const { data: updated, error } = await db
      .from("notifications")
      .update(buildNotificationMarkReadUpdate())
      .eq("id", notificationId)
      .eq(NOTIFICATIONS_DB.profileId, user.id)
      .select(`id, ${NOTIFICATIONS_DB.isRead}, ${NOTIFICATIONS_DB.readAt}`)

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
    const { data: updatedRows, error } = await db
      .from("notifications")
      .update(buildNotificationMarkReadUpdate())
      .eq(NOTIFICATIONS_DB.profileId, user.id)
      .eq(NOTIFICATIONS_DB.isRead, false)
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
    if (
      fn === "request_pix_withdrawal" &&
      isDev() &&
      data &&
      typeof data === "object"
    ) {
      const o = data as Record<string, unknown>
      console.log("[pix-withdrawal:notification]", {
        admin_notifications_created: o.admin_notifications_created ?? null,
        payment_id: o.payment_id ?? null,
      })
    }
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
  devLogPixWithdrawal("solicitação", { amount })
  const result = await rpcPixWithdrawal("request_pix_withdrawal", { p_amount: amount })

  if (result.ok) {
    devLogWalletLedger("reserva criada", {
      paymentId: result.paymentId,
      balanceAfter: result.balanceAfter,
      walletTransactionId: result.walletTransactionId,
    })
    const supabase = getSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      void insertNotification({
        profile_id: user.id,
        notification_type: "carteira",
        title: "Saque Pix solicitado",
        message: "Sua solicitação foi registrada e o valor foi reservado na carteira.",
        data: {
          action: "pix_withdrawal_requested",
          payment_id: result.paymentId ?? null,
          amount,
        },
        action_url: "/indicador/pagamentos",
      })
    }
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
  devLogPixApprove("início", { paymentId })
  const result = await rpcPixWithdrawal("approve_pix_withdrawal", { p_payment_id: paymentId })
  devLogPixApprove("resultado", result)

  if (result.ok && !result.idempotent) {
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
  devLogPixReject("início", { paymentId, reason: reason.trim() })
  const result = await rpcPixWithdrawal("reject_pix_withdrawal", {
    p_payment_id: paymentId,
    p_reason: reason,
  })
  devLogPixReject("resultado", result)

  if (result.ok) {
    if (result.balanceAfter != null) {
      devLogWalletLedger("reversão de reserva", {
        paymentId,
        balanceAfter: result.balanceAfter,
        walletTransactionId: result.walletTransactionId,
      })
    }
    if (result.idempotent) return result
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
  devLogPixApprove("complete início", { paymentId, receiptUrl: receiptUrl.slice(0, 80) })
  const result = await rpcPixWithdrawal("complete_pix_withdrawal", {
    p_payment_id: paymentId,
    p_receipt_url: receiptUrl,
  })
  devLogPixApprove("complete resultado", result)

  if (result.ok) {
    devLogWalletLedger("débito definitivo / conclusão", {
      paymentId,
      balanceAfter: result.balanceAfter,
      walletTransactionId: result.walletTransactionId,
    })
    if (result.idempotent) return result
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
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      devWarnPixWithdrawal(`wallet_transactions: ${error.message}`)
      return null
    }
    if (!data) return 0
    const balance = Math.max(
      0,
      Number((data as { balance_after: number | string }).balance_after)
    )
    devLogWalletLedger("saldo ledger", { userId: user.id, balance })
    return balance
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
        .order("id", { ascending: false })
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

    const availableBalance = Math.max(
      0,
      !wtLatestRes.error && wtLatestRes.data
        ? Number((wtLatestRes.data as { balance_after: number | string }).balance_after)
        : 0
    )

    let creditTotal = 0
    if (!wtCreditsRes.error && wtCreditsRes.data) {
      for (const row of wtCreditsRes.data as { amount: number | string }[]) {
        creditTotal += Math.max(0, Number(row.amount))
      }
    }

    const rewards = !rewardsRes.error && rewardsRes.data
      ? (rewardsRes.data as RewardRow[])
      : []

    let pendingRewardsTotal = 0
    let discountBalance = 0
    for (const rw of rewards) {
      const amt = Math.max(0, Number(rw.amount))
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
              valor: Math.max(0, Number(row.amount)),
              descricao: row.description,
              saldoApos: Math.max(0, Number(row.balance_after)),
              createdAt: new Date(row.created_at),
            }
          })
        : []

    const chavePix =
      !pixRes.error && pixRes.data
        ? String((pixRes.data as { key_value: string }).key_value)
        : null

    devLogPixKey("wallet-load", {
      profileId: uid,
      error: pixRes.error?.message ?? null,
      hasPrimaryKey: Boolean(chavePix),
      keyPreview: chavePix ? `${chavePix.slice(0, 4)}…` : null,
    })

    const rewardsCount = rewards.length

    if (isDev()) {
      devLogWalletLedger("carteira carregada", {
        userId: uid,
        availableBalance,
        pendingRewardsTotal,
        creditTotal,
        discountBalance,
        transactionsCount: movimentacoes.length,
        rewardsCount,
        fonteSaldo: "ultimo balance_after do ledger",
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

export type FinancialIntegrityReport = {
  duplicateRewardsByReferral: Array<{
    referral_id: string
    count: number
    reward_ids: string[]
  }>
  duplicateWalletCreditsByReward: Array<{
    reward_id: string
    count: number
    transaction_ids: string[]
  }>
  rewardsWithoutReferral: string[]
  rewardsWithoutIndicator: string[]
  approvedReferralsWithoutReward: Array<{ referral_id: string; status: string }>
  availableRewardsWithoutWalletTx: Array<{
    reward_id: string
    referral_id: string
    reward_type: string
  }>
  creditWalletTxWithoutReward: string[]
  pendingPixWithdrawalsWithoutReserve: Array<{ payment_id: string; indicator_profile_id: string }>
  reservesWithoutPayment: string[]
  approvedPixWithoutDefinitiveDebit: Array<{ payment_id: string; status: string }>
  rejectedPixWithoutReversal: Array<{ payment_id: string }>
  ledgerBalanceMismatches: Array<{
    indicator_profile_id: string
    ledgerBalance: number
    computedBalance: number
    delta: number
  }>
  openReservesVsPaymentsMismatches: Array<{
    indicator_profile_id: string
    openReservesSum: number
    openPaymentsSum: number
    delta: number
  }>
}

const FINANCIAL_INTEGRITY_LOG = "[financial-integrity:debug]"

/**
 * Diagnóstico de consistência financeira (somente development).
 * Chamar manualmente no console: `await debugFinancialIntegrityFromSupabase()`
 */
export async function debugFinancialIntegrityFromSupabase(
  indicatorProfileId?: string
): Promise<FinancialIntegrityReport | null> {
  if (!isDev()) {
    console.warn(FINANCIAL_INTEGRITY_LOG, "disponível apenas em NODE_ENV=development")
    return null
  }

  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    let rewardsQuery = db
      .from("rewards")
      .select("id, referral_id, indicator_profile_id, status, reward_type, amount, created_at")
      .limit(5000)

    if (indicatorProfileId) {
      rewardsQuery = rewardsQuery.eq("indicator_profile_id", indicatorProfileId)
    }

    let referralsQuery = db
      .from("referrals")
      .select("id, status, indicator_profile_id")
      .in("status", ["aprovada", "paga"])
      .limit(5000)

    if (indicatorProfileId) {
      referralsQuery = referralsQuery.eq("indicator_profile_id", indicatorProfileId)
    }

    let wtQuery = db
      .from("wallet_transactions")
      .select(
        "id, reward_id, payment_id, transaction_type, indicator_profile_id, amount, balance_after, created_at"
      )
      .order("created_at", { ascending: true })
      .limit(10000)

    if (indicatorProfileId) {
      wtQuery = wtQuery.eq("indicator_profile_id", indicatorProfileId)
    }

    let paymentsQuery = db
      .from("payments")
      .select(
        "id, indicator_profile_id, status, payment_kind, amount, wallet_reserve_transaction_id, wallet_debit_transaction_id"
      )
      .eq("payment_kind", "pix_withdrawal")
      .limit(5000)

    if (indicatorProfileId) {
      paymentsQuery = paymentsQuery.eq("indicator_profile_id", indicatorProfileId)
    }

    const [rewardsRes, referralsRes, wtRes, paymentsRes] = await Promise.all([
      rewardsQuery,
      referralsQuery,
      wtQuery,
      paymentsQuery,
    ])

    const rewards = (rewardsRes.data ?? []) as {
      id: string
      referral_id: string | null
      indicator_profile_id: string | null
      status: string
      reward_type: string
    }[]

    const referrals = (referralsRes.data ?? []) as {
      id: string
      status: string
    }[]

    const walletTxs = (wtRes.data ?? []) as {
      id: string
      reward_id: string | null
      payment_id: string | null
      transaction_type: string
      indicator_profile_id: string
      amount: number | string
      balance_after: number | string
    }[]

    const pixPayments = (paymentsRes.data ?? []) as {
      id: string
      indicator_profile_id: string
      status: string
      amount: number | string
      wallet_reserve_transaction_id: string | null
      wallet_debit_transaction_id: string | null
    }[]

    const rewardsByReferral = new Map<string, string[]>()
    const rewardsWithoutReferral: string[] = []
    const rewardsWithoutIndicator: string[] = []

    for (const rw of rewards) {
      if (!rw.referral_id) {
        rewardsWithoutReferral.push(rw.id)
        continue
      }
      if (!rw.indicator_profile_id) {
        rewardsWithoutIndicator.push(rw.id)
      }
      const list = rewardsByReferral.get(rw.referral_id) ?? []
      list.push(rw.id)
      rewardsByReferral.set(rw.referral_id, list)
    }

    const duplicateRewardsByReferral = [...rewardsByReferral.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([referral_id, reward_ids]) => ({
        referral_id,
        count: reward_ids.length,
        reward_ids,
      }))

    const creditsByReward = new Map<string, string[]>()
    const creditWalletTxWithoutReward: string[] = []

    for (const wt of walletTxs) {
      if (wt.transaction_type !== "credito") continue
      if (!wt.reward_id) {
        creditWalletTxWithoutReward.push(wt.id)
        continue
      }
      const list = creditsByReward.get(wt.reward_id) ?? []
      list.push(wt.id)
      creditsByReward.set(wt.reward_id, list)
    }

    const duplicateWalletCreditsByReward = [...creditsByReward.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([reward_id, transaction_ids]) => ({
        reward_id,
        count: transaction_ids.length,
        transaction_ids,
      }))

    const referralIdsWithReward = new Set(
      rewards.map((r) => r.referral_id).filter(Boolean) as string[]
    )

    const approvedReferralsWithoutReward = referrals
      .filter((ref) => !referralIdsWithReward.has(ref.id))
      .map((ref) => ({ referral_id: ref.id, status: ref.status }))

    const rewardIdsWithCredit = new Set(creditsByReward.keys())

    const availableRewardsWithoutWalletTx = rewards
      .filter(
        (rw) =>
          rw.status === "disponivel" &&
          rw.reward_type === "pix" &&
          rw.referral_id &&
          !rewardIdsWithCredit.has(rw.id)
      )
      .map((rw) => ({
        reward_id: rw.id,
        referral_id: rw.referral_id!,
        reward_type: rw.reward_type,
      }))

    const reserveTxIds = new Set(
      walletTxs
        .filter((wt) => wt.transaction_type === "saque_reserva")
        .map((wt) => wt.id)
    )
    const reversalPaymentIds = new Set(
      walletTxs
        .filter((wt) => wt.transaction_type === "reversao_saque" && wt.payment_id)
        .map((wt) => wt.payment_id as string)
    )
    const saquePaymentIds = new Set(
      walletTxs
        .filter((wt) => wt.transaction_type === "saque" && wt.payment_id)
        .map((wt) => wt.payment_id as string)
    )

    const pendingPixWithdrawalsWithoutReserve = pixPayments
      .filter(
        (p) =>
          p.status === "pendente" &&
          (!p.wallet_reserve_transaction_id ||
            !reserveTxIds.has(p.wallet_reserve_transaction_id))
      )
      .map((p) => ({
        payment_id: p.id,
        indicator_profile_id: p.indicator_profile_id,
      }))

    const reservesWithoutPayment = walletTxs
      .filter((wt) => wt.transaction_type === "saque_reserva" && !wt.payment_id)
      .map((wt) => wt.id)

    const approvedPixWithoutDefinitiveDebit = pixPayments
      .filter(
        (p) =>
          p.status === "pago" &&
          !p.wallet_debit_transaction_id &&
          !saquePaymentIds.has(p.id)
      )
      .map((p) => ({ payment_id: p.id, status: p.status }))

    const rejectedPixWithoutReversal = pixPayments
      .filter(
        (p) =>
          p.status === "rejeitado" &&
          p.wallet_reserve_transaction_id != null &&
          !reversalPaymentIds.has(p.id)
      )
      .map((p) => ({ payment_id: p.id }))

    const ledgerByIndicator = new Map<string, typeof walletTxs>()
    for (const wt of walletTxs) {
      const list = ledgerByIndicator.get(wt.indicator_profile_id) ?? []
      list.push(wt)
      ledgerByIndicator.set(wt.indicator_profile_id, list)
    }

    const ledgerBalanceMismatches: FinancialIntegrityReport["ledgerBalanceMismatches"] =
      []
    const openReservesVsPaymentsMismatches: FinancialIntegrityReport["openReservesVsPaymentsMismatches"] =
      []

    const debitTypes = new Set(["saque_reserva", "saque", "debito"])
    const creditTypes = new Set(["credito", "reversao_saque"])

    for (const [indId, txs] of ledgerByIndicator) {
      if (txs.length === 0) continue
      const last = txs[txs.length - 1]
      const ledgerBalance = Math.max(0, Number(last.balance_after))

      let computedBalance = 0
      for (const t of txs) {
        const amt = Number(t.amount)
        if (creditTypes.has(t.transaction_type)) {
          computedBalance += amt
        } else if (debitTypes.has(t.transaction_type)) {
          computedBalance -= amt
        }
        computedBalance = Math.max(0, computedBalance)
        const rowAfter = Math.max(0, Number(t.balance_after))
        if (Math.abs(computedBalance - rowAfter) > 0.01) {
          ledgerBalanceMismatches.push({
            indicator_profile_id: indId,
            ledgerBalance: rowAfter,
            computedBalance,
            delta: computedBalance - rowAfter,
          })
          break
        }
      }

      const finalComputed = Math.max(0, computedBalance)
      if (
        ledgerBalanceMismatches.every((m) => m.indicator_profile_id !== indId) &&
        Math.abs(finalComputed - ledgerBalance) > 0.01
      ) {
        ledgerBalanceMismatches.push({
          indicator_profile_id: indId,
          ledgerBalance,
          computedBalance: finalComputed,
          delta: finalComputed - ledgerBalance,
        })
      }

      const openReserveTxSum = txs
        .filter((t) => t.transaction_type === "saque_reserva")
        .reduce((s, t) => s + Number(t.amount), 0)
      const openPaymentsSum = pixPayments
        .filter(
          (p) =>
            p.indicator_profile_id === indId &&
            (p.status === "pendente" || p.status === "aprovado")
        )
        .reduce((s, p) => s + Number(p.amount), 0)
      const reservesDelta = Math.abs(openReserveTxSum - openPaymentsSum)
      if (reservesDelta > 0.01) {
        openReservesVsPaymentsMismatches.push({
          indicator_profile_id: indId,
          openReservesSum: openReserveTxSum,
          openPaymentsSum,
          delta: reservesDelta,
        })
      }
    }

    const report: FinancialIntegrityReport = {
      duplicateRewardsByReferral,
      duplicateWalletCreditsByReward,
      rewardsWithoutReferral,
      rewardsWithoutIndicator,
      approvedReferralsWithoutReward,
      availableRewardsWithoutWalletTx,
      creditWalletTxWithoutReward,
      pendingPixWithdrawalsWithoutReserve,
      reservesWithoutPayment,
      approvedPixWithoutDefinitiveDebit,
      rejectedPixWithoutReversal,
      ledgerBalanceMismatches,
      openReservesVsPaymentsMismatches,
    }

    console.log(FINANCIAL_INTEGRITY_LOG, {
      indicatorProfileId: indicatorProfileId ?? "all",
      summary: {
        duplicateRewards: duplicateRewardsByReferral.length,
        duplicateCredits: duplicateWalletCreditsByReward.length,
        rewardsWithoutReferral: rewardsWithoutReferral.length,
        rewardsWithoutIndicator: rewardsWithoutIndicator.length,
        approvedWithoutReward: approvedReferralsWithoutReward.length,
        disponivelSemCredito: availableRewardsWithoutWalletTx.length,
        creditoSemRewardId: creditWalletTxWithoutReward.length,
        pixPendenteSemReserva: pendingPixWithdrawalsWithoutReserve.length,
        reservasSemPayment: reservesWithoutPayment.length,
        pixPagoSemDebito: approvedPixWithoutDefinitiveDebit.length,
        pixRejeitadoSemReversao: rejectedPixWithoutReversal.length,
        divergenciaLedger: ledgerBalanceMismatches.length,
        reservasVsPagamentos: openReservesVsPaymentsMismatches.length,
      },
      report,
    })

    return report
  } catch (e) {
    console.error(FINANCIAL_INTEGRITY_LOG, e)
    return null
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
    devLogPixKey("load", { status: "start" })

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      devLogPixKey("load", { status: "no_session" })
      return null
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) {
      devLogPixKey("load", { status: "profile_error", message: profileError?.message })
      return null
    }
    if ((profile as { role: string }).role !== "indicador") {
      devLogPixKey("load", { status: "not_indicador", role: (profile as { role: string }).role })
      return null
    }

    const { data, error } = await db
      .from("pix_keys")
      .select("key_type, key_value")
      .eq("profile_id", user.id)
      .eq("is_primary", true)
      .maybeSingle()

    if (error) {
      devLogPixKey("load", { status: "error", message: error.message, code: error.code })
      return null
    }

    if (!data) {
      devLogPixKey("load", { status: "empty", profileId: user.id })
      return { keyType: "cpf", keyValue: "" }
    }

    const row = data as { key_type: string; key_value: string }
    const result = {
      keyType: normalizePixKeyType(row.key_type),
      keyValue: row.key_value ?? "",
    }
    devLogPixKey("load", {
      status: "success",
      profileId: user.id,
      keyType: result.keyType,
      hasValue: Boolean(result.keyValue),
    })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devLogPixKey("load", { status: "exception", message: msg })
    return null
  }
}

/**
 * Grava ou atualiza a chave Pix primária do indicador (UPSERT lógico em pix_keys).
 */
export async function saveIndicadorPrimaryPixKeyFromSupabase(
  keyType: TipoChavePix,
  keyValue: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = keyValue.trim()
  if (!trimmed) {
    return { ok: false, message: "Informe a chave Pix." }
  }
  if (!PIX_KEY_TYPES_ALLOWED.includes(keyType)) {
    return { ok: false, message: "Tipo de chave Pix inválido." }
  }

  try {
    devLogPixKey("save:start", { keyType, valueLength: trimmed.length })

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      devLogPixKey("save:error", { reason: "no_session" })
      return { ok: false, message: "Sessão não encontrada. Faça login novamente." }
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) {
      devLogPixKey("save:error", { reason: "profile", message: profileError?.message })
      return { ok: false, message: "Perfil não encontrado." }
    }
    if ((profile as { role: string }).role !== "indicador") {
      devLogPixKey("save:error", { reason: "not_indicador" })
      return { ok: false, message: "Apenas indicadores podem cadastrar chave Pix." }
    }

    const nowIso = new Date().toISOString()
    const { data: existing, error: fetchErr } = await db
      .from("pix_keys")
      .select("id")
      .eq("profile_id", user.id)
      .eq("is_primary", true)
      .maybeSingle()

    if (fetchErr) {
      devLogPixKey("save:error", { reason: "fetch_primary", message: fetchErr.message })
      return { ok: false, message: "Não foi possível verificar a chave existente." }
    }

    const existingId = (existing as { id?: string } | null)?.id ?? null
    const payload = {
      profile_id: user.id,
      key_type: keyType,
      key_value: trimmed,
      is_primary: true,
      updated_at: nowIso,
    }

    if (existingId) {
      const { data: updated, error: updateErr } = await db
        .from("pix_keys")
        .update({
          key_type: keyType,
          key_value: trimmed,
          is_primary: true,
          updated_at: nowIso,
        })
        .eq("id", existingId)
        .eq("profile_id", user.id)
        .select("id, key_type, key_value, is_primary")
        .maybeSingle()

      if (updateErr || !updated) {
        devLogPixKey("save:error", {
          reason: "update",
          message: updateErr?.message ?? "no_row",
          code: updateErr?.code ?? null,
        })
        const hint =
          updateErr?.code === "23505"
            ? " Esta chave Pix já está cadastrada para outro usuário."
            : ""
        return {
          ok: false,
          message: (updateErr?.message || "Não foi possível atualizar a chave Pix.") + hint,
        }
      }
    } else {
      const { data: inserted, error: insertErr } = await db
        .from("pix_keys")
        .insert(payload)
        .select("id, key_type, key_value, is_primary")
        .maybeSingle()

      if (insertErr || !inserted) {
        devLogPixKey("save:error", {
          reason: "insert",
          message: insertErr?.message ?? "no_row",
          code: insertErr?.code ?? null,
        })
        const hint =
          insertErr?.code === "23505"
            ? " Esta chave Pix já está cadastrada para outro usuário."
            : ""
        return {
          ok: false,
          message: (insertErr?.message || "Não foi possível cadastrar a chave Pix.") + hint,
        }
      }
    }

    const verify = await loadIndicadorPrimaryPixKeyFromSupabase()
    if (!verify || verify.keyValue !== trimmed || verify.keyType !== keyType) {
      devLogPixKey("save:error", {
        reason: "verify_failed",
        expected: { keyType, keyValue: trimmed },
        got: verify,
      })
      return {
        ok: false,
        message:
          "A chave foi enviada, mas não foi confirmada no banco. Verifique permissões (RLS) de pix_keys.",
      }
    }

    devLogPixKey("save:success", { profileId: user.id, keyType, existingId })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devLogPixKey("save:error", { reason: "exception", message: msg })
    return { ok: false, message: msg || "Erro inesperado ao salvar chave Pix." }
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

    const { count, error } = await db
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("commercial_profile_id", user.id)
      .in("pipeline_stage", [
        "novo",
        "tentativa_contato",
        "contato_realizado",
        "negociacao",
        "agendado",
        "instalacao",
      ])

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
    return await expandPaymentReceiptUrlsInPagamentos(mappedBase)
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
