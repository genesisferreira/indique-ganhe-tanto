"use client"

import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  indicacoes as mockIndicacoes,
  indicadores as mockIndicadores,
  comerciais as mockComerciais,
  pagamentos as mockPagamentos,
} from "@/lib/services/mock-data.service"
import {
  loadAdminAllPaymentsFromSupabase,
  loadAdminComerciaisFromSupabase,
  loadAdminIndicatorsFromSupabase,
  loadAdminReferralsFromSupabase,
} from "@/lib/services/supabase-data.service"
import { Download, TrendingUp, Users, DollarSign, FileText, BarChart3, PieChart as PieChartIcon } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts"
import type { Indicacao, Indicador, Comercial, Pagamento } from "@/types"

const MOCK_REPORT_MONTHLY = [
  { mes: "Jan", indicacoes: 45, conversoes: 18, valor: 4500 },
  { mes: "Fev", indicacoes: 52, conversoes: 22, valor: 5500 },
  { mes: "Mar", indicacoes: 61, conversoes: 28, valor: 7000 },
  { mes: "Abr", indicacoes: 58, conversoes: 25, valor: 6250 },
  { mes: "Mai", indicacoes: 72, conversoes: 32, valor: 8000 },
  { mes: "Jun", indicacoes: 68, conversoes: 30, valor: 7500 },
]

const MOCK_PLANO_DATA = [
  { plano: "100 Mega", quantidade: 45, cor: "#3b82f6" },
  { plano: "200 Mega", quantidade: 62, cor: "#22c55e" },
  { plano: "300 Mega", quantidade: 38, cor: "#f59e0b" },
  { plano: "500 Mega", quantidade: 28, cor: "#8b5cf6" },
  { plano: "1 Giga", quantidade: 15, cor: "#ef4444" },
]

const PLANO_CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899"]

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function monthKeyPt(d: Date): string {
  return d.toLocaleString("pt-BR", { month: "short", year: "2-digit" })
}

function lastSixMonthKeys(): string[] {
  const now = new Date()
  const keys: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(monthKeyPt(d))
  }
  return keys
}

function buildMonthlySeries(
  indicacoes: Indicacao[],
  pagamentos: Pagamento[]
): { mes: string; indicacoes: number; conversoes: number; valor: number }[] {
  const keys = lastSixMonthKeys()
  const indBy = new Map(keys.map((k) => [k, { ind: 0, conv: 0 }]))
  const valBy = new Map(keys.map((k) => [k, 0]))

  for (const i of indicacoes) {
    const k = monthKeyPt(new Date(i.createdAt))
    if (!indBy.has(k)) continue
    const cur = indBy.get(k)!
    cur.ind += 1
    indBy.set(k, cur)
  }
  for (const i of indicacoes) {
    if (i.status !== "aprovada" && i.status !== "paga") continue
    const d = i.updatedAt ?? i.createdAt
    const k = monthKeyPt(new Date(d))
    if (!indBy.has(k)) continue
    const cur = indBy.get(k)!
    cur.conv += 1
    indBy.set(k, cur)
  }
  for (const p of pagamentos) {
    if (p.status !== "pago") continue
    const d = p.dataPagamento ?? p.updatedAt ?? p.createdAt
    const k = monthKeyPt(new Date(d))
    if (!valBy.has(k)) continue
    valBy.set(k, (valBy.get(k) ?? 0) + p.valor)
  }

  return keys.map((mes) => {
    const r = indBy.get(mes) ?? { ind: 0, conv: 0 }
    return {
      mes,
      indicacoes: r.ind,
      conversoes: r.conv,
      valor: valBy.get(mes) ?? 0,
    }
  })
}

function statusPieFromIndicacoes(indicacoes: Indicacao[]) {
  const rows = [
    {
      name: "Pendente",
      value: indicacoes.filter((i) => i.status === "pendente").length,
      color: "#3b82f6",
    },
    {
      name: "Em andamento",
      value: indicacoes.filter((i) =>
        ["em_andamento", "em_atendimento", "em_negociacao"].includes(i.status)
      ).length,
      color: "#f59e0b",
    },
    {
      name: "Aprovada / Paga",
      value: indicacoes.filter((i) => i.status === "aprovada" || i.status === "paga").length,
      color: "#22c55e",
    },
    {
      name: "Recusada",
      value: indicacoes.filter((i) => i.status === "recusada").length,
      color: "#ef4444",
    },
  ]
  return rows.filter((r) => r.value > 0)
}

