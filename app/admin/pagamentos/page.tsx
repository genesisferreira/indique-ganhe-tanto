"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { pagamentos, indicadores } from "@/lib/mock-data"
import { Search, DollarSign, Clock, CheckCircle, MoreHorizontal, Eye, Check, X, Upload } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Pagamento, Indicador } from "@/types"

export default function AdminPagamentosPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")
  const [selectedPagamento, setSelectedPagamento] = useState<Pagamento | null>(null)
  const [dialogType, setDialogType] = useState<"aprovar" | "rejeitar" | "detalhes" | null>(null)

  const filteredPagamentos = pagamentos.filter((pagamento: Pagamento) => {
    const indicador = indicadores.find((i: Indicador) => i.id === pagamento.indicadorId)
    const matchesSearch = indicador?.nome.toLowerCase().includes(search.toLowerCase()) ||
                         (pagamento.indicador?.chavePix?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const matchesStatus = statusFilter === "todos" || pagamento.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const totalPendente = pagamentos.filter((p: Pagamento) => p.status === "pendente").reduce((acc, p) => acc + p.valor, 0)
  const totalPago = pagamentos.filter((p: Pagamento) => p.status === "pago").reduce((acc, p) => acc + p.valor, 0)
  const pagamentosPendentes = pagamentos.filter((p: Pagamento) => p.status === "pendente").length
  const pagamentosPagos = pagamentos.filter((p: Pagamento) => p.status === "pago").length

  const getIndicadorNome = (indicadorId: string) => {
    const indicador = indicadores.find((i: Indicador) => i.id === indicadorId)
    return indicador?.nome || "Desconhecido"
  }

  const handleAction = (pagamento: Pagamento, type: "aprovar" | "rejeitar" | "detalhes") => {
    setSelectedPagamento(pagamento)
    setDialogType(type)
  }

  const columns = [
    {
      key: "indicador",
      header: "Indicador",
      cell: (pagamento: Pagamento) => (
        <p className="font-medium">{getIndicadorNome(pagamento.indicadorId)}</p>
      ),
    },
    {
      key: "valor",
      header: "Valor",
      cell: (pagamento: Pagamento) => (
        <span className="font-semibold">
          R$ {pagamento.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "tipo",
      header: "Tipo",
      cell: (pagamento: Pagamento) => (
        <span className="text-sm capitalize">{pagamento.tipo === 'pix' ? 'PIX' : 'Desconto'}</span>
      ),
    },
    {
      key: "dataSolicitacao",
      header: "Solicitação",
      cell: (pagamento: Pagamento) => (
        <span className="text-sm text-muted-foreground">
          {new Date(pagamento.createdAt).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (pagamento: Pagamento) => (
        <StatusBadge status={pagamento.status} />
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      cell: (pagamento: Pagamento) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleAction(pagamento, "detalhes")}>
              <Eye className="mr-2 h-4 w-4" />
              Ver Detalhes
            </DropdownMenuItem>
            {pagamento.status === "pendente" && (
              <>
                <DropdownMenuItem onClick={() => handleAction(pagamento, "aprovar")} className="text-success">
                  <Check className="mr-2 h-4 w-4" />
                  Aprovar Pagamento
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAction(pagamento, "rejeitar")} className="text-destructive">
                  <X className="mr-2 h-4 w-4" />
                  Rejeitar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gerenciar Pagamentos"
        description="Aprove ou rejeite solicitações de pagamento dos indicadores"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Pagamentos Pendentes"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          subtitle={`${pagamentosPendentes} solicitações`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Total Pago"
          value={`R$ ${totalPago.toLocaleString("pt-BR")}`}
          subtitle="Este mês"
          icon={CheckCircle}
          variant="success"
        />
        <StatCard
          title="Média por Pagamento"
          value={`R$ ${(pagamentosPagos > 0 ? totalPago / pagamentosPagos : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={DollarSign}
        />
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Solicitações de Pagamento</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por indicador..."
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
                  <SelectItem value="pago">Pagos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={filteredPagamentos}
            columns={columns}
            emptyMessage="Nenhum pagamento encontrado"
          />
        </CardContent>
      </Card>

      {/* Dialog Aprovar */}
      <Dialog open={dialogType === "aprovar"} onOpenChange={() => setDialogType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar Pagamento</DialogTitle>
            <DialogDescription>
              Confirme o pagamento e anexe o comprovante
            </DialogDescription>
          </DialogHeader>
          {selectedPagamento && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Indicador</p>
                <p className="font-medium">{getIndicadorNome(selectedPagamento.indicadorId)}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Valor</p>
                <p className="text-xl font-bold text-success">
                  R$ {selectedPagamento.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="grid gap-2">
                <Label>Comprovante de Pagamento</Label>
                <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-border p-6">
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">Clique para anexar o comprovante</p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogType(null)}>
              Cancelar
            </Button>
            <Button onClick={() => setDialogType(null)}>
              Confirmar Pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Rejeitar */}
      <Dialog open={dialogType === "rejeitar"} onOpenChange={() => setDialogType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Pagamento</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição
            </DialogDescription>
          </DialogHeader>
          {selectedPagamento && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Indicador</p>
                <p className="font-medium">{getIndicadorNome(selectedPagamento.indicadorId)}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Valor</p>
                <p className="text-xl font-bold">
                  R$ {selectedPagamento.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="motivo">Motivo da Rejeição</Label>
                <Textarea id="motivo" placeholder="Descreva o motivo da rejeição..." rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogType(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => setDialogType(null)}>
              Rejeitar Pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalhes */}
      <Dialog open={dialogType === "detalhes"} onOpenChange={() => setDialogType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalhes do Pagamento</DialogTitle>
          </DialogHeader>
          {selectedPagamento && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Indicador</p>
                  <p className="font-medium">{getIndicadorNome(selectedPagamento.indicadorId)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Status</p>
                  <StatusBadge status={selectedPagamento.status} />
                </div>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Valor</p>
                <p className="text-xl font-bold text-success">
                  R$ {selectedPagamento.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Data Solicitação</p>
                  <p className="font-medium">{new Date(selectedPagamento.createdAt).toLocaleDateString("pt-BR")}</p>
                </div>
                {selectedPagamento.dataPagamento && (
                  <div className="rounded-lg bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">Data Pagamento</p>
                    <p className="font-medium">{new Date(selectedPagamento.dataPagamento).toLocaleDateString("pt-BR")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDialogType(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
