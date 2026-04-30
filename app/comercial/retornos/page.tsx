"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { leads, currentComercial } from "@/lib/mock-data"
import { Clock, Phone, Eye, Calendar, AlertTriangle } from "lucide-react"

export default function RetornosPage() {
  const meusLeads = leads.filter((l) => l.comercialId === currentComercial.id)
  const retornos = meusLeads
    .filter((l) => l.retornoAgendado)
    .sort((a, b) => {
      if (!a.retornoAgendado || !b.retornoAgendado) return 0
      return a.retornoAgendado.getTime() - b.retornoAgendado.getTime()
    })

  const hoje = new Date()
  const retornosHoje = retornos.filter((l) => {
    if (!l.retornoAgendado) return false
    return l.retornoAgendado.toDateString() === hoje.toDateString()
  })
  const retornosFuturos = retornos.filter((l) => {
    if (!l.retornoAgendado) return false
    return l.retornoAgendado > hoje
  })
  const retornosAtrasados = retornos.filter((l) => {
    if (!l.retornoAgendado) return false
    return l.retornoAgendado < hoje && l.retornoAgendado.toDateString() !== hoje.toDateString()
  })

  return (
    <div>
      <PageHeader
        title="Retornos Agendados"
        description="Gerencie seus retornos programados"
      />

      {/* Atrasados */}
      {retornosAtrasados.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <h2 className="text-lg font-semibold text-destructive">
              Atrasados ({retornosAtrasados.length})
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {retornosAtrasados.map((lead) => {
              const indicacao = lead.indicacao
              if (!indicacao) return null
              return (
              <div
                key={lead.id}
                className="rounded-xl border border-destructive/50 bg-destructive/5 p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive font-semibold">
                      {indicacao.nomeIndicado.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {indicacao.nomeIndicado}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {indicacao.plano?.nome || "Plano"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-destructive mb-4">
                  <Clock className="w-4 h-4" />
                  <span>
                    Era para {lead.retornoAgendado?.toLocaleDateString("pt-BR")} às{" "}
                    {lead.retornoAgendado?.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" className="flex-1">
                    <Phone className="w-4 h-4 mr-1" />
                    Ligar
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/comercial/leads/${lead.id}`}>
                      <Eye className="w-4 h-4" />
                    </Link>
                  </Button>
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Hoje */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Hoje ({retornosHoje.length})
          </h2>
        </div>
        {retornosHoje.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              Nenhum retorno agendado para hoje
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {retornosHoje.map((lead) => {
              const indicacao = lead.indicacao
              if (!indicacao) return null
              return (
              <div
                key={lead.id}
                className="rounded-xl border border-primary/50 bg-primary/5 p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      {indicacao.nomeIndicado.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {indicacao.nomeIndicado}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {indicacao.plano?.nome || "Plano"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={lead.status} />
                </div>

                <div className="flex items-center gap-2 text-sm text-primary mb-4">
                  <Clock className="w-4 h-4" />
                  <span>
                    Às{" "}
                    {lead.retornoAgendado?.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" className="flex-1">
                    <Phone className="w-4 h-4 mr-1" />
                    Ligar
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/comercial/leads/${lead.id}`}>
                      <Eye className="w-4 h-4" />
                    </Link>
                  </Button>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Futuros */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Próximos ({retornosFuturos.length})
          </h2>
        </div>
        {retornosFuturos.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              Nenhum retorno agendado para os próximos dias
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {retornosFuturos.map((lead) => {
              const indicacao = lead.indicacao
              if (!indicacao) return null
              return (
              <div key={lead.id} className="rounded-xl border bg-card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      {indicacao.nomeIndicado.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {indicacao.nomeIndicado}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {indicacao.plano?.nome || "Plano"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={lead.status} />
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <Clock className="w-4 h-4" />
                  <span>
                    {lead.retornoAgendado?.toLocaleDateString("pt-BR")} às{" "}
                    {lead.retornoAgendado?.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/comercial/leads/${lead.id}`}>
                    <Eye className="w-4 h-4 mr-1" />
                    Ver Detalhes
                  </Link>
                </Button>
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
