"use client"

import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { currentComercial, dashboardComercial } from "@/lib/mock-data"
import {
  ShoppingCart,
  UserX,
  Clock,
  Target,
  TrendingUp,
  Award,
} from "lucide-react"

export default function DesempenhoPage() {
  const taxaConversao = (
    (dashboardComercial.vendasRealizadas /
      (dashboardComercial.vendasRealizadas + dashboardComercial.leadsPerdidos)) *
    100
  ).toFixed(1)

  return (
    <div>
      <PageHeader
        title="Meu Desempenho"
        description="Acompanhe suas métricas e resultados"
      />

      {/* Main Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Vendas Realizadas"
          value={dashboardComercial.vendasRealizadas}
          icon={ShoppingCart}
          variant="success"
          trend={{ value: 15, label: "este mês" }}
        />
        <StatCard
          title="Taxa de Conversão"
          value={`${taxaConversao}%`}
          icon={Target}
          variant="primary"
        />
        <StatCard
          title="Tempo Médio 1º Contato"
          value={dashboardComercial.tempoMedioPrimeiroContato}
          icon={Clock}
        />
        <StatCard
          title="Leads Perdidos"
          value={dashboardComercial.leadsPerdidos}
          icon={UserX}
          variant="destructive"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Performance Summary */}
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-primary" />
            Resumo de Performance
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
              <div>
                <p className="text-sm text-muted-foreground">
                  Total de Leads Atribuídos
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {dashboardComercial.vendasRealizadas +
                    dashboardComercial.leadsPerdidos +
                    currentComercial.leadsAtivos}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                <p className="text-sm text-muted-foreground">Convertidos</p>
                <p className="text-xl font-bold text-success">
                  {dashboardComercial.vendasRealizadas}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-muted-foreground">Perdidos</p>
                <p className="text-xl font-bold text-destructive">
                  {dashboardComercial.leadsPerdidos}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Monthly Progress */}
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Progresso Mensal
          </h2>
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  Meta de Vendas
                </span>
                <span className="text-sm font-medium text-foreground">
                  87/100
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: "87%" }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  Tempo Médio (Meta: 10 min)
                </span>
                <span className="text-sm font-medium text-success">
                  8 min
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-success rounded-full transition-all"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  Taxa de Conversão (Meta: 80%)
                </span>
                <span className="text-sm font-medium text-primary">
                  {taxaConversao}%
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${taxaConversao}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="mt-6 p-4 rounded-xl bg-primary/10 border border-primary/20">
        <h3 className="font-semibold text-foreground mb-2">
          Dicas para melhorar seu desempenho
        </h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>- Entre em contato com novos leads em até 10 minutos</li>
          <li>- Agende retornos para não perder oportunidades</li>
          <li>- Registre todas as interações no histórico</li>
          <li>- Mantenha-se disponível durante horário comercial</li>
        </ul>
      </div>
    </div>
  )
}
