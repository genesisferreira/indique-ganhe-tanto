"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { indicacoes, indicadores, comerciais, pagamentos } from "@/lib/mock-data"
import { Download, TrendingUp, Users, DollarSign, FileText, BarChart3, PieChart as PieChartIcon } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts"
import type { Indicacao, Indicador, Comercial, Pagamento } from "@/types"

export default function AdminRelatoriosPage() {
  const [periodo, setPeriodo] = useState("6meses")

  const monthlyData = [
    { mes: "Jan", indicacoes: 45, conversoes: 18, valor: 4500 },
    { mes: "Fev", indicacoes: 52, conversoes: 22, valor: 5500 },
    { mes: "Mar", indicacoes: 61, conversoes: 28, valor: 7000 },
    { mes: "Abr", indicacoes: 58, conversoes: 25, valor: 6250 },
    { mes: "Mai", indicacoes: 72, conversoes: 32, valor: 8000 },
    { mes: "Jun", indicacoes: 68, conversoes: 30, valor: 7500 },
  ]

  const statusData = [
    { name: "Pendente", value: indicacoes.filter((i: Indicacao) => i.status === "pendente").length, color: "#3b82f6" },
    { name: "Em Andamento", value: indicacoes.filter((i: Indicacao) => i.status === "em_andamento").length, color: "#f59e0b" },
    { name: "Aprovada", value: indicacoes.filter((i: Indicacao) => i.status === "aprovada").length, color: "#22c55e" },
    { name: "Recusada", value: indicacoes.filter((i: Indicacao) => i.status === "recusada").length, color: "#ef4444" },
  ]

  const comercialData = comerciais.map((c: Comercial) => ({
    nome: c.nome.split(" ")[0],
    conversoes: c.conversoes,
    leads: c.leadsAtribuidos,
    taxa: c.taxaConversao,
  })).sort((a: { conversoes: number }, b: { conversoes: number }) => b.conversoes - a.conversoes).slice(0, 5)

  const planoData = [
    { plano: "100 Mega", quantidade: 45, cor: "#3b82f6" },
    { plano: "200 Mega", quantidade: 62, cor: "#22c55e" },
    { plano: "300 Mega", quantidade: 38, cor: "#f59e0b" },
    { plano: "500 Mega", quantidade: 28, cor: "#8b5cf6" },
    { plano: "1 Giga", quantidade: 15, cor: "#ef4444" },
  ]

  const totalIndicacoes = indicacoes.length
  const totalConversoes = indicacoes.filter((i: Indicacao) => i.status === "aprovada").length
  const taxaGeral = totalIndicacoes > 0 ? ((totalConversoes / totalIndicacoes) * 100).toFixed(1) : "0"
  const totalPago = pagamentos.filter((p: Pagamento) => p.status === "pago").reduce((acc: number, p: Pagamento) => acc + p.valor, 0)

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
          trend={{ value: 12, isPositive: true }}
        />
        <StatCard
          title="Taxa de Conversão"
          value={`${taxaGeral}%`}
          icon={TrendingUp}
          trend={{ value: 5.2, isPositive: true }}
        />
        <StatCard
          title="Indicadores Ativos"
          value={indicadores.length}
          icon={Users}
        />
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
        </TabsContent>

        <TabsContent value="comerciais" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Ranking de Comerciais</CardTitle>
              <CardDescription>Desempenho da equipe comercial por conversões</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comercialData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis dataKey="nome" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} width={100} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar dataKey="conversoes" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Conversões" />
                  </BarChart>
                </ResponsiveContainer>
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
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(value) => `R$ ${value}`} />
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
