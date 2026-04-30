"use client"

import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { mockIndicacoes, mockIndicadores, mockComerciais, mockPagamentos } from "@/lib/mock-data"
import { Users, UserCheck, DollarSign, TrendingUp, FileText, Clock, CheckCircle, XCircle } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts"

export default function AdminDashboard() {
  const totalIndicadores = mockIndicadores.length
  const indicadoresAtivos = mockIndicadores.filter(i => i.status === "ativo").length
  const totalComerciais = mockComerciais.length
  const comerciaisDisponiveis = mockComerciais.filter(c => c.disponivel).length
  
  const totalIndicacoes = mockIndicacoes.length
  const indicacoesConvertidas = mockIndicacoes.filter(i => i.status === "convertida").length
  const taxaConversao = ((indicacoesConvertidas / totalIndicacoes) * 100).toFixed(1)
  
  const pagamentosPendentes = mockPagamentos.filter(p => p.status === "pendente")
  const totalPendente = pagamentosPendentes.reduce((acc, p) => acc + p.valor, 0)
  const totalPago = mockPagamentos.filter(p => p.status === "pago").reduce((acc, p) => acc + p.valor, 0)

  const statusData = [
    { name: "Nova", value: mockIndicacoes.filter(i => i.status === "nova").length, color: "#3b82f6" },
    { name: "Em Atend.", value: mockIndicacoes.filter(i => i.status === "em_atendimento").length, color: "#f59e0b" },
    { name: "Convertida", value: mockIndicacoes.filter(i => i.status === "convertida").length, color: "#22c55e" },
    { name: "Perdida", value: mockIndicacoes.filter(i => i.status === "perdida").length, color: "#ef4444" },
  ]

  const monthlyData = [
    { mes: "Jan", indicacoes: 45, conversoes: 18 },
    { mes: "Fev", indicacoes: 52, conversoes: 22 },
    { mes: "Mar", indicacoes: 61, conversoes: 28 },
    { mes: "Abr", indicacoes: 58, conversoes: 25 },
    { mes: "Mai", indicacoes: 72, conversoes: 32 },
    { mes: "Jun", indicacoes: 68, conversoes: 30 },
  ]

  const topIndicadores = mockIndicadores
    .sort((a, b) => b.indicacoesConvertidas - a.indicacoesConvertidas)
    .slice(0, 5)
    .map(i => ({
      nome: i.nome.split(" ")[0],
      conversoes: i.indicacoesConvertidas,
      total: i.totalIndicacoes,
    }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Administrativo"
        description="Visão geral completa do sistema de indicações"
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
          title="Taxa de Conversão"
          value={`${taxaConversao}%`}
          subtitle={`${indicacoesConvertidas} de ${totalIndicacoes}`}
          icon={TrendingUp}
          trend={{ value: 5.2, isPositive: true }}
        />
        <StatCard
          title="Pagamentos Pendentes"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          subtitle={`${pagamentosPendentes.length} solicitações`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Total Pago"
          value={`R$ ${totalPago.toLocaleString("pt-BR")}`}
          subtitle="Neste mês"
          icon={DollarSign}
          variant="success"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Indicações por Mês</CardTitle>
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
                    name="Indicações"
                  />
                  <Line
                    type="monotone"
                    dataKey="conversoes"
                    stroke="hsl(var(--success))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--success))" }}
                    name="Conversões"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Status das Indicações</CardTitle>
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
                  <Bar dataKey="conversoes" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Conversões" />
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
                  <p className="text-sm text-muted-foreground">{comerciaisDisponiveis} disponíveis</p>
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
                  <p className="font-medium">Conversões Hoje</p>
                  <p className="text-sm text-muted-foreground">Meta: 10</p>
                </div>
              </div>
              <span className="text-2xl font-bold">7</span>
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
              <span className="text-2xl font-bold">{mockIndicacoes.filter(i => i.status === "nova").length}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
