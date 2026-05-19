"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_INDICADOR,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { currentIndicador, dashboardIndicador } from "@/lib/services/mock-data.service"
import {
  loadIndicadorCarteiraFromSupabase,
  requestPixWithdrawalFromSupabase,
  type WalletTransactionListItem,
} from "@/lib/services/supabase-data.service"
import {
  Wallet,
  TrendingUp,
  Receipt,
  ArrowUpRight,
  Info,
  Calendar,
} from "lucide-react"

const SAQUE_MINIMO = 100

const MOCK_MOVIMENTACOES: WalletTransactionListItem[] = [
  {
    id: "mock-1",
    tipo: "credito",
    valor: 129.9,
    descricao: "Recompensa - Pedro Almeida",
    saldoApos: 299.7,
    createdAt: new Date("2024-03-25"),
  },
  {
    id: "mock-2",
    tipo: "saque",
    valor: 200,
    descricao: "Resgate via Pix",
    saldoApos: 99.8,
    createdAt: new Date("2024-03-15"),
  },
]

export default function CarteiraPage() {
  const [valorSaque, setValorSaque] = useState("")
  const [totalRecebido, setTotalRecebido] = useState(0)
  const [totalAReceber, setTotalAReceber] = useState(0)
  const [saldoDisponivel, setSaldoDisponivel] = useState(0)
  const [saldoEmDesconto, setSaldoEmDesconto] = useState(0)
  const [movimentacoes, setMovimentacoes] = useState<WalletTransactionListItem[]>([])
  const [chavePix, setChavePix] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [enviandoSaque, setEnviandoSaque] = useState(false)

  const recarregar = useCallback(async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[indicador:wallet-refresh]", "recarregar carteira")
    }
    const payload = await loadIndicadorCarteiraFromSupabase()
    if (payload) {
      setSaldoDisponivel(payload.availableBalance)
      setTotalRecebido(payload.creditTotal)
      setTotalAReceber(payload.pendingRewardsTotal)
      setSaldoEmDesconto(payload.discountBalance)
      setMovimentacoes(payload.movimentacoes)
      setChavePix(payload.chavePix)
      return
    }
    if (isDataProviderMock()) {
      setSaldoDisponivel(dashboardIndicador.saldoDisponivel)
      setTotalRecebido(dashboardIndicador.totalRecebido)
      setTotalAReceber(dashboardIndicador.totalAReceber)
      setSaldoEmDesconto(dashboardIndicador.saldoEmDesconto)
      setMovimentacoes(MOCK_MOVIMENTACOES)
      setChavePix(currentIndicador.chavePix ?? null)
      return
    }
    setSaldoDisponivel(0)
    setTotalRecebido(0)
    setTotalAReceber(0)
    setSaldoEmDesconto(0)
    setMovimentacoes([])
    setChavePix(null)
  }, [])

  useEffect(() => {
    void (async () => {
      setCarregando(true)
      await recarregar()
      setCarregando(false)
    })()
  }, [recarregar])

  useRealtimeReload(recarregar, REALTIME_TABLES_INDICADOR, {
    enabled: !isDataProviderMock(),
    logPrefix: "[indicador:realtime]",
  })

  const handleSolicitarSaque = async () => {
    const normalizado = String(valorSaque).trim().replace(/\./g, "").replace(",", ".")
    const valor = Number(normalizado)
    if (!Number.isFinite(valor) || valor < SAQUE_MINIMO) {
      toast.error(`Informe um valor válido (mínimo R$ ${SAQUE_MINIMO.toFixed(2).replace(".", ",")}).`)
      return
    }
    if (valor > saldoDisponivel + 0.001) {
      toast.error("Valor acima do saldo disponível.")
      return
    }
    if (enviandoSaque) return
    setEnviandoSaque(true)
    try {
    const resultado = await requestPixWithdrawalFromSupabase(valor)
    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }
    toast.success("Solicitação de saque Pix enviada. Acompanhe em Meus Pagamentos.")
    setValorSaque("")
    await recarregar()
    } finally {
      setEnviandoSaque(false)
    }
  }

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

  const podeResgatar = saldoDisponivel >= SAQUE_MINIMO

  const fmtValor = (n: number) =>
    `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`

  return (
    <div>
      <PageHeader
        title="Minha Carteira"
        description="Gerencie seus saldos e resgates"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Total Recebido"
          value={fmtValor(totalRecebido)}
          icon={Wallet}
          variant="primary"
        />
        <StatCard
          title="Total a Receber"
          value={fmtValor(totalAReceber)}
          icon={TrendingUp}
        />
        <StatCard
          title="Saldo Disponível"
          value={carregando ? "…" : fmtValor(saldoDisponivel)}
          icon={ArrowUpRight}
          variant="success"
        />
        <StatCard
          title="Saldo em Desconto"
          value={fmtValor(saldoEmDesconto)}
          icon={Receipt}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Solicitar saque via Pix
          </h2>

          <div className="p-4 rounded-lg bg-muted/30 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Saldo disponível</span>
              <span className="text-2xl font-bold text-primary">
                {carregando ? "…" : fmtValor(saldoDisponivel)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>
                Previsão de processamento: {proximoPagamento.toLocaleDateString("pt-BR")}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-info/10 border border-info/20 mb-6">
            <Info className="w-5 h-5 text-info mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Regras de saque</p>
              <ul className="mt-1 text-muted-foreground space-y-1 list-disc list-inside">
                <li>Valor mínimo: R$ {SAQUE_MINIMO.toFixed(2).replace(".", ",")}</li>
                <li>Uso da chave Pix principal do seu cadastro</li>
                <li>Análise e aprovação pelo financeiro</li>
              </ul>
              <p className="mt-2 text-muted-foreground">
                Chave cadastrada:{" "}
                <span className="text-foreground font-medium">
                  {chavePix ?? "— cadastre em Chave Pix"}
                </span>
              </p>
            </div>
          </div>

          <div className="space-y-3 mb-4">
            <Label htmlFor="valor-saque">Valor do saque (R$)</Label>
            <Input
              id="valor-saque"
              inputMode="decimal"
              placeholder="Ex.: 150,00"
              value={valorSaque}
              onChange={(e) => setValorSaque(e.target.value)}
              disabled={enviandoSaque}
            />
          </div>

          <Button
            className="w-full"
            disabled={!podeResgatar || enviandoSaque || carregando}
            size="lg"
            onClick={() => void handleSolicitarSaque()}
          >
            <ArrowUpRight className="w-4 h-4 mr-2" />
            {enviandoSaque
              ? "Enviando…"
              : podeResgatar
                ? "Solicitar saque Pix"
                : "Saldo mínimo: R$ 100,00"}
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Saldo em desconto na fatura
          </h2>

          <div className="p-4 rounded-lg bg-muted/30 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Crédito disponível</span>
              <span className="text-2xl font-bold text-foreground">
                {fmtValor(saldoEmDesconto)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Este valor será aplicado automaticamente na sua próxima fatura da Tanto
              Telecom.
            </p>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
            <Receipt className="w-5 h-5 text-success mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Desconto automático</p>
              <p className="mt-1 text-muted-foreground">
                O desconto é aplicado na fatura; não é necessário solicitar saque.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 mt-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Últimas movimentações
        </h2>
        <div className="space-y-3">
          {carregando ? (
            <p className="text-sm text-muted-foreground text-center py-6">…</p>
          ) : movimentacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma movimentação na carteira.
            </p>
          ) : (
            movimentacoes.map((mov) => {
              const entrada =
                mov.tipo === "credito" || mov.tipo === "desconto"
              return (
                <div
                  key={mov.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center ${
                        entrada
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {entrada ? (
                        <TrendingUp className="w-5 h-5" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {mov.descricao}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {mov.createdAt.toLocaleString("pt-BR")} · Saldo após: R${" "}
                        {mov.saldoApos.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`font-semibold shrink-0 ml-2 ${
                      entrada ? "text-success" : "text-destructive"
                    }`}
                  >
                    {entrada ? "+" : "−"}R${" "}
                    {mov.valor.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
