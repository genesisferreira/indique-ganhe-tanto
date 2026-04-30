"use client"

import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { currentIndicador, dashboardIndicador } from "@/lib/mock-data"
import {
  Wallet,
  TrendingUp,
  Receipt,
  ArrowUpRight,
  Info,
  Calendar,
} from "lucide-react"

export default function CarteiraPage() {
  const proximoPagamento = new Date()
  const dia = proximoPagamento.getDate()
  if (dia < 15) {
    proximoPagamento.setDate(15)
  } else if (dia < 30) {
    proximoPagamento.setDate(30)
  } else {
    proximoPagamento.setMonth(proximoPagamento.getMonth() + 1)
    proximoPagamento.setDate(15)
  }

  const podeResgatar = dashboardIndicador.saldoDisponivel >= 100

  return (
    <div>
      <PageHeader
        title="Minha Carteira"
        description="Gerencie seus saldos e resgates"
      />

      {/* Saldos */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Total Recebido"
          value={`R$ ${dashboardIndicador.totalRecebido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={Wallet}
          variant="primary"
        />
        <StatCard
          title="Total a Receber"
          value={`R$ ${dashboardIndicador.totalAReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={TrendingUp}
        />
        <StatCard
          title="Saldo Disponível"
          value={`R$ ${dashboardIndicador.saldoDisponivel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={ArrowUpRight}
          variant="success"
        />
        <StatCard
          title="Saldo em Desconto"
          value={`R$ ${dashboardIndicador.saldoEmDesconto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={Receipt}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Solicitar Resgate */}
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Solicitar Resgate via Pix
          </h2>

          <div className="p-4 rounded-lg bg-muted/30 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Saldo disponível</span>
              <span className="text-2xl font-bold text-primary">
                R${" "}
                {dashboardIndicador.saldoDisponivel.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>
                Próximo pagamento: {proximoPagamento.toLocaleDateString("pt-BR")}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-info/10 border border-info/20 mb-6">
            <Info className="w-5 h-5 text-info mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Regras de Resgate</p>
              <ul className="mt-1 text-muted-foreground space-y-1">
                <li>- Saque mínimo: R$ 100,00</li>
                <li>- Pagamentos nos dias 15 e 30</li>
                <li>- Chave Pix cadastrada: {currentIndicador.chavePix}</li>
              </ul>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!podeResgatar}
            size="lg"
          >
            <ArrowUpRight className="w-4 h-4 mr-2" />
            {podeResgatar
              ? "Solicitar Resgate"
              : `Saldo mínimo: R$ 100,00`}
          </Button>
        </div>

        {/* Desconto na Fatura */}
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Saldo em Desconto na Fatura
          </h2>

          <div className="p-4 rounded-lg bg-muted/30 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Crédito disponível</span>
              <span className="text-2xl font-bold text-foreground">
                R${" "}
                {dashboardIndicador.saldoEmDesconto.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Este valor será aplicado automaticamente na sua próxima fatura da
              Tanto Telecom.
            </p>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
            <Receipt className="w-5 h-5 text-success mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                Desconto Automático
              </p>
              <p className="mt-1 text-muted-foreground">
                O desconto é aplicado automaticamente na sua fatura. Você não
                precisa fazer nada!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Histórico de Movimentações */}
      <div className="rounded-xl border bg-card p-6 mt-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Últimas Movimentações
        </h2>
        <div className="space-y-3">
          {[
            {
              tipo: "entrada",
              descricao: "Recompensa - Pedro Almeida",
              valor: 129.9,
              data: "25/03/2024",
            },
            {
              tipo: "saida",
              descricao: "Resgate via Pix",
              valor: -200,
              data: "15/03/2024",
            },
            {
              tipo: "entrada",
              descricao: "Recompensa - Marcos Vieira",
              valor: 99.9,
              data: "28/02/2024",
            },
          ].map((mov, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-4 rounded-lg bg-muted/30"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    mov.tipo === "entrada"
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {mov.tipo === "entrada" ? (
                    <TrendingUp className="w-5 h-5" />
                  ) : (
                    <ArrowUpRight className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-foreground">{mov.descricao}</p>
                  <p className="text-sm text-muted-foreground">{mov.data}</p>
                </div>
              </div>
              <span
                className={`font-semibold ${
                  mov.tipo === "entrada" ? "text-success" : "text-destructive"
                }`}
              >
                {mov.tipo === "entrada" ? "+" : ""}R${" "}
                {Math.abs(mov.valor).toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
