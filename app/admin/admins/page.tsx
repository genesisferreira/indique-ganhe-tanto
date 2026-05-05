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
import { Plus, Search, Edit, Ban, CheckCircle, MoreHorizontal, Shield, ShieldAlert, ShieldCheck } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { StatCard } from "@/components/ui/stat-card"

interface Admin {
  id: string
  nome: string
  email: string
  role: "super_admin" | "admin" | "moderador"
  ativo: boolean
  ultimoAcesso: Date
  createdAt: Date
}

const mockAdmins: Admin[] = [
  {
    id: "1",
    nome: "Carlos Silva",
    email: "carlos@tantotelecom.com.br",
    role: "super_admin",
    ativo: true,
    ultimoAcesso: new Date("2024-01-15T10:30:00"),
    createdAt: new Date("2023-06-01"),
  },
  {
    id: "2",
    nome: "Ana Paula Santos",
    email: "ana.paula@tantotelecom.com.br",
    role: "admin",
    ativo: true,
    ultimoAcesso: new Date("2024-01-15T09:15:00"),
    createdAt: new Date("2023-08-15"),
  },
  {
    id: "3",
    nome: "Roberto Ferreira",
    email: "roberto@tantotelecom.com.br",
    role: "moderador",
    ativo: true,
    ultimoAcesso: new Date("2024-01-14T16:45:00"),
    createdAt: new Date("2023-10-20"),
  },
  {
    id: "4",
    nome: "Fernanda Lima",
    email: "fernanda@tantotelecom.com.br",
    role: "admin",
    ativo: false,
    ultimoAcesso: new Date("2023-12-20T14:00:00"),
    createdAt: new Date("2023-07-10"),
  },
]

const roleLabels = {
  super_admin: "Super Admin",
  admin: "Administrador",
  moderador: "Moderador",
}

const roleIcons = {
  super_admin: ShieldAlert,
  admin: ShieldCheck,
  moderador: Shield,
}

export default function AdminAdminsPage() {
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>("todos")
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const filteredAdmins = mockAdmins.filter((admin) => {
    const matchesSearch = admin.nome.toLowerCase().includes(search.toLowerCase()) ||
                         admin.email.toLowerCase().includes(search.toLowerCase())
    const matchesRole = roleFilter === "todos" || admin.role === roleFilter
    return matchesSearch && matchesRole
  })

  const totalAdmins = mockAdmins.length
  const adminsAtivos = mockAdmins.filter(a => a.ativo).length
  const superAdmins = mockAdmins.filter(a => a.role === "super_admin").length

  const columns = [
    {
      key: "nome",
      header: "Nome",
      cell: (admin: Admin) => {
        const RoleIcon = roleIcons[admin.role]
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <RoleIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{admin.nome}</p>
              <p className="text-sm text-muted-foreground">{admin.email}</p>
            </div>
          </div>
        )
      },
    },
    {
      key: "role",
      header: "Perfil",
      cell: (admin: Admin) => (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          {roleLabels[admin.role]}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (admin: Admin) => (
        <StatusBadge status={admin.ativo ? "disponivel" : "offline"} />
      ),
    },
    {
      key: "ultimoAcesso",
      header: "Ultimo Acesso",
      cell: (admin: Admin) => (
        <span className="text-sm text-muted-foreground">
          {admin.ultimoAcesso.toLocaleDateString("pt-BR")} as {admin.ultimoAcesso.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Cadastro",
      cell: (admin: Admin) => (
        <span className="text-sm text-muted-foreground">
          {admin.createdAt.toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "acoes",
      header: "Acoes",
      cell: (admin: Admin) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <Edit className="mr-2 h-4 w-4" />
              Editar
            </DropdownMenuItem>
            {admin.ativo ? (
              <DropdownMenuItem className="text-destructive">
                <Ban className="mr-2 h-4 w-4" />
                Desativar
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
        title="Gerenciar Administradores"
        description="Gerencie os usuarios com acesso administrativo ao sistema"
      >
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Admin
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Cadastrar Novo Administrador</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="nome">Nome Completo</Label>
                <Input id="nome" placeholder="Digite o nome completo" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" placeholder="Digite o e-mail corporativo" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="role">Perfil de Acesso</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="moderador">Moderador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="senha">Senha Temporaria</Label>
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

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total de Admins"
          value={totalAdmins}
          subtitle={`${adminsAtivos} ativos`}
          icon={Shield}
        />
        <StatCard
          title="Super Admins"
          value={superAdmins}
          subtitle="Acesso total"
          icon={ShieldAlert}
          variant="primary"
        />
        <StatCard
          title="Admins Ativos"
          value={adminsAtivos}
          subtitle="Online recentemente"
          icon={ShieldCheck}
          variant="success"
        />
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Lista de Administradores</CardTitle>
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
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Perfil" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os Perfis</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="moderador">Moderador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredAdmins.length > 0 ? (
            <DataTable
              data={filteredAdmins}
              columns={columns}
              emptyMessage="Nenhum administrador encontrado"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum administrador encontrado</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Ajuste os filtros ou cadastre um novo administrador
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
