"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { loadAdminDashboardMetricsFromSupabase, type AdminDashboardMetrics } from "@/lib/services"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_ADMIN,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { Users, UserCheck, DollarSign, TrendingUp, FileText, Clock, CheckCircle, Globe } from "lucide-react"
import type { PublicPreRegistrationMetrics } from "@/lib/public-pre-registration/dashboard"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts"
import { PeriodFilter } from "@/components/period/period-filter"
import { chartAxis, chartColor, chartGrid, chartIsEmpty, chartTooltip, pieSlices } from "@/lib/charts/theme"
import { currentMonthKey } from "@/lib/period/range"

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

const EMPTY_ADMIN_DASHBOARD: AdminDashboardMetrics = {
  totalReferrals: 0,
  pendingReferrals: 0,
  inAttendanceReferrals: 0,
  approvedReferrals: 0,
  rejectedReferrals: 0,
  slaExpiredReferrals: 0,
  unreadNotifications: 0,
  totalCommercials: 0,
  availableCommercials: 0,
  todayReferrals: 0,
  totalIndicators: 0,
  activeIndicators: 0,
  pendingPaymentsValue: 0,
  pendingPaymentsCount: 0,
  totalPaidValue: 0,
  monthlyData: [],
  topIndicadores: [],
}

