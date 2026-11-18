"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_ADMIN,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { pagamentos } from "@/lib/services/mock-data.service"
import type { Pagamento } from "@/types"
import { DollarSign, TrendingUp, Clock, CheckCircle, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts"
import { PeriodFilter } from "@/components/period/period-filter"
import { chartAxis, chartColor, chartGrid, chartIsEmpty, chartTooltip, pieSlices } from "@/lib/charts/theme"
import { currentMonthKey } from "@/lib/period/range"
import Link from "next/link"

const MOCK_MONTHLY = [
  { mes: "Jan", pago: 12500, pendente: 3200 },
  { mes: "Fev", pago: 15800, pendente: 2800 },
  { mes: "Mar", pago: 18200, pendente: 4100 },
  { mes: "Abr", pago: 16500, pendente: 3500 },
  { mes: "Mai", pago: 21000, pendente: 2900 },
  { mes: "Jun", pago: 19800, pendente: 2345 },
]

const MOCK_FLUXO = [
  { mes: "Jan", entrada: 45000, saida: 12500 },
  { mes: "Fev", entrada: 52000, saida: 15800 },
  { mes: "Mar", entrada: 61000, saida: 18200 },
  { mes: "Abr", entrada: 58000, saida: 16500 },
  { mes: "Mai", entrada: 72000, saida: 21000 },
  { mes: "Jun", entrada: 68000, saida: 19800 },
]

function monthKeyPt(d: Date): string {
  return d.toLocaleString("pt-BR", { month: "short", year: "2-digit" })
}

function buildLastSixMonthsSeries(
  lista: Pagamento[]
): { mes: string; pago: number; pendente: number; entrada: number; saida: number }[] {
  const now = new Date()
  const keys: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(monthKeyPt(d))
  }
  const pagoBy = new Map<string, number>()
  const pendBy = new Map<string, number>()
  for (const k of keys) {
    pagoBy.set(k, 0)
    pendBy.set(k, 0)
  }
  for (const p of lista) {
    const d = new Date(p.createdAt)
    const k = monthKeyPt(d)
    if (!pagoBy.has(k)) continue
    if (p.status === "pago") {
      pagoBy.set(k, (pagoBy.get(k) ?? 0) + p.valor)
    }
    if (p.status === "pendente" || p.status === "aprovado") {
      pendBy.set(k, (pendBy.get(k) ?? 0) + p.valor)
    }
  }
  return keys.map((mes) => {
    const pg = pagoBy.get(mes) ?? 0
    const pd = pendBy.get(mes) ?? 0
    return { mes, pago: pg, pendente: pd, entrada: pg + pd, saida: pg }
  })
}

type FinancePoint = { mes: string; pago: number; pendente: number; entrada: number; saida: number }

