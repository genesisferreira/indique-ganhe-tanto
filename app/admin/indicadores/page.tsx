"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { mockIndicadores } from "@/lib/mock-data"
import { Plus, Search, Eye, Edit, Ban, CheckCircle, MoreHorizontal } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Link from "next/link"

export default function AdminIndicadoresPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const filteredIndicadores = mockIndicadores.filter(indicador => {
    const matchesSearch = indicador.nome.toLowerCase().includes(search.toLowerCase()) ||
                         indicador.email.toLowerCase().includes(search.toLowerCase()) ||
                         indicador.cpf.includes(search)
    const matchesStatus = statusFilter === "todos" || indicador.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const columns = [
    {
      key: "nome",
      header: "Nome",
      render: (indicador: typeof mockIndicadores[0]) => (
        <div>
          <p className="font-medium">{indicador.nome}</p>
          <p className="text-sm text-muted-foreground">{indicador.email}</p>
        </div>
      ),
    },
    {
      key: "cpf",
      header: "CPF",
      render: (indicador: typeof mockIndicadores[0]) => (
        <span className="font-mono text-sm">{indicador.cpf}</span>
      ),
    },
    {
      key: "indicacoes",
      header: "Indicações",
      render: (indicador: typeof mockIndicadores[0]) => (
        <div className="text-center">
          <p className="font-semibold">{indicador.totalIndicacoes}</p>
          <p className="text-xs text-muted-foreground">{indicador.indicacoesConvertidas} convertidas</p>
        </div>
      ),
    },
    {
      key: "saldo",
      header: "Saldo",
      render: (indicador: typeof mockIndicadores[0]) => (
        <span className="font-semibold text-success">
          R$ {indicador.saldoDisponivel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (indicador: typeof mockIndicadores[0]) => (
        <StatusBadge status={indicador.status} type="indicador" />
      ),
    },
    {
      key: "dataCadastro",
      header: "Cadastro",
      render: (indicador: typeof mockIndicadores[0]) => (
        <span className="text-sm text-muted-foreground">
          {new Date(indicador.dataCadastro).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      render: (indicador: typeof mockIndicadores[0]) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/indicadores/${indicador.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalhes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Edit className="mr-2 h-4 w-4" />
              Editar
            </DropdownMenuItem>
            {indicador.status === "ativo" ? (
              <DropdownMenuItem className="text-destructive">
                <Ban className="mr-2 h-4 w-4" />
                Bloquear
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="text-success">
                <CheckCircle className="mr-2 h-4 w-4" />
                Ativar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gerenciar Indicadores"
        description="Visualize e gerencie todos os indicadores cadastrados"
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Novo Indicador
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Cadastrar Novo Indicador</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="nome">Nome Completo</Label>
                  <Input id="nome" placeholder="Digite o nome completo" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" placeholder="Digite o e-mail" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="cpf">CPF</Label>
                    <Input id="cpf" placeholder="000.000.000-00" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="telefone">Telefone</Label>
                    <Input id="telefone" placeholder="(00) 00000-0000" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="senha">Senha Temporária</Label>
                  <Input id="senha" type="password" placeholder="Digite uma senha" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={() => setIsDialogOpen(false)}>
                  Cadastrar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Lista de Indicadores</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, email ou CPF..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[300px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="ativo">Ativos</SelectItem>
                  <SelectItem value="pendente">Pendentes</SelectItem>
                  <SelectItem value="bloqueado">Bloqueados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={filteredIndicadores}
            columns={columns}
            emptyMessage="Nenhum indicador encontrado"
          />
        </CardContent>
      </Card>
    </div>
  )
}
