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
import { Switch } from "@/components/ui/switch"
import { comerciais } from "@/lib/mock-data"
import { Plus, Search, Eye, Edit, MoreHorizontal, CheckCircle, XCircle } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Link from "next/link"
import type { Comercial } from "@/types"

export default function AdminComerciaisPage() {
  const [search, setSearch] = useState("")
  const [disponibilidadeFilter, setDisponibilidadeFilter] = useState<string>("todos")
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const filteredComerciais = comerciais.filter((comercial: Comercial) => {
    const matchesSearch = comercial.nome.toLowerCase().includes(search.toLowerCase()) ||
                         comercial.email.toLowerCase().includes(search.toLowerCase())
    const matchesDisponibilidade = disponibilidadeFilter === "todos" || 
                                   comercial.disponibilidade === disponibilidadeFilter
    return matchesSearch && matchesDisponibilidade
  })

  const columns = [
    {
      key: "nome",
      header: "Nome",
      cell: (comercial: Comercial) => (
        <div>
          <p className="font-medium">{comercial.nome}</p>
          <p className="text-sm text-muted-foreground">{comercial.email}</p>
        </div>
      ),
    },
    {
      key: "telefone",
      header: "Telefone",
      cell: (comercial: Comercial) => (
        <span className="text-sm">{comercial.telefone}</span>
      ),
    },
    {
      key: "leadsAtivos",
      header: "Leads",
      cell: (comercial: Comercial) => (
        <div className="text-center">
          <p className="font-semibold">{comercial.leadsAtivos}</p>
          <p className="text-xs text-muted-foreground">{comercial.vendasRealizadas} vendas</p>
        </div>
      ),
    },
    {
      key: "tempoMedio",
      header: "Tempo Médio",
      cell: (comercial: Comercial) => (
        <span className="font-semibold">
          {comercial.tempoMedioPrimeiroContato} min
        </span>
      ),
    },
    {
      key: "disponibilidade",
      header: "Disponibilidade",
      cell: (comercial: Comercial) => (
        <StatusBadge status={comercial.disponibilidade} />
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      cell: (comercial: Comercial) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/comerciais/${comercial.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalhes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Edit className="mr-2 h-4 w-4" />
              Editar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gerenciar Comerciais"
        description="Visualize e gerencie a equipe comercial"
      >
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Comercial
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Cadastrar Novo Comercial</DialogTitle>
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
              <div className="grid gap-2">
                <Label htmlFor="telefone">Telefone</Label>
                <Input id="telefone" placeholder="(00) 00000-0000" />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="disponivel">Disponível para atendimento</Label>
                <Switch id="disponivel" defaultChecked />
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
      </PageHeader>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Lista de Comerciais</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[300px]"
                />
              </div>
              <Select value={disponibilidadeFilter} onValueChange={setDisponibilidadeFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Disponibilidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="disponivel">Disponíveis</SelectItem>
                  <SelectItem value="em_pausa">Em Pausa</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={filteredComerciais}
            columns={columns}
            emptyMessage="Nenhum comercial encontrado"
          />
        </CardContent>
      </Card>
    </div>
  )
}
