"use client"

import { useCallback, useEffect, useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { loadAdminDashboardMetricsFromSupabase, type AdminDashboardMetrics } from "@/lib/services"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_ADMIN,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { Users, UserCheck, DollarSign, TrendingUp, FileText, Clock, CheckCircle } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts"

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

  const loadMetrics = useCallback(async () => {
    const metricsFromSupabase = await loadAdminDashboardMetricsFromSupabase()

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
  }, [])

  useEffect(() => {
    void loadMetrics()
  }, [loadMetrics])

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

  const statusData = [
    { name: "Pendente", value: dashboardMetrics.pendingReferrals, color: "#f59e0b" },
    { name: "Em Andamento", value: dashboardMetrics.inAttendanceReferrals, color: "#3b82f6" },
    { name: "Aprovada", value: dashboardMetrics.approvedReferrals, color: "#22c55e" },
    { name: "Recusada", value: dashboardMetrics.rejectedReferrals, color: "#ef4444" },
  ]
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
        description="Visao geral completa do sistema de indicacoes"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total de Indicadores"
          value={totalIndicadores}
          subtitle={`${indicadoresAtivos} ativos`}
          icon={Users}
          trend={{ value: 12, isPositive: true }}
        />
        <StatCard
          title="Taxa de Conversao"
          value={`${taxaConversao}%`}
          subtitle={`${indicacoesAprovadas} de ${totalIndicacoes}`}
          icon={TrendingUp}
          trend={{ value: 5.2, isPositive: true }}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Indicacoes por Mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="indicacoes"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                    name="Indicacoes"
                  />
                  <Line
                    type="monotone"
                    dataKey="conversoes"
                    stroke="hsl(var(--success))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--success))" }}
                    name="Conversoes"
                  />
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
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis dataKey="nome" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} width={80} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="conversoes" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Conversoes" />
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
