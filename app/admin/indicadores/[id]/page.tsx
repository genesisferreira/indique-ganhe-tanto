"use client"

import { use, useEffect, useMemo, useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { indicadores, indicacoes, pagamentos } from "@/lib/services/mock-data.service"
import { loadAdminIndicatorDetailFromSupabase } from "@/lib/services/supabase-data.service"
import { ArrowLeft, FileText, DollarSign, TrendingUp, Calendar, Mail, Phone, CreditCard, Edit, Ban, CheckCircle } from "lucide-react"
import Link from "next/link"
import type { Indicador, Indicacao, Pagamento } from "@/types"

const indicacoesColumns = [
  {
    key: "indicado",
    header: "Indicado",
    cell: (item: Indicacao) => (
      <div>
        <p className="font-medium">{item.nomeIndicado}</p>
        <p className="text-sm text-muted-foreground">{item.telefoneIndicado}</p>
      </div>
    ),
  },
  {
    key: "plano",
    header: "Plano",
    cell: (item: Indicacao) => (
      <span className="text-sm">{item.plano?.nome || "Não informado"}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (item: Indicacao) => <StatusBadge status={item.status} />,
  },
  {
    key: "data",
    header: "Data",
    cell: (item: Indicacao) => (
      <span className="text-sm text-muted-foreground">
        {new Date(item.createdAt).toLocaleDateString("pt-BR")}
      </span>
    ),
  },
]

const pagamentosColumns = [
  {
    key: "data",
    header: "Data",
    cell: (item: Pagamento) => (
      <span className="text-sm">{new Date(item.createdAt).toLocaleDateString("pt-BR")}</span>
    ),
  },
  {
    key: "valor",
    header: "Valor",
    cell: (item: Pagamento) => (
      <span className="font-semibold">
        R$ {item.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    key: "tipo",
    header: "Tipo",
    cell: (item: Pagamento) => (
      <span className="text-sm capitalize">{item.tipo === "pix" ? "PIX" : "Desconto"}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (item: Pagamento) => <StatusBadge status={item.status} />,
  },
]

export default function AdminIndicadorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const mockIndicador = useMemo(() => {
    if (!isDataProviderMock()) return null
    return indicadores.find((i: Indicador) => i.id === id) ?? null
  }, [id])

  const [indicador, setIndicador] = useState<Indicador | null>(null)
  const [indicadorIndicacoes, setIndicadorIndicacoes] = useState<Indicacao[]>([])
  const [indicadorPagamentos, setIndicadorPagamentos] = useState<Pagamento[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isDataProviderMock()) {
      const ind = mockIndicador ?? indicadores[0]
      setIndicador(ind)
      setIndicadorIndicacoes(indicacoes.filter((i: Indicacao) => i.indicadorId === ind.id))
      setIndicadorPagamentos(pagamentos.filter((p: Pagamento) => p.indicadorId === ind.id))
      setLoading(false)
      return
    }
    setLoading(true)
    void (async () => {
      const data = await loadAdminIndicatorDetailFromSupabase(id)
      if (process.env.NODE_ENV === "development") {
        console.log("[flow-check:debug]", {
          flow: "admin-indicador-detail",
          id,
          ok: Boolean(data),
        })
      }
      if (data) {
        setIndicador(data.indicador)
        setIndicadorIndicacoes(data.indicacoes)
        setIndicadorPagamentos(data.pagamentos)
      } else {
        setIndicador(null)
        setIndicadorIndicacoes([])
        setIndicadorPagamentos([])
      }
      setLoading(false)
    })()
  }, [id, mockIndicador])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Carregando…
      </div>
    )
  }

  if (!indicador) {
    return (
      <div className="space-y-4 p-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/indicadores">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <p className="text-muted-foreground">Indicador não encontrado ou sem permissão.</p>
      </div>
    )
  }

  const taxaConversao =
    indicador.totalIndicacoes > 0
      ? ((indicador.indicacoesAprovadas / indicador.totalIndicacoes) * 100).toFixed(1)
      : "0"

  const isAtivo = indicador.ativo !== false

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/indicadores">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader
          title={indicador.nome}
          description={`Cadastrado em ${new Date(indicador.createdAt).toLocaleDateString("pt-BR")}`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={isAtivo ? "disponivel" : "offline"} />
        <Button variant="outline" size="sm">
          <Edit className="mr-2 h-4 w-4" />
          Editar
        </Button>
        {isAtivo ? (
          <Button variant="outline" size="sm" className="text-destructive">
            <Ban className="mr-2 h-4 w-4" />
            Bloquear
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="text-success">
            <CheckCircle className="mr-2 h-4 w-4" />
            Ativar
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total de Indicações" value={indicador.totalIndicacoes} icon={FileText} />
        <StatCard
          title="Aprovadas"
          value={indicador.indicacoesAprovadas}
          icon={TrendingUp}
          variant="success"
        />
        <StatCard title="Taxa de Conversão" value={`${taxaConversao}%`} icon={TrendingUp} />
        <StatCard
          title="Saldo Disponível"
          value={`R$ ${indicador.saldoDisponivel.toLocaleString("pt-BR")}`}
          icon={DollarSign}
          variant="success"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg">Informações Pessoais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">E-mail</p>
                <p className="font-medium">{indicador.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Telefone</p>
                <p className="font-medium">{indicador.telefone}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">CPF</p>
                <p className="font-medium font-mono">{indicador.cpf || "Não informado"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Cadastro</p>
                <p className="font-medium">{new Date(indicador.createdAt).toLocaleDateString("pt-BR")}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Chave PIX</CardTitle>
          </CardHeader>
          <CardContent>
            {indicador.chavePix ? (
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Tipo: {indicador.tipoChavePix?.toUpperCase()}</p>
                <p className="mt-1 font-mono text-lg">{indicador.chavePix}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">Nenhuma chave PIX cadastrada</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="indicacoes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="indicacoes">Indicações ({indicadorIndicacoes.length})</TabsTrigger>
          <TabsTrigger value="pagamentos">Pagamentos ({indicadorPagamentos.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="indicacoes">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <DataTable
                data={indicadorIndicacoes}
                columns={indicacoesColumns}
                emptyMessage="Nenhuma indicação encontrada"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pagamentos">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <DataTable
                data={indicadorPagamentos}
                columns={pagamentosColumns}
                emptyMessage="Nenhum pagamento encontrado"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
