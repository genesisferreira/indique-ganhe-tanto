"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { leads, currentComercial } from "@/lib/mock-data"
import { Search, Filter, Eye, Phone, Clock } from "lucide-react"

const statusOptions = [
  { value: "all", label: "Todos os status" },
  { value: "novo", label: "Novo" },
  { value: "em_atendimento", label: "Em Atendimento" },
  { value: "sem_contato", label: "Sem Contato" },
  { value: "em_negociacao", label: "Em Negociação" },
  { value: "vendido", label: "Vendido" },
  { value: "perdido", label: "Perdido" },
]

export default function LeadsPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const meusLeads = leads.filter((l) => l.comercialId === currentComercial.id)

  const filteredLeads = meusLeads.filter((lead) => {
    const matchesSearch = lead.indicacao.nomeIndicado
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesStatus =
      statusFilter === "all" || lead.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div>
      <PageHeader
        title="Meus Leads"
        description="Gerencie seus leads de indicações"
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Leads Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredLeads.length === 0 ? (
          <div className="col-span-full rounded-xl border bg-card p-12 text-center">
            <p className="text-muted-foreground">Nenhum lead encontrado</p>
          </div>
        ) : (
          filteredLeads.map((lead) => (
            <div
              key={lead.id}
              className="rounded-xl border bg-card p-5 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-lg">
                    {lead.indicacao.nomeIndicado.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {lead.indicacao.nomeIndicado}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {lead.indicacao.plano.nome}
                    </p>
                  </div>
                </div>
                <StatusBadge status={lead.status} />
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span className="text-foreground">
                    {lead.indicacao.telefoneIndicado}
                  </span>
                </div>
                {lead.retornoAgendado && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-warning" />
                    <span className="text-warning">
                      Retorno:{" "}
                      {lead.retornoAgendado.toLocaleDateString("pt-BR")} às{" "}
                      {lead.retornoAgendado.toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground flex-1">
                  Indicado por: {lead.indicacao.indicador.nome}
                </p>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/comercial/leads/${lead.id}`}>
                    <Eye className="w-4 h-4 mr-1" />
                    Detalhes
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
