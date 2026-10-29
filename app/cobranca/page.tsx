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
  readNextBatchProgress,
  readResumableOperation,
  type NextBatchProgressView,
} from "@/lib/collections/contract-card"
import { CONTRACT_SCOPE_NOTICE } from "@/lib/collections/operational-model"
import { nextBatchConfirmMessage, readCapacitySummaryResponse } from "@/lib/collections/next-batch"
import {
  CASES_URL,
  NEXT_BATCH_URL,
  STALE_SUMMARY_MESSAGE,
  driveBatchSegments,
  readySummary,
  refreshServerState,
  summaryFromRefresh,
  type ServerRefreshResult,
  type SummaryViewState,
} from "@/lib/collections/server-refresh"

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
  // 3.1E-BD: "refreshing"/"stale" nunca exibem números antigos como atuais.
  const [summaryState, setSummaryState] = useState<SummaryViewState>({ status: "loading" })
  const summary = readySummary(summaryState)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const stopAfterCurrent = useRef(false)
  const [stopRequested, setStopRequested] = useState(false)
  const [progress, setProgress] = useState<NextBatchProgressView | null>(null)
  // 3.1E-BB: estado durável lido do servidor (fonte da verdade); sem auto-continuar.
  const [pendingOp, setPendingOp] = useState<{ id: string; nextSegment: number } | null>(null)

  const applyOperation = useCallback((op: Record<string, unknown> | null) => {
    setPendingOp(readResumableOperation(op))
    if (op && typeof op.segment === "number" && op.segment > 0) setProgress(readNextBatchProgress(op, false))
  }, [])

  const loadSummary = useCallback(async () => {
    setSummaryState({ status: "loading" })
    try {
      const res = await fetch(NEXT_BATCH_URL, { cache: "no-store" })
      const json = await res.json().catch(() => null)
      setSummaryState(readCapacitySummaryResponse(res.ok, json))
      applyOperation((json?.operation ?? null) as Record<string, unknown> | null)
    } catch {
      setSummaryState(readCapacitySummaryResponse(false, null))
    }
  }, [applyOperation])

  const load = useCallback(async () => {
    setLoading(true)
    let json: Record<string, unknown> | null = null
    let ok = false
    try {
      const res = await fetch(CASES_URL, { cache: "no-store" })
      json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      ok = res.ok && json?.ok === true
    } catch {
      ok = false
    }
    if (!ok || !json) {
      toast.error(String(json?.message ?? "") || "Não foi possível carregar a Cobrança.")
      setLoading(false)
      return
    }
    setItems((json.items ?? []) as CollectionCaseListItem[])
    setDashboard(json.dashboard as typeof dashboard)
    setKind(String(json.kind ?? "member"))
    setLoading(false)
    if (json.kind === "admin_master") void loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSummary])

  /**
   * 3.1E-BD: refetch do servidor (resumo + operação durável + blocos). Só GET:
   * nenhum segmento, nenhuma chamada ao ERP. Falha => "Resumo desatualizado".
   */
  const refreshAll = useCallback(async (): Promise<ServerRefreshResult> => {
    setSummaryState({ status: "refreshing" })
    const r = await refreshServerState((url, init) => fetch(url, init))
    setSummaryState(summaryFromRefresh(r))
    if (r.ok) {
      applyOperation(r.operation)
      setItems(r.cases.items as CollectionCaseListItem[])
      if (r.cases.dashboard) setDashboard(r.cases.dashboard as typeof dashboard)
      setKind(r.cases.kind)
    }
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyOperation])

  useEffect(() => {
    void load()
  }, [load])

  async function loadNextBatch() {
    if (inFlight.current || !summary) return
    const button = nextBatchButtonState({ summary, submitting, loading: summaryState.status !== "ready" })
    if (button.disabled) return
    // Uma confirmação humana => até maxSegments (servidor) segmentos sequenciais. Sem retry.
    if (!window.confirm(nextBatchConfirmMessage(summary.availableCapacity))) return
    await runSegments({ confirm: true })
  }

  /** Retomada EXPLÍCITA de uma operação durável ainda válida (awaiting_next). */
  async function resumeOperation() {
    if (inFlight.current || !pendingOp || summaryState.status !== "ready") return
    if (!window.confirm("Retomar a operação de próxima leva a partir do próximo segmento?")) return
    await runSegments({ batchOperationId: pendingOp.id, segment: pendingOp.nextSegment })
  }

  async function stopPendingOperation() {
    if (inFlight.current || !pendingOp) return
    const res = await fetch(NEXT_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchOperationId: pendingOp.id, stop: true }),
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    setProgress(readNextBatchProgress(json, false))
    setPendingOp(null)
    await refreshAll()
  }

  async function runSegments(initial: Record<string, unknown>) {
    inFlight.current = true
    stopAfterCurrent.current = false
    setStopRequested(false)
    setSubmitting(true)
    setPendingOp(null)
    let last: Record<string, unknown> | null = null
    let refreshFailed = false
    try {
      const out = await driveBatchSegments({
        initial,
        post: async (payload) => {
          const res = await fetch(NEXT_BATCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          return { httpOk: res.ok, json: (await res.json().catch(() => null)) as Record<string, unknown> | null }
        },
        refresh: refreshAll,
        onSegment: (json, running) => setProgress(readNextBatchProgress(json, running)),
        onRefreshing: () => undefined,
        onRefreshed: () => undefined,
        stopRequested: () => stopAfterCurrent.current,
      })
      last = out.last
      refreshFailed = out.refreshFailed
      const message = nextBatchToast(last)
      const discoveryStatus = String(last?.discoveryStatus ?? "")
      if (last?.ok && discoveryStatus !== "failed") toast.success(message)
      else toast.message(message)
      if (refreshFailed) toast.message(STALE_SUMMARY_MESSAGE)
    } finally {
      inFlight.current = false
      setSubmitting(false)
      setProgress((p) => (p ? { ...p, running: false } : p))
    }
  }

  const cards = items.map((item) => buildContractCardView(item))
  const button = nextBatchButtonState({ summary, submitting, loading: summaryState.status !== "ready" })

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
        {kind === "admin_master" && submitting ? (
          <Button
            variant="outline"
            onClick={() => {
              stopAfterCurrent.current = true
              setStopRequested(true)
            }}
            disabled={stopRequested}
            data-testid="next-batch-stop-button"
          >
            Parar após o segmento atual
          </Button>
        ) : null}
        {kind === "admin_master" && !submitting && pendingOp && summaryState.status === "ready" ? (
          <>
            <Button variant="outline" onClick={() => void resumeOperation()} data-testid="next-batch-resume-button">
              Retomar operação (segmento {pendingOp.nextSegment})
            </Button>
            <Button variant="outline" onClick={() => void stopPendingOperation()} data-testid="next-batch-stop-pending-button">
              Parar operação
            </Button>
          </>
        ) : null}
      </PageHeader>

      {kind === "admin_master" && progress ? (
        <div className="mb-4 rounded-lg border bg-card p-4 text-sm" data-testid="next-batch-progress">
          <p>
            Segmento {progress.segment} de {progress.maxSegments}
            {progress.running ? " (em andamento)" : ""}
          </p>
          <p>Faturas analisadas: {progress.scannedInvoices}</p>
          <p>Contratos novos: {progress.newContracts}</p>
          <p>Faturas de contratos existentes: {progress.existingContractInvoices}</p>
          <p>Vagas restantes: {progress.remainingSlots ?? "—"}</p>
          {progress.stopReasonLabel ? <p>Motivo da parada: {progress.stopReasonLabel}</p> : null}
        </div>
      ) : null}

      {kind === "admin_master" ? (
        <div className="mb-4 rounded-lg border bg-card p-4 text-sm" data-testid="next-batch-summary">
          {summary ? (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <p>Capacidade: <strong>{summary.configuredCapacity}</strong> contratos</p>
              <p>Ocupando vagas: <strong>{summary.activeContracts}</strong></p>
              <p>Vagas disponíveis: <strong>{summary.availableCapacity}</strong></p>
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
          ) : summaryState.status === "loading" ? (
            <p className="text-muted-foreground" data-testid="next-batch-summary-loading">Carregando capacidade…</p>
          ) : summaryState.status === "refreshing" ? (
            <p className="text-muted-foreground" data-testid="next-batch-summary-updating">Atualizando capacidade…</p>
          ) : summaryState.status === "stale" ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="next-batch-summary-stale">
              <p className="text-muted-foreground">{STALE_SUMMARY_MESSAGE}</p>
              <Button size="sm" variant="outline" onClick={() => void refreshAll()} disabled={submitting}>
                Atualizar resumo
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2" data-testid="next-batch-summary-error">
              <p className="text-muted-foreground">
                {summaryState.status === "error" ? summaryState.message : "Capacidade por contrato indisponível."}
              </p>
              <Button size="sm" variant="outline" onClick={() => void loadSummary()}>
                Atualizar resumo
              </Button>
            </div>
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
              {card.consolidatedNotice ? (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="contract-consolidated-notice">
                  {card.consolidatedNotice}
                </p>
              ) : null}
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
