"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { pagamentos, currentIndicador } from "@/lib/services/mock-data.service"
import { loadIndicadorPagamentosFromSupabase } from "@/lib/services/supabase-data.service"
import type { Pagamento, PagamentoStatus } from "@/types"
import { Wallet, Receipt, Calendar, ArrowUpRight, ExternalLink } from "lucide-react"

function tituloReferencia(p: Pagamento): string {
  if (p.kind === "pix_withdrawal") return "Saque Pix"
  return p.indicacao?.nomeIndicado ?? "Indicação"
}

function subtituloReferencia(p: Pagamento): string {
  if (p.kind === "pix_withdrawal") {
    const ch = p.pixChaveSnapshot ? `Chave: ${p.pixChaveSnapshot}` : "Resgate na carteira"
    return ch
  }
  return p.indicacao?.plano?.nome ?? "Plano"
}

export default function PagamentosPage() {
  const [remotos, setRemotos] = useState<Pagamento[] | null>(null)

  useEffect(() => {
    if (isDataProviderMock()) {
      if (process.env.NODE_ENV === "development") {
        const total = pagamentos.filter((p) => p.indicadorId === currentIndicador.id).length
        console.log("[page-data:debug]", { page: "/indicador/pagamentos", source: "mock", total })
      }
      setRemotos(null)
      return
    }
    void (async () => {
      const lista = await loadIndicadorPagamentosFromSupabase()
      if (process.env.NODE_ENV === "development") {
        console.log("[page-data:debug]", {
          page: "/indicador/pagamentos",
          source: "supabase",
          total: lista?.length ?? 0,
        })
      }
      setRemotos(lista ?? [])
    })()
  }, [])

  const meusPagamentos = useMemo(() => {
    const base = isDataProviderMock()
      ? pagamentos.filter((p) => p.indicadorId === currentIndicador.id)
      : (remotos ?? [])
    return [...base].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [remotos])

  const totalPago = meusPagamentos
    .filter((p) => p.status === "pago")
    .reduce((acc, p) => acc + p.valor, 0)

  const totalPendente = meusPagamentos
    .filter((p) => p.status === "pendente" || p.status === "aprovado")
    .reduce((acc, p) => acc + p.valor, 0)

  return (
    <div>
      <PageHeader
        title="Meus pagamentos"
        description="Histórico de pagamentos e saques Pix"
      >
        <Button variant="outline" asChild>
          <Link href="/indicador/carteira">
            <ArrowUpRight className="w-4 h-4 mr-2" />
            Carteira
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-success" />
            </div>
            <span className="text-sm text-muted-foreground">Total pago</span>
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
            <span className="text-sm text-muted-foreground">Em análise / aprovado</span>
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
              <Receipt className="w-5 h-5 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">Registros</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{meusPagamentos.length}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Referência
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
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Detalhes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {meusPagamentos.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
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
                        {tituloReferencia(pagamento)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {subtituloReferencia(pagamento)}
                      </p>
                      {pagamento.status === "rejeitado" && pagamento.motivoRejeicao && (
                        <p className="text-xs text-destructive mt-1">
                          Motivo: {pagamento.motivoRejeicao}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-foreground">
                      R${" "}
                      {pagamento.valor.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-sm">
                        <span className="text-foreground capitalize">{pagamento.tipo}</span>
                        {pagamento.kind === "pix_withdrawal" && (
                          <span className="text-xs text-muted-foreground">Saque Pix</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {pagamento.dataVencimento.toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {pagamento.dataPagamento
                        ? pagamento.dataPagamento.toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={pagamento.status as PagamentoStatus} />
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {pagamento.comprovanteUrl ? (
                        <a
                          href={pagamento.comprovanteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Comprovante
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
