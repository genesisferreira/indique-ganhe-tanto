"use client"

import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { currentComercial, dashboardComercial, leads } from "@/lib/services/mock-data.service"
import {
  getAuthProfileBasicsFromSupabase,
  loadComercialLeadsFromSupabase,
} from "@/lib/services/supabase-data.service"
import type { DashboardComercial } from "@/types/dashboard"
import type { Lead } from "@/types/lead"
import {
  ShoppingCart,
  UserX,
  Clock,
  Target,
  TrendingUp,
  Award,
} from "lucide-react"

function dashboardFromAssignedLeads(assigned: Lead[]): DashboardComercial {
  const counts = {
    leadsNovos: 0,
    leadsEmAtendimento: 0,
    leadsSemContato: 0,
    leadsEmNegociacao: 0,
    vendasRealizadas: 0,
    leadsPerdidos: 0,
  }
  const diffMins: number[] = []
  for (const l of assigned) {
    switch (l.status) {
      case "novo":
        counts.leadsNovos += 1
        break
      case "em_atendimento":
      case "redistribuido":
        counts.leadsEmAtendimento += 1
        break
      case "sem_contato":
        counts.leadsSemContato += 1
        break
      case "em_negociacao":
        counts.leadsEmNegociacao += 1
        break
      case "vendido":
        counts.vendasRealizadas += 1
        break
      case "perdido":
        counts.leadsPerdidos += 1
        break
      default:
        break
    }
    if (l.primeiroContato) {
      const ms = l.primeiroContato.getTime() - l.createdAt.getTime()
      if (ms >= 0) diffMins.push(ms / 60000)
    }
  }
  let tempo: string = "N/D"
  if (diffMins.length > 0) {
    const avg = diffMins.reduce((a, b) => a + b, 0) / diffMins.length
    tempo = `${Math.max(0, Math.round(avg))} min`
  }
  return {
    ...counts,
    tempoMedioPrimeiroContato: tempo,
  }
}

export default function DesempenhoPage() {
  const mockAssigned = useMemo(
    () =>
      isDataProviderMock()
        ? leads.filter((l) => l.comercialId === currentComercial.id)
        : [],
    []
  )

  const [assigned, setAssigned] = useState<Lead[]>(mockAssigned)

  useEffect(() => {
    if (isDataProviderMock()) {
      setAssigned(mockAssigned)
      return
    }
    void (async () => {
      const [all, basics] = await Promise.all([
        loadComercialLeadsFromSupabase(),
        getAuthProfileBasicsFromSupabase(),
      ])
      if (!all.ok) {
        console.error("[commercial-leads:error]", all.error, all.meta)
      }
      const uid = basics?.id ?? null
      const rows = all.ok ? all.data : []
      setAssigned(uid ? rows.filter((l) => l.comercialId === uid) : [])
    })()
  }, [mockAssigned])

  const d = isDataProviderMock()
    ? dashboardComercial
    : dashboardFromAssignedLeads(assigned)

  const leadsAtivosCount = isDataProviderMock()
    ? currentComercial.leadsAtivos
    : assigned.filter((l) => l.status !== "vendido" && l.status !== "perdido").length

  const totalEncerradosOuAbertos = d.vendasRealizadas + d.leadsPerdidos + leadsAtivosCount
  const taxaConversao =
    d.vendasRealizadas + d.leadsPerdidos > 0
      ? ((d.vendasRealizadas / (d.vendasRealizadas + d.leadsPerdidos)) * 100).toFixed(1)
      : "0"

  const metaVendasPct = Math.min(100, d.vendasRealizadas)
  const tempoMetaPct =
    d.tempoMedioPrimeiroContato === "N/D"
      ? 0
      : Math.min(
          100,
          (() => {
            const m = /^(\d+)/.exec(d.tempoMedioPrimeiroContato)
            const n = m ? Number(m[1]) : 0
            if (!Number.isFinite(n) || n <= 0) return 0
            return Math.round((10 / n) * 100)
          })()
        )
  const taxaBar = Math.min(100, Number(taxaConversao) || 0)

  return (
    <div>
      <PageHeader
        title="Meu Desempenho"
        description="Acompanhe suas métricas e resultados"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Vendas Realizadas"
          value={d.vendasRealizadas}
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
          value={d.tempoMedioPrimeiroContato}
          icon={Clock}
        />
        <StatCard
          title="Leads Perdidos"
          value={d.leadsPerdidos}
          icon={UserX}
          variant="destructive"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
                  {isDataProviderMock()
                    ? d.vendasRealizadas + d.leadsPerdidos + currentComercial.leadsAtivos
                    : totalEncerradosOuAbertos}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                <p className="text-sm text-muted-foreground">Convertidos</p>
                <p className="text-xl font-bold text-success">
                  {d.vendasRealizadas}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-muted-foreground">Perdidos</p>
                <p className="text-xl font-bold text-destructive">
                  {d.leadsPerdidos}
                </p>
              </div>
            </div>
          </div>
        </div>

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
                  {d.vendasRealizadas}/100
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${metaVendasPct}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  Tempo Médio (Meta: 10 min)
                </span>
                <span className="text-sm font-medium text-success">
                  {d.tempoMedioPrimeiroContato}
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-success rounded-full transition-all"
                  style={{ width: `${tempoMetaPct}%` }}
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
                  style={{ width: `${taxaBar}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

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
