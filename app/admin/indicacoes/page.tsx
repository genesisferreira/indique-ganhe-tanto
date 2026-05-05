"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { indicacoes, indicadores, comerciais } from "@/lib/services/mock-data.service"
import { Search, Eye, MoreHorizontal, UserPlus, RefreshCw } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu"
import Link from "next/link"
import type { Indicacao, Indicador, Comercial } from "@/types"

export default function AdminIndicacoesPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")

  const filteredIndicacoes = indicacoes.filter((indicacao: Indicacao) => {
    const matchesSearch = indicacao.nomeIndicado.toLowerCase().includes(search.toLowerCase()) ||
                         indicacao.telefoneIndicado.includes(search)
    const matchesStatus = statusFilter === "todos" || indicacao.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getIndicadorNome = (indicadorId: string) => {
    const indicador = indicadores.find((i: Indicador) => i.id === indicadorId)
    return indicador?.nome || "Desconhecido"
  }

  const getComercialNome = (comercialId?: string) => {
    if (!comercialId) return "Não atribuído"
    const comercial = comerciais.find((c: Comercial) => c.id === comercialId)
    return comercial?.nome || "Desconhecido"
  }

  const columns = [
    {
      key: "indicado",
      header: "Indicado",
      cell: (indicacao: Indicacao) => (
        <div>
          <p className="font-medium">{indicacao.nomeIndicado}</p>
          <p className="text-sm text-muted-foreground">{indicacao.telefoneIndicado}</p>
        </div>
      ),
    },
    {
      key: "indicador",
      header: "Indicador",
      cell: (indicacao: Indicacao) => (
        <Link href={`/admin/indicadores/${indicacao.indicadorId}`} className="text-primary hover:underline">
          {getIndicadorNome(indicacao.indicadorId)}
        </Link>
      ),
    },
    {
      key: "comercial",
      header: "Comercial",
      cell: (indicacao: Indicacao) => (
        <span className={indicacao.comercialId ? "" : "text-muted-foreground"}>
          {getComercialNome(indicacao.comercialId)}
        </span>
      ),
    },
    {
      key: "plano",
      header: "Plano",
      cell: (indicacao: Indicacao) => (
        <span className="text-sm">{indicacao.plano?.nome || "Não informado"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (indicacao: Indicacao) => (
        <StatusBadge status={indicacao.status} />
      ),
    },
    {
      key: "data",
      header: "Data",
      cell: (indicacao: Indicacao) => (
        <span className="text-sm text-muted-foreground">
          {new Date(indicacao.createdAt).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      cell: (indicacao: Indicacao) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/indicacoes/${indicacao.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalhes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserPlus className="mr-2 h-4 w-4" />
                Atribuir Comercial
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {comerciais.filter((c: Comercial) => c.disponibilidade === 'disponivel').map((comercial: Comercial) => (
                  <DropdownMenuItem key={comercial.id}>
                    {comercial.nome}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <RefreshCw className="mr-2 h-4 w-4" />
                Alterar Status
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Pendente</DropdownMenuItem>
                <DropdownMenuItem>Em Andamento</DropdownMenuItem>
                <DropdownMenuItem>Aprovada</DropdownMenuItem>
                <DropdownMenuItem>Recusada</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Todas as Indicações"
        description="Visualize e gerencie todas as indicações do sistema"
      />

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Lista de Indicações</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou telefone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[300px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendente">Pendentes</SelectItem>
                  <SelectItem value="em_andamento">Em Andamento</SelectItem>
                  <SelectItem value="aprovada">Aprovadas</SelectItem>
                  <SelectItem value="recusada">Recusadas</SelectItem>
                  <SelectItem value="paga">Pagas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={filteredIndicacoes}
            columns={columns}
            emptyMessage="Nenhuma indicação encontrada"
          />
        </CardContent>
      </Card>
    </div>
  )
}
