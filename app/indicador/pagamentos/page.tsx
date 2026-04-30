"use client"

import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { pagamentos, currentIndicador } from "@/lib/mock-data"
import { Wallet, Receipt, Calendar, ArrowUpRight } from "lucide-react"

export default function PagamentosPage() {
  const meusPagamentos = pagamentos.filter(
    (p) => p.indicadorId === currentIndicador.id
  )

  const totalPago = meusPagamentos
    .filter((p) => p.status === "pago")
    .reduce((acc, p) => acc + p.valor, 0)

  const totalPendente = meusPagamentos
    .filter((p) => p.status === "pendente")
    .reduce((acc, p) => acc + p.valor, 0)

  return (
    <div>
      <PageHeader
        title="Meus Pagamentos"
        description="Histórico de pagamentos recebidos"
      />

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-success" />
            </div>
            <span className="text-sm text-muted-foreground">Total Pago</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            R${" "}
            {totalPago.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-warning" />
            </div>
            <span className="text-sm text-muted-foreground">Pendente</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            R${" "}
            {totalPendente.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
            })}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">
              Total Pagamentos
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {meusPagamentos.length}
          </p>
        </div>
      </div>

      {/* Payments List */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Indicação
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Valor
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tipo
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Vencimento
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pagamento
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {meusPagamentos.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Nenhum pagamento encontrado
                  </td>
                </tr>
              ) : (
                meusPagamentos.map((pagamento) => (
                  <tr
                    key={pagamento.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {pagamento.indicacao.nomeIndicado}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pagamento.indicacao.plano.nome}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-foreground">
                      R${" "}
                      {pagamento.valor.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm">
                        {pagamento.tipo === "pix" ? (
                          <>
                            <Wallet className="w-4 h-4 text-primary" />
                            <span className="text-foreground">Pix</span>
                          </>
                        ) : (
                          <>
                            <Receipt className="w-4 h-4 text-primary" />
                            <span className="text-foreground">Desconto</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {pagamento.dataVencimento.toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {pagamento.dataPagamento
                        ? pagamento.dataPagamento.toLocaleDateString("pt-BR")
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={pagamento.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
