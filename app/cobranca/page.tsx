"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import type { CollectionCaseListItem } from "@/types/collections"
import {
  buildContractCardView,
  nextBatchButtonState,
  nextBatchToast,
} from "@/lib/collections/contract-card"
import { CONTRACT_SCOPE_NOTICE } from "@/lib/collections/operational-model"
import { nextBatchConfirmMessage, type NextBatchSummary } from "@/lib/collections/next-batch"

export default function CobrancaPage() {
  const [items, setItems] = useState<CollectionCaseListItem[]>([])
  const [dashboard, setDashboard] = useState({
    assignedToMe: 0,
    overdue: 0,
    promiseToPay: 0,
    paidToday: 0,
    escalated: 0,
  })
  const [kind, setKind] = useState<string>("member")
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<NextBatchSummary | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  const loadSummary = useCallback(async () => {
    const res = await fetch("/api/admin/collections/next-batch", { cache: "no-store" })
    const json = await res.json().catch(() => null)
    setSummary(res.ok && json?.ok ? (json.summary as NextBatchSummary) : null)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/cobranca/cases", { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível carregar a Cobrança.")
      setLoading(false)
      return
    }
    setItems(json.items ?? [])
    setDashboard(json.dashboard)
    setKind(json.kind ?? "member")
    setLoading(false)
    if (json.kind === "admin_master") void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    void load()
  }, [load])

  async function loadNextBatch() {
    if (inFlight.current || !summary) return
    const button = nextBatchButtonState({ summary, submitting })
    if (button.disabled) return
    if (!window.confirm(nextBatchConfirmMessage(summary.available))) return
    inFlight.current = true
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/collections/next-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      const message = nextBatchToast(json)
      const discoveryStatus = String(json?.discoveryStatus ?? "")
      if (res.ok && json?.ok && discoveryStatus !== "failed") toast.success(message)
      else toast.message(message)
    } finally {
      inFlight.current = false
      setSubmitting(false)
      await load()
    }
  }

  const cards = items.map((item) => buildContractCardView(item))
  const button = nextBatchButtonState({ summary, submitting })

  return (
    <div>
      <PageHeader
        title="Cobrança"
        description="Contratos com faturas de 5 ou mais dias de atraso. A fonte de verdade é o Controllr."
      >
        {kind === "admin_master" ? (
          <Button
            onClick={() => void loadNextBatch()}
            disabled={button.disabled}
            title={button.reason ?? undefined}
            data-testid="next-batch-button"
          >
            {button.label}
          </Button>
        ) : null}
      </PageHeader>

      {kind === "admin_master" ? (
        <div className="mb-4 rounded-lg border bg-card p-4 text-sm" data-testid="next-batch-summary">
          {summary ? (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <p>Capacidade: <strong>{summary.configured}</strong> contratos</p>
              <p>Ocupando vagas: <strong>{summary.occupying}</strong></p>
              <p>Vagas disponíveis: <strong>{summary.available}</strong></p>
              <p>Promessas futuras: <strong>{summary.futurePromises}</strong></p>
              <p>Retornos futuros: <strong>{summary.futureCallbacks}</strong></p>
              <p>
                Execução: <strong>{summary.busy ? "em andamento" : summary.runStatus ?? "nenhuma"}</strong>
                {summary.runPauseStage ? ` (${summary.runPauseStage})` : ""}
              </p>
              <p className="sm:col-span-3 lg:col-span-6 text-muted-foreground">
                Último health probe: {summary.lastHealthProbe ?? "não registrado"}. {summary.erpNotice}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">Capacidade por contrato indisponível.</p>
          )}
        </div>
      ) : null}

      <p className="mb-4 text-xs text-muted-foreground" data-testid="contract-scope-notice">
        {CONTRACT_SCOPE_NOTICE}
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Atribuídos a mim", dashboard.assignedToMe],
          ["Em atraso", dashboard.overdue],
          ["Promessa", dashboard.promiseToPay],
          ["Pagos hoje", dashboard.paidToday],
          ["Escalados", dashboard.escalated],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{loading ? "—" : value}</p>
          </div>
        ))}
      </div>

      {cards.length === 0 && !loading ? (
        <div className="rounded-lg border px-3 py-6 text-sm text-muted-foreground">
          {kind === "admin_master" || kind === "admin_read"
            ? "Nenhum contrato em cobrança. Use “Carregar próxima leva” para buscar contratos inadimplentes."
            : "Nenhum contrato na sua carteira. O motor distribui os contratos entre funcionários ativos de Cobrança."}
        </div>
      ) : (
        <div className="grid gap-4" data-testid="contract-cards">
          {cards.map((card) => (
            <div key={card.key} className="rounded-lg border bg-card p-4" data-testid="contract-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{card.contractLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {card.statusLabel} · Prioridade {card.priority}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {card.states.map((state) => (
                      <span key={state} className="rounded border px-2 py-0.5 text-xs">
                        {state}
                      </span>
                    ))}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/cobranca/${card.caseId}`}>Abrir</Link>
                </Button>
              </div>
              <div className="mt-3 grid gap-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <p>Atraso mais antigo: {card.maxDaysOverdue ?? "—"} dias</p>
                <p>Vencidas: {card.overdueCount}</p>
                <p>Pagas: {card.paidCount}</p>
                <p>Responsável: {card.assigneeName || "—"}</p>
                <p>
                  Último contato:{" "}
                  {card.lastContactAt ? new Date(card.lastContactAt).toLocaleString("pt-BR") : "—"}
                </p>
                <p>
                  Próximo retorno:{" "}
                  {card.followUpDueAt ? new Date(card.followUpDueAt).toLocaleString("pt-BR") : "—"}
                </p>
              </div>
              <div className="mt-3 overflow-x-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-1">Fatura</th>
                      <th className="px-3 py-1">Vencimento</th>
                      <th className="px-3 py-1">Dias de atraso</th>
                      <th className="px-3 py-1">Estado financeiro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.invoices.map((inv) => (
                      <tr key={inv.invoicePk} className="border-t" data-testid="contract-invoice-row">
                        <td className="px-3 py-1">{inv.invoicePk}</td>
                        <td className="px-3 py-1">{inv.dueDate ?? "—"}</td>
                        <td className="px-3 py-1">{inv.daysOverdue ?? "—"}</td>
                        <td className="px-3 py-1">{inv.paymentLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
