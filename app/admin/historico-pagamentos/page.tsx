"use client"

import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { pagamentos } from "@/lib/services/mock-data.service"
import { loadAdminAllPaymentsFromSupabase } from "@/lib/services/supabase-data.service"
import type { Pagamento, PagamentoStatus } from "@/types"
import {
  Search,
  Download,
  Eye,
  FileText,
  DollarSign,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import Link from "next/link"

export default function AdminHistoricoPagamentosPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")
  const [periodoFilter, setPeriodoFilter] = useState<string>("todos")
  const [lista, setLista] = useState<Pagamento[]>(pagamentos)

  useEffect(() => {
    void (async () => {
      const remoto = await loadAdminAllPaymentsFromSupabase()
      if (remoto !== null) setLista(remoto)
    })()
  }, [])

  const filteredPagamentos = useMemo(() => {
    const q = search.toLowerCase()
    return lista.filter((pagamento: Pagamento) => {
      const nomeIndicado = pagamento.indicacao?.nomeIndicado?.toLowerCase() ?? ""
      const nomeIndicador = pagamento.indicador?.nome?.toLowerCase() ?? ""
      const refSaque =
        pagamento.kind === "pix_withdrawal" ? "saque pix" : ""
      const matchesSearch =
        nomeIndicado.includes(q) ||
        nomeIndicador.includes(q) ||
        refSaque.includes(q) ||
        pagamento.id.toLowerCase().includes(q)

      const matchesStatus =
        statusFilter === "todos" || pagamento.status === statusFilter

      let matchesPeriodo = true
      if (periodoFilter !== "todos") {
        const dias = periodoFilter === "7dias" ? 7 : periodoFilter === "30dias" ? 30 : 90
        const limite = Date.now() - dias * 24 * 60 * 60 * 1000
        matchesPeriodo = new Date(pagamento.createdAt).getTime() >= limite
      }

      return matchesSearch && matchesStatus && matchesPeriodo
    })
  }, [lista, search, statusFilter, periodoFilter])

  const totalPago = lista
    .filter((p: Pagamento) => p.status === "pago")
    .reduce((acc: number, p: Pagamento) => acc + p.valor, 0)
  const totalPendente = lista
    .filter((p: Pagamento) => p.status === "pendente")
    .reduce((acc: number, p: Pagamento) => acc + p.valor, 0)
  const totalCancelado = lista
    .filter((p: Pagamento) => p.status === "cancelado" || p.status === "rejeitado")
    .reduce((acc: number, p: Pagamento) => acc + p.valor, 0)

  const columns = [
    {
      key: "id",
      header: "ID",
      cell: (pagamento: Pagamento) => (
        <span className="font-mono text-xs text-muted-foreground">
          #{pagamento.id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "referencia",
      header: "Referência",
      cell: (pagamento: Pagamento) => (
        <div>
          <p className="font-medium">
            {pagamento.kind === "pix_withdrawal"
              ? "Saque Pix"
              : pagamento.indicacao?.nomeIndicado ?? "—"}
          </p>
          <p className="text-sm text-muted-foreground">
            {pagamento.kind === "pix_withdrawal"
              ? pagamento.pixChaveSnapshot ?? "Chave no cadastro"
              : pagamento.indicacao?.plano?.nome ?? "Plano"}
          </p>
        </div>
      ),
    },
    {
      key: "indicador",
      header: "Indicador",
      cell: (pagamento: Pagamento) => (
        <div>
          <p className="font-medium">{pagamento.indicador?.nome ?? "N/A"}</p>
          <p className="text-sm text-muted-foreground">
            {pagamento.indicador?.email ?? ""}
          </p>
        </div>
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
      key: "origem",
      header: "Origem",
      cell: (pagamento: Pagamento) => (
        <span className="text-sm text-muted-foreground">
          {pagamento.kind === "pix_withdrawal" ? "Saque carteira" : "Indicação"}
        </span>
      ),
    },
    {
      key: "tipo",
      header: "Tipo",
      cell: (pagamento: Pagamento) => (
        <span className="capitalize text-sm">{pagamento.tipo}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (pagamento: Pagamento) => (
        <StatusBadge status={pagamento.status as PagamentoStatus} />
      ),
    },
    {
      key: "data",
      header: "Data",
      cell: (pagamento: Pagamento) => (
        <div className="text-sm">
          <p>{new Date(pagamento.createdAt).toLocaleDateString("pt-BR")}</p>
          {pagamento.dataPagamento && (
            <p className="text-xs text-muted-foreground">
              Pago em: {new Date(pagamento.dataPagamento).toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      cell: (pagamento: Pagamento) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" title="Ver detalhes">
            <Eye className="h-4 w-4" />
          </Button>
          {pagamento.comprovanteUrl && (
            <Button variant="ghost" size="icon" title="Comprovante" asChild>
              <Link href={pagamento.comprovanteUrl} target="_blank" rel="noopener noreferrer">
                <FileText className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Histórico de pagamentos"
        description="Consulta unificada: recompensas por indicação e saques Pix"
      >
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total de registros"
          value={lista.length}
          icon={FileText}
        />
        <StatCard
          title="Total pago"
          value={`R$ ${totalPago.toLocaleString("pt-BR")}`}
          icon={CheckCircle}
          variant="success"
        />
        <StatCard
          title="Total pendente"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Cancelado / rejeitado"
          value={`R$ ${totalCancelado.toLocaleString("pt-BR")}`}
          icon={XCircle}
          variant="destructive"
        />
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Histórico completo</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar indicador, saque ou ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[250px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="aprovado">Aprovado</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="rejeitado">Rejeitado</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
              <Select value={periodoFilter} onValueChange={setPeriodoFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todo período</SelectItem>
                  <SelectItem value="7dias">Últimos 7 dias</SelectItem>
                  <SelectItem value="30dias">Últimos 30 dias</SelectItem>
                  <SelectItem value="90dias">Últimos 90 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredPagamentos.length > 0 ? (
            <DataTable
              data={filteredPagamentos}
              columns={columns}
              emptyMessage="Nenhum pagamento encontrado"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <DollarSign className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum pagamento encontrado</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Ajuste os filtros para ver mais resultados
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