export default function AdminDashboard() {
  const searchParams = useSearchParams()
  const [periodLabel, setPeriodLabel] = useState(currentMonthKey())
  const fallbackMetrics: AdminDashboardMetrics = {
    totalReferrals: 157,
    pendingReferrals: 12,
    inAttendanceReferrals: 19,
    approvedReferrals: 126,
    rejectedReferrals: 0,
    slaExpiredReferrals: 0,
    unreadNotifications: 0,
    totalCommercials: 4,
    availableCommercials: 3,
    todayReferrals: 7,
    totalIndicators: 5,
    activeIndicators: 5,
    pendingPaymentsValue: 2345.6,
    pendingPaymentsCount: 15,
    totalPaidValue: 12590.3,
    monthlyData: [
      { mes: "Jan", indicacoes: 45, conversoes: 18 },
      { mes: "Fev", indicacoes: 52, conversoes: 22 },
      { mes: "Mar", indicacoes: 61, conversoes: 28 },
      { mes: "Abr", indicacoes: 58, conversoes: 25 },
      { mes: "Mai", indicacoes: 72, conversoes: 32 },
      { mes: "Jun", indicacoes: 68, conversoes: 30 },
    ],
    topIndicadores: [
      { nome: "Ana", conversoes: 58, total: 67 },
      { nome: "Maria", conversoes: 35, total: 42 },
      { nome: "Joao", conversoes: 18, total: 25 },
      { nome: "Lucas", conversoes: 10, total: 15 },
      { nome: "Carla", conversoes: 5, total: 8 },
    ],
  }

  const [dashboardMetrics, setDashboardMetrics] = useState<AdminDashboardMetrics>(() =>
    isDataProviderMock() ? fallbackMetrics : EMPTY_ADMIN_DASHBOARD
  )
  const [preRegistrationMetrics, setPreRegistrationMetrics] =
    useState<PublicPreRegistrationMetrics | null>(null)

  const loadMetrics = useCallback(async () => {
    if (!isDataProviderMock()) {
      const params = new URLSearchParams(searchParams.toString())
      if (!params.get("month") && !params.get("period") && !params.get("from")) params.set("month", currentMonthKey())
      const response = await fetch(`/api/admin/dashboard?${params.toString()}`, { cache: "no-store", credentials: "same-origin" })
      if (response.ok) {
        const data = await response.json() as {
          ok?: boolean
          periodLabel?: string
          totalReferrals?: number
          pendingReferrals?: number
          inAttendanceReferrals?: number
          approvedReferrals?: number
          rejectedReferrals?: number
          paidValue?: number
          pendingValue?: number
          pendingCount?: number
          currentBalance?: number
        }
        if (data.ok) {
          setPeriodLabel(data.periodLabel ?? currentMonthKey())
          setDashboardMetrics({
            ...EMPTY_ADMIN_DASHBOARD,
            totalReferrals: data.totalReferrals ?? 0,
            pendingReferrals: data.pendingReferrals ?? 0,
            inAttendanceReferrals: data.inAttendanceReferrals ?? 0,
            approvedReferrals: data.approvedReferrals ?? 0,
            rejectedReferrals: data.rejectedReferrals ?? 0,
            pendingPaymentsCount: data.pendingCount ?? 0,
            pendingPaymentsValue: Number(data.pendingValue ?? 0),
            totalPaidValue: Number(data.paidValue ?? 0),
            monthlyData: [{ mes: data.periodLabel ?? "Período", indicacoes: data.totalReferrals ?? 0, conversoes: data.approvedReferrals ?? 0 }],
          })
          return
        }
      }
    }
    const metricsFromSupabase = await loadAdminDashboardMetricsFromSupabase()

    if (!isDataProviderMock()) {
      try {
        const res = await fetch("/api/admin/public-pre-registration/metrics", {
          cache: "no-store",
        })
        if (res.ok) {
          const data = (await res.json()) as {
            ok?: boolean
            metrics?: PublicPreRegistrationMetrics
          }
          if (data.ok && data.metrics) {
            setPreRegistrationMetrics(data.metrics)
          }
        }
      } catch {
        setPreRegistrationMetrics(null)
      }
    }

    if (!metricsFromSupabase) {
      if (isDev()) {
        if (isDataProviderMock()) {
          console.warn("[admin-dashboard] Supabase indisponível — mantendo métricas de demonstração")
        } else {
          console.warn("[flow-check:debug]", {
            flow: "admin-dashboard",
            ok: false,
            note: "Supabase sem métricas — painel zerado (sem mock)",
          })
          setDashboardMetrics(EMPTY_ADMIN_DASHBOARD)
        }
      } else if (!isDataProviderMock()) {
        setDashboardMetrics(EMPTY_ADMIN_DASHBOARD)
      }
      return
    }

    if (isDev()) {
      console.log("[flow-check:debug]", { flow: "admin-dashboard", ok: true })
      console.log("[admin-dashboard] métricas recebidas do Supabase", metricsFromSupabase)
    }
    setDashboardMetrics(metricsFromSupabase)
  }, [searchParams])

  useEffect(() => {
    void loadMetrics()
  }, [loadMetrics, searchParams])

  useRealtimeReload(loadMetrics, REALTIME_TABLES_ADMIN, {
    enabled: !isDataProviderMock(),
  })

  const totalIndicadores = dashboardMetrics.totalIndicators
  const indicadoresAtivos = dashboardMetrics.activeIndicators
  const totalComerciais = dashboardMetrics.totalCommercials
  const comerciaisDisponiveis = dashboardMetrics.availableCommercials
  const totalIndicacoes = dashboardMetrics.totalReferrals
  const indicacoesAprovadas = dashboardMetrics.approvedReferrals
  const taxaConversao = totalIndicacoes > 0 ? ((indicacoesAprovadas / totalIndicacoes) * 100).toFixed(1) : "0"
  const pagamentosPendentes = dashboardMetrics.pendingPaymentsCount
  const totalPendente = dashboardMetrics.pendingPaymentsValue
  const totalPago = dashboardMetrics.totalPaidValue

  const statusData = pieSlices([
    { name: "Pendente", value: dashboardMetrics.pendingReferrals, color: chartColor(0) },
    { name: "Em Andamento", value: dashboardMetrics.inAttendanceReferrals, color: chartColor(1) },
    { name: "Aprovada", value: dashboardMetrics.approvedReferrals, color: chartColor(2) },
    { name: "Recusada", value: dashboardMetrics.rejectedReferrals, color: chartColor(4) },
  ])
  const monthlyData = dashboardMetrics.monthlyData
  const topIndicadores = dashboardMetrics.topIndicadores

  useEffect(() => {
    if (!isDev()) return
    console.log("[admin-dashboard] dados finais gráficos", {
      statusData,
      monthlyData,
      topIndicadores,
    })
  }, [statusData, monthlyData, topIndicadores])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Administrativo"
        description={`Período: ${periodLabel}. O saldo contábil atual permanece cumulativo.`}
      />
      <PeriodFilter />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total de Indicadores"
          value={totalIndicadores}
          subtitle={`${indicadoresAtivos} ativos`}
          icon={Users}
        />
        <StatCard
          title="Taxa de Conversao"
          value={`${taxaConversao}%`}
          subtitle={`${indicacoesAprovadas} de ${totalIndicacoes}`}
          icon={TrendingUp}
        />
        <StatCard
          title="Pagamentos Pendentes"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          subtitle={`${pagamentosPendentes} solicitacoes`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Total Pago"
          value={`R$ ${totalPago.toLocaleString("pt-BR")}`}
          subtitle="Neste mes"
          icon={DollarSign}
          variant="success"
        />
      </div>

      {!isDataProviderMock() && preRegistrationMetrics ? (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Pré-cadastros Web
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Hoje</p>
                <p className="text-2xl font-bold">{preRegistrationMetrics.today}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Últimos 7 dias</p>
                <p className="text-2xl font-bold">
                  {preRegistrationMetrics.last7Days}
                </p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Últimos 30 dias</p>
                <p className="text-2xl font-bold">
                  {preRegistrationMetrics.last30Days}
                </p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">
                  Enviados ao Controllr
                </p>
                <p className="text-2xl font-bold">
                  {preRegistrationMetrics.sentToControllr}
                </p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">
                  Com erro de integração
                </p>
                <p className="text-2xl font-bold text-destructive">
                  {preRegistrationMetrics.integrationErrors}
                </p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">
                  Convertidos em cliente
                </p>
                <p className="text-2xl font-bold text-emerald-600">
                  {preRegistrationMetrics.convertedToClient}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Indicacoes por Mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {chartIsEmpty(monthlyData) ? <p className="text-sm text-muted-foreground">Sem séries neste período.</p> : null}
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData} aria-label="Indicações e conversões do período">
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid.stroke} />
                  <XAxis dataKey="mes" stroke={chartAxis.stroke} tick={chartAxis.tick} fontSize={12} />
                  <YAxis stroke={chartAxis.stroke} tick={chartAxis.tick} fontSize={12} />
                  <Tooltip {...chartTooltip} />
                  <Legend />
                  <Line type="monotone" dataKey="indicacoes" stroke={chartColor(0)} strokeWidth={2} dot={{ fill: chartColor(0) }} name="Indicacoes" />
                  <Line type="monotone" dataKey="conversoes" stroke={chartColor(2)} strokeWidth={2} dot={{ fill: chartColor(2) }} name="Conversoes" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Status das Indicacoes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    nameKey="name"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltip} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Top 5 Indicadores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topIndicadores} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid.stroke} />
                  <XAxis type="number" stroke={chartAxis.stroke} tick={chartAxis.tick} fontSize={12} />
                  <YAxis dataKey="nome" type="category" stroke={chartAxis.stroke} tick={chartAxis.tick} fontSize={12} width={80} />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey="conversoes" fill={chartColor(0)} radius={[0, 4, 4, 0]} name="Conversoes" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Resumo de Equipe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Indicadores</p>
                  <p className="text-sm text-muted-foreground">{indicadoresAtivos} de {totalIndicadores} ativos</p>
                </div>
              </div>
              <span className="text-2xl font-bold">{totalIndicadores}</span>
            </div>
            
            <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10">
                  <UserCheck className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Comerciais</p>
                  <p className="text-sm text-muted-foreground">{comerciaisDisponiveis} disponiveis</p>
                </div>
              </div>
              <span className="text-2xl font-bold">{totalComerciais}</span>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
                  <CheckCircle className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="font-medium">Conversoes Hoje</p>
                  <p className="text-sm text-muted-foreground">Meta: 10</p>
                </div>
              </div>
              <span className="text-2xl font-bold">{dashboardMetrics.todayReferrals}</span>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10">
                  <FileText className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="font-medium">Leads Pendentes</p>
                  <p className="text-sm text-muted-foreground">Aguardando atendimento</p>
                </div>
              </div>
              <span className="text-2xl font-bold">{dashboardMetrics.pendingReferrals}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
