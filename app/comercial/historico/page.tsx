"use client"

import { PageHeader } from "@/components/ui/page-header"
import { historicos, currentComercial } from "@/lib/services/mock-data.service"
import { Clock, Phone, MessageSquare, CheckCircle2, XCircle } from "lucide-react"

const iconMap: Record<string, React.ElementType> = {
  "Primeiro Contato": Phone,
  "Visita Agendada": Clock,
  "Proposta Enviada": MessageSquare,
  "Venda Fechada": CheckCircle2,
  "Lead Perdido": XCircle,
}

export default function HistoricoPage() {
  const meuHistorico = historicos.filter(
    (h) => h.comercialId === currentComercial.id
  )

  // Group by date
  const groupedByDate = meuHistorico.reduce(
    (acc, hist) => {
      const dateKey = hist.createdAt.toLocaleDateString("pt-BR")
      if (!acc[dateKey]) {
        acc[dateKey] = []
      }
      acc[dateKey].push(hist)
      return acc
    },
    {} as Record<string, typeof meuHistorico>
  )

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => {
    const dateA = new Date(a.split("/").reverse().join("-"))
    const dateB = new Date(b.split("/").reverse().join("-"))
    return dateB.getTime() - dateA.getTime()
  })

  return (
    <div>
      <PageHeader
        title="Histórico de Atendimento"
        description="Todas as suas interações com leads"
      />

      {sortedDates.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            Nenhum histórico de atendimento encontrado
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((date) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">
                {date}
              </h2>
              <div className="space-y-3">
                {groupedByDate[date].map((hist) => {
                  const Icon = iconMap[hist.acao] || MessageSquare
                  return (
                    <div
                      key={hist.id}
                      className="flex gap-4 p-4 rounded-xl border bg-card hover:border-primary/50 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-4 mb-1">
                          <h3 className="font-semibold text-foreground">
                            {hist.acao}
                          </h3>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {hist.createdAt.toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {hist.descricao}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Lead: #{hist.leadId}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
