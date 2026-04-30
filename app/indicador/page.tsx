"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Wallet,
  TrendingUp,
  Receipt,
  Plus,
  ArrowRight,
} from "lucide-react"
import {
  dashboardIndicador,
  indicacoes,
  currentIndicador,
} from "@/lib/mock-data"

const recentIndicacoes = indicacoes
  .filter((i) => i.indicadorId === currentIndicador.id)
  .slice(0, 5)

export default function IndicadorDashboard() {
  return (
    <div>
      <PageHeader
        title={`Olá, ${currentIndicador.nome.split(" ")[0]}!`}
        description="Acompanhe suas indicações e ganhos"
      >
        <Button asChild>
          <Link href="/indicador/nova-indicacao">
            <Plus className="w-4 h-4 mr-2" />
            Nova Indicação
          </Link>
        </Button>
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Total de Indicações"
          value={dashboardIndicador.totalIndicacoes}
          icon={Users}
          trend={{ value: 12, label: "este mês" }}
        />
        <StatCard
          title="Em Andamento"
          value={dashboardIndicador.emAndamento}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Aprovadas"
          value={dashboardIndicador.aprovadas}
          icon={CheckCircle2}
          variant="success"
        />
        <StatCard
          title="Recusadas"
          value={dashboardIndicador.recusadas}
          icon={XCircle}
          variant="destructive"
        />
      </div>

      {/* Financial Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Total Recebido"
          value={`R$ ${dashboardIndicador.totalRecebido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={Wallet}
          variant="primary"
        />
        <StatCard
          title="Total a Receber"
          value={`R$ ${dashboardIndicador.totalAReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={TrendingUp}
        />
        <StatCard
          title="Saldo Disponível"
          value={`R$ ${dashboardIndicador.saldoDisponivel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={Receipt}
          variant="success"
        />
        <StatCard
          title="Saldo em Desconto"
          value={`R$ ${dashboardIndicador.saldoEmDesconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={Receipt}
        />
      </div>

      {/* Recent Indicacoes */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Indicações Recentes
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/indicador/indicacoes">
              Ver todas
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
        <div className="space-y-3">
          {recentIndicacoes.map((indicacao) => (
            <Link
              key={indicacao.id}
              href={`/indicador/indicacoes/${indicacao.id}`}
              className="flex items-center justify-between p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                  {indicacao.nomeIndicado.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {indicacao.nomeIndicado}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {indicacao.plano.nome} - R${" "}
                    {indicacao.valorRecompensa.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <StatusBadge status={indicacao.status} />
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