function comercialRanking(comerciais: Comercial[]) {
  return comerciais
    .map((c) => ({
      nome: c.nome.split(" ")[0] ?? c.nome,
      conversoes: c.vendasRealizadas,
      leads: c.leadsAtivos,
      taxa:
        c.leadsAtivos > 0
          ? Number(((c.vendasRealizadas / c.leadsAtivos) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.conversoes - a.conversoes)
    .slice(0, 5)
}

function planoDistribuicao(indicacoes: Indicacao[]) {
  const map = new Map<string, number>()
  for (const i of indicacoes) {
    const label = i.plano?.nome?.trim() || "Sem plano"
    map.set(label, (map.get(label) ?? 0) + 1)
  }
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  return entries.map(([plano, quantidade], idx) => ({
    plano,
    quantidade,
    cor: PLANO_CHART_COLORS[idx % PLANO_CHART_COLORS.length],
  }))
}

export default function AdminRelatoriosPage() {
  const isMock = isDataProviderMock()
  const [periodo, setPeriodo] = useState("6meses")
  const [indicacoesS, setIndicacoesS] = useState<Indicacao[]>([])
  const [indicadoresS, setIndicadoresS] = useState<Indicador[]>([])
  const [comerciaisS, setComerciaisS] = useState<Comercial[]>([])
  const [pagamentosS, setPagamentosS] = useState<Pagamento[]>([])

  useEffect(() => {
    if (isMock) return
    void (async () => {
      const [a, b, c, d] = await Promise.all([
        loadAdminReferralsFromSupabase(),
        loadAdminIndicatorsFromSupabase(),
        loadAdminComerciaisFromSupabase(),
        loadAdminAllPaymentsFromSupabase(),
      ])
      setIndicacoesS(a ?? [])
      setIndicadoresS(b ?? [])
      setComerciaisS(c ?? [])
      setPagamentosS(d ?? [])
      if (isDev()) {
        const anyNull = a === null || b === null || c === null || d === null
        console.log("[supabase-query:debug]", {
          query: "admin-relatorios-bundle",
          referrals: a?.length ?? "null",
          indicators: b?.length ?? "null",
          commercials: c?.length ?? "null",
          payments: d?.length ?? "null",
        })
        if (anyNull) {
          console.warn("[flow-check:debug]", {
            flow: "admin-relatorios",
            ok: false,
            note: "Alguma consulta retornou null — usando listas vazias onde aplicável",
          })
        } else {
          console.log("[flow-check:debug]", { flow: "admin-relatorios", ok: true })
        }
      }
    })()
  }, [isMock])

  const indicacoes = isMock ? mockIndicacoes : indicacoesS
  const indicadores = isMock ? mockIndicadores : indicadoresS
  const comerciais = isMock ? mockComerciais : comerciaisS
  const pagamentos = isMock ? mockPagamentos : pagamentosS

  const monthlyData = useMemo(() => {
    if (isMock) return MOCK_REPORT_MONTHLY
    return buildMonthlySeries(indicacoes, pagamentos)
  }, [isMock, indicacoes, pagamentos])

  const statusData = useMemo(() => {
    if (isMock) {
      return [
        {
          name: "Pendente",
          value: indicacoes.filter((i: Indicacao) => i.status === "pendente").length,
          color: "#3b82f6",
        },
        {
          name: "Em Andamento",
          value: indicacoes.filter((i: Indicacao) => i.status === "em_andamento").length,
          color: "#f59e0b",
        },
        {
          name: "Aprovada",
          value: indicacoes.filter((i: Indicacao) => i.status === "aprovada").length,
          color: "#22c55e",
        },
        {
          name: "Recusada",
          value: indicacoes.filter((i: Indicacao) => i.status === "recusada").length,
          color: "#ef4444",
        },
      ].filter((r) => r.value > 0)
    }
    return statusPieFromIndicacoes(indicacoes)
  }, [isMock, indicacoes])

  const comercialData = useMemo(() => {
    if (isMock) {
      return comerciais
        .map((c: Comercial) => ({
          nome: c.nome.split(" ")[0],
          conversoes: c.vendasRealizadas,
          leads: c.leadsAtivos,
          taxa:
            c.leadsAtivos > 0
              ? Number(((c.vendasRealizadas / c.leadsAtivos) * 100).toFixed(1))
              : 0,
        }))
        .sort((a: { conversoes: number }, b: { conversoes: number }) => b.conversoes - a.conversoes)
        .slice(0, 5)
    }
    return comercialRanking(comerciais)
  }, [isMock, comerciais])

  const planoData = useMemo(() => {
    if (isMock) return MOCK_PLANO_DATA
    const derived = planoDistribuicao(indicacoes)
    return derived.length > 0 ? derived : []
  }, [isMock, indicacoes])

  const totalIndicacoes = indicacoes.length
  const totalConversoes = indicacoes.filter((i: Indicacao) =>
    ["aprovada", "paga"].includes(i.status)
  ).length
  const taxaGeral =
    totalIndicacoes > 0 ? ((totalConversoes / totalIndicacoes) * 100).toFixed(1) : "0"
  const totalPago = pagamentos
    .filter((p: Pagamento) => p.status === "pago")
    .reduce((acc: number, p: Pagamento) => acc + p.valor, 0)

  const trendProps = isMock
    ? ({ trend: { value: 12, isPositive: true } } as const)
    : ({} as const)
  const trendPropsTaxa = isMock
    ? ({ trend: { value: 5.2, isPositive: true } } as const)
    : ({} as const)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title="Relatórios"
          description="Análises e métricas detalhadas do sistema"
        />
        <div className="flex items-center gap-2">
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7dias">Últimos 7 dias</SelectItem>
              <SelectItem value="30dias">Últimos 30 dias</SelectItem>
              <SelectItem value="3meses">Últimos 3 meses</SelectItem>
              <SelectItem value="6meses">Últimos 6 meses</SelectItem>
              <SelectItem value="1ano">Último ano</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total de Indicações"
          value={totalIndicacoes}
          icon={FileText}
          {...trendProps}
        />
        <StatCard
          title="Taxa de Conversão"
          value={`${taxaGeral}%`}
          icon={TrendingUp}
          {...trendPropsTaxa}
        />
        <StatCard title="Indicadores Ativos" value={indicadores.length} icon={Users} />
        <StatCard
          title="Total Pago"
          value={`R$ ${totalPago.toLocaleString("pt-BR")}`}
          icon={DollarSign}
          variant="success"
        />
      </div>

      <Tabs defaultValue="visao-geral" className="space-y-6">
        <TabsList>
          <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="comerciais">Desempenho Comerciais</TabsTrigger>
          <TabsTrigger value="planos">Planos</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Indicações vs Conversões
                </CardTitle>
                <CardDescription>Evolução mensal de indicações e conversões</CardDescription>
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
                      />
                      <Bar dataKey="indicacoes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Indicações" />
                      <Bar dataKey="conversoes" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Conversões" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5" />
                  Status das Indicações
                </CardTitle>
                <CardDescription>Distribuição por status atual</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  {statusData.length > 0 ? (
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
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Sem dados de status no período
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="comerciais" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Ranking de Comerciais</CardTitle>
              <CardDescription>Desempenho da equipe comercial por conversões</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                {comercialData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comercialData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis
                        dataKey="nome"
                        type="category"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        width={100}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar
                        dataKey="conversoes"
                        fill="hsl(var(--primary))"
                        radius={[0, 4, 4, 0]}
                        name="Conversões"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Nenhum dado comercial para exibir
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="planos" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Indicações por Plano</CardTitle>
              <CardDescription>Distribuição de interesse por plano</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                {planoData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={planoData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="plano" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar dataKey="quantidade" radius={[4, 4, 0, 0]} name="Quantidade">
                        {planoData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.cor} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Sem indicações com plano associado
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financeiro" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Evolução de Pagamentos</CardTitle>
              <CardDescription>Valores pagos aos indicadores ao longo do tempo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickFormatter={(value) => `R$ ${value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => [`R$ ${value.toLocaleString("pt-BR")}`, "Valor Pago"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="valor"
                      stroke="hsl(var(--success))"
                      fill="hsl(var(--success) / 0.2)"
                      name="Valor Pago"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
