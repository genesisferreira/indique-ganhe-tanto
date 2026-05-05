"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { pagamentos } from "@/lib/mock-data"
import type { Pagamento } from "@/types"
import { Search, CheckCircle, XCircle, Clock, DollarSign, AlertTriangle, Upload } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import Link from "next/link"

export default function AdminPagamentosPendentesPage() {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false)
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false)

  const pagamentosPendentes = pagamentos.filter((p: Pagamento) => p.status === "pendente")

  const filteredPagamentos = pagamentosPendentes.filter((pagamento: Pagamento) => {
    const indicacao = pagamento.indicacao
    if (!indicacao) return false
    return indicacao.nomeIndicado.toLowerCase().includes(search.toLowerCase())
  })

  const totalPendente = pagamentosPendentes.reduce((acc: number, p: Pagamento) => acc + p.valor, 0)
  const totalSelecionado = filteredPagamentos
    .filter((p: Pagamento) => selectedIds.includes(p.id))
    .reduce((acc: number, p: Pagamento) => acc + p.valor, 0)

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredPagamentos.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredPagamentos.map((p: Pagamento) => p.id))
    }
  }

  const columns = [
    {
      key: "select",
      header: () => (
        <Checkbox
          checked={selectedIds.length === filteredPagamentos.length && filteredPagamentos.length > 0}
          onCheckedChange={toggleSelectAll}
        />
      ),
      cell: (pagamento: Pagamento) => (
        <Checkbox
          checked={selectedIds.includes(pagamento.id)}
          onCheckedChange={() => toggleSelect(pagamento.id)}
        />
      ),
    },
    {
      key: "indicado",
      header: "Indicado",
      cell: (pagamento: Pagamento) => (
        <div>
          <p className="font-medium">{pagamento.indicacao?.nomeIndicado || "N/A"}</p>
          <p className="text-sm text-muted-foreground">{pagamento.indicacao?.plano?.nome || "Plano"}</p>
        </div>
      ),
    },
    {
      key: "indicador",
      header: "Indicador",
      cell: (pagamento: Pagamento) => (
        <div>
          <p className="font-medium">{pagamento.indicador?.nome || "N/A"}</p>
          <p className="text-sm text-muted-foreground">{pagamento.indicador?.email || ""}</p>
        </div>
      ),
    },
    {
      key: "valor",
      header: "Valor",
      cell: (pagamento: Pagamento) => (
        <span className="font-semibold text-success">
          R$ {pagamento.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "tipo",
      header: "Tipo",
      cell: (pagamento: Pagamento) => (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary capitalize">
          {pagamento.tipo}
        </span>
      ),
    },
    {
      key: "dataSolicitacao",
      header: "Solicitado em",
      cell: (pagamento: Pagamento) => (
        <span className="text-sm text-muted-foreground">
          {new Date(pagamento.createdAt).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "acoes",
      header: "Acoes",
      cell: (pagamento: Pagamento) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-success hover:text-success"
            onClick={() => {
              setSelectedIds([pagamento.id])
              setIsApproveDialogOpen(true)
            }}
          >
            <CheckCircle className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              setSelectedIds([pagamento.id])
              setIsRejectDialogOpen(true)
            }}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagamentos Pendentes"
        description="Gerencie as solicitacoes de pagamento aguardando aprovacao"
      >
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/upload-comprovante">
              <Upload className="mr-2 h-4 w-4" />
              Upload Comprovante
            </Link>
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total Pendente"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          subtitle={`${pagamentosPendentes.length} solicitacoes`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Selecionados"
          value={selectedIds.length}
          subtitle={`R$ ${totalSelecionado.toLocaleString("pt-BR")}`}
          icon={CheckCircle}
          variant="primary"
        />
        <StatCard
          title="Aguardando Aprovacao"
          value={pagamentosPendentes.length}
          subtitle="Prioridade alta"
          icon={AlertTriangle}
          variant="destructive"
        />
      </div>

      {selectedIds.length > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {selectedIds.length} pagamento(s) selecionado(s)
              </span>
              <span className="text-sm text-muted-foreground">
                Total: R$ {totalSelecionado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-success hover:text-success"
                onClick={() => setIsApproveDialogOpen(true)}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Aprovar Selecionados
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setIsRejectDialogOpen(true)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Rejeitar Selecionados
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Lista de Pagamentos Pendentes</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome do indicado..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 sm:w-[300px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredPagamentos.length > 0 ? (
            <DataTable
              data={filteredPagamentos}
              columns={columns}
              emptyMessage="Nenhum pagamento pendente encontrado"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="h-12 w-12 text-success/50 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum pagamento pendente</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Todos os pagamentos foram processados
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar Pagamentos</DialogTitle>
            <DialogDescription>
              Voce esta prestes a aprovar {selectedIds.length} pagamento(s) no valor total de R$ {totalSelecionado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsApproveDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => {
              setIsApproveDialogOpen(false)
              setSelectedIds([])
            }}>
              Confirmar Aprovacao
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Pagamentos</DialogTitle>
            <DialogDescription>
              Voce esta prestes a rejeitar {selectedIds.length} pagamento(s). Esta acao nao pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => {
              setIsRejectDialogOpen(false)
              setSelectedIds([])
            }}>
              Confirmar Rejeicao
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
