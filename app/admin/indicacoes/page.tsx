"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { mockIndicacoes, mockIndicadores, mockComerciais } from "@/lib/mock-data"
import { Search, Eye, MoreHorizontal, UserPlus, RefreshCw } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu"
import Link from "next/link"

export default function AdminIndicacoesPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")

  const filteredIndicacoes = mockIndicacoes.filter(indicacao => {
    const matchesSearch = indicacao.nomeIndicado.toLowerCase().includes(search.toLowerCase()) ||
                         indicacao.telefoneIndicado.includes(search)
    const matchesStatus = statusFilter === "todos" || indicacao.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getIndicadorNome = (indicadorId: string) => {
    const indicador = mockIndicadores.find(i => i.id === indicadorId)
    return indicador?.nome || "Desconhecido"
  }

  const getComercialNome = (comercialId?: string) => {
    if (!comercialId) return "Não atribuído"
    const comercial = mockComerciais.find(c => c.id === comercialId)
    return comercial?.nome || "Desconhecido"
  }

  const columns = [
    {
      key: "indicado",
      header: "Indicado",
      render: (indicacao: typeof mockIndicacoes[0]) => (
        <div>
          <p className="font-medium">{indicacao.nomeIndicado}</p>
          <p className="text-sm text-muted-foreground">{indicacao.telefoneIndicado}</p>
        </div>
      ),
    },
    {
      key: "indicador",
      header: "Indicador",
      render: (indicacao: typeof mockIndicacoes[0]) => (
        <Link href={`/admin/indicadores/${indicacao.indicadorId}`} className="text-primary hover:underline">
          {getIndicadorNome(indicacao.indicadorId)}
        </Link>
      ),
    },
    {
      key: "comercial",
      header: "Comercial",
      render: (indicacao: typeof mockIndicacoes[0]) => (
        <span className={indicacao.comercialId ? "" : "text-muted-foreground"}>
          {getComercialNome(indicacao.comercialId)}
        </span>
      ),
    },
    {
      key: "plano",
      header: "Plano",
      render: (indicacao: typeof mockIndicacoes[0]) => (
        <span className="text-sm">{indicacao.planoInteresse || "Não informado"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (indicacao: typeof mockIndicacoes[0]) => (
        <StatusBadge status={indicacao.status} type="indicacao" />
      ),
    },
    {
      key: "data",
      header: "Data",
      render: (indicacao: typeof mockIndicacoes[0]) => (
        <span className="text-sm text-muted-foreground">
          {new Date(indicacao.dataIndicacao).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      render: (indicacao: typeof mockIndicacoes[0]) => (
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
                {mockComerciais.filter(c => c.disponivel).map(comercial => (
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
                <DropdownMenuItem>Nova</DropdownMenuItem>
                <DropdownMenuItem>Em Atendimento</DropdownMenuItem>
                <DropdownMenuItem>Convertida</DropdownMenuItem>
                <DropdownMenuItem>Perdida</DropdownMenuItem>
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
                  <SelectItem value="nova">Novas</SelectItem>
                  <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                  <SelectItem value="convertida">Convertidas</SelectItem>
                  <SelectItem value="perdida">Perdidas</SelectItem>
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
