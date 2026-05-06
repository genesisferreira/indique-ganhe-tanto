"use client"

import { useEffect, useMemo, useState } from "react"
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
import { indicacoes, currentIndicador } from "@/lib/services/mock-data.service"
import { loadIndicadorReferralsListFromSupabase } from "@/lib/services/supabase-data.service"
import { Plus, Search, Eye, Filter } from "lucide-react"
import type { Indicacao, IndicacaoStatus } from "@/types"

const statusOptions = [
  { value: "all", label: "Todos os status" },
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em Andamento" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
  { value: "paga", label: "Paga" },
]

export default function MinhasIndicacoesPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const mockIndicacoes = useMemo(
    () =>
      indicacoes.filter((i) => i.indicadorId === currentIndicador.id),
    []
  )

  const [listaIndicacoes, setListaIndicacoes] =
    useState<Indicacao[]>(mockIndicacoes)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await loadIndicadorReferralsListFromSupabase()
      if (cancelled || remote === null) return
      setListaIndicacoes(remote)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredIndicacoes = listaIndicacoes.filter((indicacao) => {
    const matchesSearch = indicacao.nomeIndicado
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesStatus =
      statusFilter === "all" || indicacao.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div>
      <PageHeader
        title="Minhas Indicações"
        description="Acompanhe todas as suas indicações"
      >
        <Button asChild>
          <Link href="/indicador/nova-indicacao">
            <Plus className="w-4 h-4 mr-2" />
            Nova Indicação
          </Link>
        </Button>
      </PageHeader>

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

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Indicado
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Plano
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recompensa
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tipo
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Data
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredIndicacoes.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Nenhuma indicação encontrada
                  </td>
                </tr>
              ) : (
                filteredIndicacoes.map((indicacao) => (
                  <tr
                    key={indicacao.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                          {indicacao.nomeIndicado.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">
                            {indicacao.nomeIndicado}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {indicacao.telefoneIndicado}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">
                        {indicacao.plano?.nome || "Plano"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {indicacao.plano?.velocidade || "-"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      R${" "}
                      {indicacao.valorRecompensa.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground capitalize">
                      {indicacao.tipoRecompensa === "pix"
                        ? "Pix"
                        : "Desconto"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={indicacao.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {indicacao.createdAt.toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/indicador/indicacoes/${indicacao.id}`}>
                          <Eye className="w-4 h-4" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
