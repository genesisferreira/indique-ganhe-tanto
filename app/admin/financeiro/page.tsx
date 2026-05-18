"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { loadAdminAllPaymentsFromSupabase } from "@/lib/services/supabase-data.service"
import type { Pagamento } from "@/types"
import { DollarSign, TrendingUp, Clock, CheckCircle, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts"
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

export default function AdminFinanceiroPage() {
  const [lista, setLista] = useState<Pagamento[]>([])

  const loadFinanceiro = useCallback(async () => {
    if (isDataProviderMock()) {
      setLista(pagamentos)
      return
    }
    const r = await loadAdminAllPaymentsFromSupabase()
    setLista(r ?? [])
  }, [])

  useEffect(() => {
    void loadFinanceiro()
  }, [loadFinanceiro])

  useRealtimeReload(loadFinanceiro, REALTIME_TABLES_ADMIN, {
    enabled: !isDataProviderMock(),
  })

  const pagamentosPendentes = lista.filter((p: Pagamento) => p.status === "pendente")
  const pagamentosPagos = lista.filter((p: Pagamento) => p.status === "pago")
  const pagamentosCancelados = lista.filter(
    (p: Pagamento) => p.status === "cancelado" || p.status === "rejeitado"
  )

  const totalPendente = pagamentosPendentes.reduce((acc: number, p: Pagamento) => acc + p.valor, 0)
  const totalPago = pagamentosPagos.reduce((acc: number, p: Pagamento) => acc + p.valor, 0)
  const totalGeral = totalPendente + totalPago

  const monthlyData = useMemo(() => {
    if (isDataProviderMock()) return MOCK_MONTHLY
    return buildLastSixMonthsSeries(lista).map(({ mes, pago, pendente }) => ({
      mes,
      pago,
      pendente,
    }))
  }, [lista])

  const fluxoCaixa = useMemo(() => {
    if (isDataProviderMock()) return MOCK_FLUXO
    return buildLastSixMonthsSeries(lista).map(({ mes, entrada, saida }) => ({
      mes,
      entrada,
      saida,
    }))
  }, [lista])

  const statusData = [
    { name: "Pago", value: pagamentosPagos.length, color: "#22c55e" },
    { name: "Pendente", value: pagamentosPendentes.length, color: "#f59e0b" },
    { name: "Cancelado", value: pagamentosCancelados.length, color: "#ef4444" },
  ]

  const receitaMesCard =
    fluxoCaixa.length > 0 ? fluxoCaixa[fluxoCaixa.length - 1]?.entrada ?? 0 : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Visao geral financeira do programa de indicacoes"
      >
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/pagamentos-pendentes">
              <Clock className="mr-2 h-4 w-4" />
              Pendentes ({pagamentosPendentes.length})
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/historico-pagamentos">Ver Historico</Link>
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total em Comissoes"
          value={`R$ ${totalGeral.toLocaleString("pt-BR")}`}
          subtitle="Acumulado"
          icon={DollarSign}
          variant="primary"
        />
        <StatCard
          title="Total Pago"
          value={`R$ ${totalPago.toLocaleString("pt-BR")}`}
          subtitle={`${pagamentosPagos.length} pagamentos`}
          icon={CheckCircle}
          variant="success"
          trend={{ value: 12.5, isPositive: true }}
        />
        <StatCard
          title="Pendente"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          subtitle={`${pagamentosPendentes.length} solicitacoes`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Saldo Disponivel"
          value={`R$ ${Math.max(0, totalGeral - totalPago).toLocaleString("pt-BR")}`}
          subtitle="Para pagamento"
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => `R$ ${value.toLocaleString("pt-BR")}`}
                  />
                  <Bar dataKey="pago" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Pago" />
                  <Bar dataKey="pendente" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} name="Pendente" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Distribuicao de Status</CardTitle>
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

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Fluxo de Caixa - Indicacoes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fluxoCaixa}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => `R$ ${value.toLocaleString("pt-BR")}`}
                />
                <Line
                  type="monotone"
                  dataKey="entrada"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--success))" }}
                  name="Volume (pago + pendente)"
                />
                <Line
                  type="monotone"
                  dataKey="saida"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--destructive))" }}
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
                  {isDataProviderMock() ? "+8.2% vs mes anterior" : "Dados do Supabase"}
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
                <p className="text-sm text-muted-foreground">Total pago (acumulado)</p>
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
                  {lista.length > 0 && pagamentosPagos.length > 0
                    ? `${((pagamentosPagos.length / lista.length) * 100).toFixed(0)}%`
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
