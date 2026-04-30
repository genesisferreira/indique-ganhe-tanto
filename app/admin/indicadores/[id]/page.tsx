"use client"

import { use } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { mockIndicadores, mockIndicacoes, mockPagamentos } from "@/lib/mock-data"
import { ArrowLeft, FileText, DollarSign, TrendingUp, Calendar, Mail, Phone, MapPin, CreditCard, Edit, Ban, CheckCircle } from "lucide-react"
import Link from "next/link"

export default function AdminIndicadorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const indicador = mockIndicadores.find(i => i.id === id) || mockIndicadores[0]
  const indicacoes = mockIndicacoes.filter(i => i.indicadorId === indicador.id)
  const pagamentos = mockPagamentos.filter(p => p.indicadorId === indicador.id)

  const indicacoesColumns = [
    {
      key: "indicado",
      header: "Indicado",
      render: (item: typeof mockIndicacoes[0]) => (
        <div>
          <p className="font-medium">{item.nomeIndicado}</p>
          <p className="text-sm text-muted-foreground">{item.telefoneIndicado}</p>
        </div>
      ),
    },
    {
      key: "plano",
      header: "Plano",
      render: (item: typeof mockIndicacoes[0]) => (
        <span className="text-sm">{item.planoInteresse || "Não informado"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item: typeof mockIndicacoes[0]) => (
        <StatusBadge status={item.status} type="indicacao" />
      ),
    },
    {
      key: "data",
      header: "Data",
      render: (item: typeof mockIndicacoes[0]) => (
        <span className="text-sm text-muted-foreground">
          {new Date(item.dataIndicacao).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
  ]

  const pagamentosColumns = [
    {
      key: "data",
      header: "Data",
      render: (item: typeof mockPagamentos[0]) => (
        <span className="text-sm">
          {new Date(item.dataSolicitacao).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "valor",
      header: "Valor",
      render: (item: typeof mockPagamentos[0]) => (
        <span className="font-semibold">
          R$ {item.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "chavePix",
      header: "Chave PIX",
      render: (item: typeof mockPagamentos[0]) => (
        <span className="font-mono text-sm">{item.chavePix}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item: typeof mockPagamentos[0]) => (
        <StatusBadge status={item.status} type="pagamento" />
      ),
    },
  ]

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
          description={`Cadastrado em ${new Date(indicador.dataCadastro).toLocaleDateString("pt-BR")}`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={indicador.status} type="indicador" />
        <Button variant="outline" size="sm">
          <Edit className="mr-2 h-4 w-4" />
          Editar
        </Button>
        {indicador.status === "ativo" ? (
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
        <StatCard
          title="Total de Indicações"
          value={indicador.totalIndicacoes}
          icon={FileText}
        />
        <StatCard
          title="Conversões"
          value={indicador.indicacoesConvertidas}
          icon={TrendingUp}
          variant="success"
        />
        <StatCard
          title="Taxa de Conversão"
          value={`${((indicador.indicacoesConvertidas / indicador.totalIndicacoes) * 100).toFixed(1)}%`}
          icon={TrendingUp}
        />
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
                <p className="font-medium font-mono">{indicador.cpf}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Cidade/UF</p>
                <p className="font-medium">{indicador.cidade}/{indicador.uf}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Cadastro</p>
                <p className="font-medium">{new Date(indicador.dataCadastro).toLocaleDateString("pt-BR")}</p>
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
                <p className="text-sm text-muted-foreground">Tipo: {indicador.chavePix.tipo.toUpperCase()}</p>
                <p className="mt-1 font-mono text-lg">{indicador.chavePix.chave}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">Nenhuma chave PIX cadastrada</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="indicacoes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="indicacoes">Indicações ({indicacoes.length})</TabsTrigger>
          <TabsTrigger value="pagamentos">Pagamentos ({pagamentos.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="indicacoes">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <DataTable
                data={indicacoes}
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
                data={pagamentos}
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
