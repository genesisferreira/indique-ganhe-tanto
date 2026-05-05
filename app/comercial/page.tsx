"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Users,
  UserCheck,
  AlertTriangle,
  Handshake,
  ShoppingCart,
  UserX,
  Clock,
  ArrowRight,
  Phone,
} from "lucide-react"
import { dashboardComercial, leads, currentComercial } from "@/lib/services/mock-data.service"

const meusLeads = leads.filter((l) => l.comercialId === currentComercial.id)
const leadsAtivos = meusLeads.filter(
  (l) => l.status !== "vendido" && l.status !== "perdido"
)

export default function ComercialDashboard() {
  return (
    <div>
      <PageHeader
        title={`Olá, ${currentComercial.nome.split(" ")[0]}!`}
        description="Gerencie seus leads e acompanhe seu desempenho"
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-sm font-medium text-success">Disponível</span>
        </div>
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Leads Novos"
          value={dashboardComercial.leadsNovos}
          icon={Users}
          variant="primary"
        />
        <StatCard
          title="Em Atendimento"
          value={dashboardComercial.leadsEmAtendimento}
          icon={UserCheck}
        />
        <StatCard
          title="Sem Contato"
          value={dashboardComercial.leadsSemContato}
          icon={AlertTriangle}
          variant="warning"
        />
        <StatCard
          title="Em Negociação"
          value={dashboardComercial.leadsEmNegociacao}
          icon={Handshake}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        <StatCard
          title="Vendas Realizadas"
          value={dashboardComercial.vendasRealizadas}
          icon={ShoppingCart}
          variant="success"
        />
        <StatCard
          title="Leads Perdidos"
          value={dashboardComercial.leadsPerdidos}
          icon={UserX}
          variant="destructive"
        />
        <StatCard
          title="Tempo Médio 1º Contato"
          value={dashboardComercial.tempoMedioPrimeiroContato}
          icon={Clock}
        />
      </div>

      {/* Active Leads */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Leads Ativos
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/comercial/leads">
              Ver todos
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>

        <div className="space-y-3">
          {leadsAtivos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum lead ativo no momento
            </div>
          ) : (
            leadsAtivos.slice(0, 5).map((lead) => {
              const indicacao = lead.indicacao
              if (!indicacao) return null
              return (
              <Link
                key={lead.id}
                href={`/comercial/leads/${lead.id}`}
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
                      {indicacao.telefoneIndicado} -{" "}
                      {indicacao.plano?.nome || "Plano"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <StatusBadge status={lead.status} />
                  <Button variant="ghost" size="icon" asChild>
                    <span>
                      <Phone className="w-4 h-4" />
                    </span>
                  </Button>
                </div>
              </Link>
              )
            })
          )}
        </div>
      </div>

      {/* Alert for leads without contact */}
      {dashboardComercial.leadsSemContato > 0 && (
        <div className="mt-6 p-4 rounded-xl bg-warning/10 border border-warning/20 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
          <div>
            <p className="font-medium text-foreground">Atenção!</p>
            <p className="text-sm text-muted-foreground">
              Você tem {dashboardComercial.leadsSemContato} lead(s) sem contato.
              Entre em contato em até 15 minutos para evitar redistribuição.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
