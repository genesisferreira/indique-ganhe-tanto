"use client"

import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { pagamentos, currentIndicador } from "@/lib/mock-data"
import { FileText, Download, Calendar, Wallet, Eye } from "lucide-react"

export default function ComprovantesPage() {
  const comprovantes = pagamentos.filter(
    (p) => p.indicadorId === currentIndicador.id && p.comprovanteUrl
  )

  return (
    <div>
      <PageHeader
        title="Meus Comprovantes"
        description="Comprovantes de pagamentos enviados pela Tanto Telecom"
      />

      {comprovantes.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
            <FileText className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Nenhum comprovante disponível
          </h3>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Os comprovantes de pagamento aparecerão aqui após a confirmação dos
            seus resgates.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {comprovantes.map((pagamento) => (
            <div
              key={pagamento.id}
              className="rounded-xl border bg-card p-5 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-primary" />
                </div>
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-success/10 text-success">
                  Pago
                </span>
              </div>

              <h3 className="font-semibold text-foreground mb-1">
                {pagamento.indicacao.nomeIndicado}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {pagamento.indicacao.plano.nome}
              </p>

              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Wallet className="w-4 h-4" />
                    <span>Valor</span>
                  </div>
                  <span className="font-semibold text-foreground">
                    R${" "}
                    {pagamento.valor.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>Data</span>
                  </div>
                  <span className="text-foreground">
                    {pagamento.dataPagamento?.toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <Eye className="w-4 h-4 mr-1" />
                  Visualizar
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  <Download className="w-4 h-4 mr-1" />
                  Baixar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