export default function AdminFinanceiroPage() {
  const searchParams = useSearchParams()
  const [lista, setLista] = useState<Pagamento[]>([])
  const [series, setSeries] = useState<FinancePoint[]>([])
  const [paidValue, setPaidValue] = useState(0)
  const [pendingValue, setPendingValue] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [paidCount, setPaidCount] = useState(0)
  const [cancelledCount, setCancelledCount] = useState(0)
  const [currentBalance, setCurrentBalance] = useState(0)
  const [periodLabel, setPeriodLabel] = useState(currentMonthKey())

  const loadFinanceiro = useCallback(async () => {
    if (isDataProviderMock()) {
      setLista(pagamentos)
      return
    }
    const params = new URLSearchParams(searchParams.toString())
    if (!params.get("month") && !params.get("period") && !params.get("from")) params.set("month", currentMonthKey())
    const response = await fetch(`/api/admin/dashboard?${params.toString()}`, { cache: "no-store", credentials: "same-origin" })
    if (!response.ok) return
    const data = await response.json() as {
      ok?: boolean
      periodLabel?: string
      paidValue?: number
      pendingValue?: number
      pendingCount?: number
      paidCount?: number
      cancelledCount?: number
      currentBalance?: number
      paymentSeries?: Array<{ bucket: string; pago: number; pendente: number }>
    }
    if (!data.ok) return
    setPeriodLabel(data.periodLabel ?? currentMonthKey())
    setPaidValue(Number(data.paidValue ?? 0))
    setPendingValue(Number(data.pendingValue ?? 0))
    setPendingCount(Number(data.pendingCount ?? 0))
    setPaidCount(Number(data.paidCount ?? 0))
    setCancelledCount(Number(data.cancelledCount ?? 0))
    setCurrentBalance(Number(data.currentBalance ?? 0))
    setSeries((data.paymentSeries ?? []).map((row) => ({
      mes: row.bucket,
      pago: Number(row.pago) || 0,
      pendente: Number(row.pendente) || 0,
      entrada: (Number(row.pago) || 0) + (Number(row.pendente) || 0),
      saida: Number(row.pago) || 0,
    })))
    setLista([])
  }, [searchParams])

  useEffect(() => {
    void loadFinanceiro()
  }, [loadFinanceiro])

  useRealtimeReload(loadFinanceiro, REALTIME_TABLES_ADMIN, {
    enabled: !isDataProviderMock(),
  })

  const mockPending = lista.filter((p: Pagamento) => p.status === "pendente")
  const mockPaid = lista.filter((p: Pagamento) => p.status === "pago")
  const mockCancelled = lista.filter((p: Pagamento) => p.status === "cancelado" || p.status === "rejeitado")
  const usingServer = !isDataProviderMock()
  const totalPendente = usingServer ? pendingValue : mockPending.reduce((acc, p) => acc + p.valor, 0)
  const totalPago = usingServer ? paidValue : mockPaid.reduce((acc, p) => acc + p.valor, 0)
  const totalGeral = totalPendente + totalPago
  const pendingShown = usingServer ? pendingCount : mockPending.length
  const monthlyData = usingServer ? series : MOCK_MONTHLY
  const fluxoCaixa = usingServer ? series : MOCK_FLUXO
  const statusData = pieSlices([
    { name: "Pago", value: usingServer ? paidCount : mockPaid.length, color: chartColor(2) },
    { name: "Pendente", value: usingServer ? pendingShown : mockPending.length, color: chartColor(1) },
    { name: "Cancelado", value: usingServer ? cancelledCount : mockCancelled.length, color: chartColor(4) },
  ])

  const receitaMesCard =
    fluxoCaixa.length > 0 ? fluxoCaixa[fluxoCaixa.length - 1]?.entrada ?? 0 : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Saldo atual é cumulativo. Os gráficos mensais respeitam o período escolhido."
      >
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/pagamentos-pendentes">
              <Clock className="mr-2 h-4 w-4" />
              Pendentes ({pendingShown})
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/historico-pagamentos">Ver Historico</Link>
          </Button>
        </div>
      </PageHeader>
      <PeriodFilter />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total em Comissoes"
          value={`R$ ${totalGeral.toLocaleString("pt-BR")}`}
          subtitle={`No período: ${periodLabel}`}
          icon={DollarSign}
          variant="primary"
        />
        <StatCard
          title="Total Pago"
          value={`R$ ${totalPago.toLocaleString("pt-BR")}`}
          subtitle={`${usingServer ? paidCount : mockPaid.length} pagamentos no período`}
          icon={CheckCircle}
          variant="success"
        />
        <StatCard
          title="Pendente"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          subtitle={`${pendingShown} solicitações no período`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Saldo atual"
          value={`R$ ${(usingServer ? currentBalance : Math.max(0, totalGeral - totalPago)).toLocaleString("pt-BR")}`}
          subtitle="Saldo atual, sem filtro mensal"
          icon={Wallet}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Pagamentos por Mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {chartIsEmpty(monthlyData) ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem pagamentos neste período.</div>
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid.stroke} />
                  <XAxis dataKey="mes" stroke={chartAxis.stroke} fontSize={12} />
                  <YAxis stroke={chartAxis.stroke} fontSize={12} />
                  <Tooltip
                    cursor={false}
                    contentStyle={chartTooltip.contentStyle} labelStyle={chartTooltip.labelStyle} itemStyle={chartTooltip.itemStyle}
                    formatter={(value: number) => `R$ ${value.toLocaleString("pt-BR")}`}
                  />
                  <Bar dataKey="pago" fill={chartColor(2)} radius={[4, 4, 0, 0]} name="Pago" />
                  <Bar dataKey="pendente" fill={chartColor(1)} radius={[4, 4, 0, 0]} name="Pendente" />
                </BarChart>
              </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Distribuicao de Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {statusData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem status neste período.</div>
              ) : (
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
                  <Tooltip
                    contentStyle={chartTooltip.contentStyle} labelStyle={chartTooltip.labelStyle} itemStyle={chartTooltip.itemStyle}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Fluxo de Caixa - Indicacoes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fluxoCaixa}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid.stroke} />
                <XAxis dataKey="mes" stroke={chartAxis.stroke} fontSize={12} />
                <YAxis stroke={chartAxis.stroke} fontSize={12} />
                <Tooltip
                  contentStyle={chartTooltip.contentStyle} labelStyle={chartTooltip.labelStyle} itemStyle={chartTooltip.itemStyle}
                  formatter={(value: number) => `R$ ${value.toLocaleString("pt-BR")}`}
                />
                <Line
                  type="monotone"
                  dataKey="entrada"
                  stroke={chartColor(2)}
                  strokeWidth={2}
                  dot={{ fill: chartColor(2) }}
                  name="Volume (pago + pendente)"
                />
                <Line
                  type="monotone"
                  dataKey="saida"
                  stroke={chartColor(4)}
                  strokeWidth={2}
                  dot={{ fill: chartColor(4) }}
                  name="Pago no mes"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                <ArrowUpRight className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Volume no ultimo mes (grafico)</p>
                <p className="text-2xl font-bold">
                  R${" "}
                  {receitaMesCard.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isDataProviderMock() ? "Dados de demonstração" : "Dados do Supabase"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <ArrowDownRight className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total pago no período</p>
                <p className="text-2xl font-bold">
                  R$ {totalPago.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Custo de aquisicao</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Indicadores</p>
                <p className="text-2xl font-bold">
                  {paidCount + pendingShown > 0
                    ? `${((paidCount / (paidCount + pendingShown)) * 100).toFixed(0)}%`
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isDataProviderMock() ? "Excelente performance" : "Proporcao pagos / registros"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
