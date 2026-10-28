/**
 * Sprint 3.1E-AU — apresentação do bloco por contrato (puro).
 * Um card por contrato; todas as faturas dentro. Faixa de 15 dias é só visual
 * (FIFTEEN_DAY_BAND_WRITES_ERP=NO). Não expõe dados além da listagem atual.
 */
import {
  COLLECTION_WORK_STATUS_LABEL,
  contractCardStates,
  type ContractCardVisualState,
} from "@/lib/collections/operational-model"
import type { NextBatchSummary } from "@/lib/collections/next-batch"
import { CONSOLIDATED_HISTORY_NOTICE } from "@/lib/collections/consolidation"
import type { CollectionCaseInvoiceItem, CollectionCaseListItem } from "@/types/collections"

export const INVOICE_PAYMENT_LABEL: Record<CollectionCaseInvoiceItem["paymentStatus"], string> = {
  open: "Pendente",
  paid: "Pagamento detectado",
  cancelled_contract: "Contrato cancelado (não é pagamento)",
  inconclusive: "Inconclusivo",
}

export type ContractCardView = {
  key: string
  caseId: string
  contractLabel: string
  statusLabel: string
  states: ContractCardVisualState[]
  oldestDueDate: string | null
  maxDaysOverdue: number | null
  overdueCount: number
  paidCount: number
  assigneeName: string | null
  lastContactAt: string | null
  followUpDueAt: string | null
  priority: "alta" | "normal"
  invoices: Array<CollectionCaseInvoiceItem & { paymentLabel: string }>
  /** 3.1E-AW: aviso "Histórico consolidado" (sem IDs). */
  consolidatedNotice: string | null
}

export function buildContractCardView(item: CollectionCaseListItem, now: Date = new Date()): ContractCardView {
  const invoices = (item.invoices ?? []).map((inv) => ({
    ...inv,
    paymentLabel: INVOICE_PAYMENT_LABEL[inv.paymentStatus] ?? "Inconclusivo",
  }))
  const paidCount = invoices.filter((i) => i.paymentStatus === "paid").length
  const overdueCount = invoices.filter((i) => i.paymentStatus === "open").length
  const days = invoices
    .filter((i) => i.paymentStatus !== "paid")
    .map((i) => i.daysOverdue)
    .filter((d): d is number => typeof d === "number")
  const maxDaysOverdue = days.length ? Math.max(...days) : item.daysOverdue ?? null
  const dues = invoices
    .filter((i) => i.paymentStatus !== "paid")
    .map((i) => i.dueDate)
    .filter((d): d is string => !!d)
    .sort()
  const followUpExpired =
    !!item.followUpDueAt && Number.isFinite(Date.parse(item.followUpDueAt)) && Date.parse(item.followUpDueAt) <= now.getTime()
  return {
    key: item.id,
    caseId: item.id,
    contractLabel: item.contractPk ? `Contrato ${item.contractPk}` : "Contrato não comprovado",
    statusLabel: COLLECTION_WORK_STATUS_LABEL[item.status] ?? item.status,
    states: contractCardStates({
      contractStatus: item.contractStatus ?? null,
      maxDaysOverdue,
      paidCount,
      openCount: invoices.length - paidCount,
    }),
    oldestDueDate: dues[0] ?? item.overdueSince ?? null,
    maxDaysOverdue,
    overdueCount,
    paidCount,
    assigneeName: item.assigneeName,
    lastContactAt: item.lastContactAt,
    followUpDueAt: item.followUpDueAt ?? null,
    priority: followUpExpired || (maxDaysOverdue ?? 0) >= 15 ? "alta" : "normal",
    invoices,
    consolidatedNotice: (item.consolidatedCaseCount ?? 0) > 0 ? CONSOLIDATED_HISTORY_NOTICE : null,
  }
}

export function nextBatchButtonState(input: {
  summary: Pick<NextBatchSummary, "available" | "busy"> | null
  submitting: boolean
  loading?: boolean
}): { disabled: boolean; label: string; reason: string | null } {
  const base = "Carregar próxima leva"
  if (input.submitting) return { disabled: true, label: "Carregando…", reason: "Solicitação em andamento." }
  if (input.loading) return { disabled: true, label: base, reason: "Carregando capacidade…" }
  if (!input.summary) return { disabled: true, label: base, reason: "Capacidade indisponível." }
  if (input.summary.busy) return { disabled: true, label: base, reason: "Leva em execução." }
  if (input.summary.available <= 0) {
    return { disabled: true, label: base, reason: "Capacidade cheia." }
  }
  return { disabled: false, label: `Carregar até ${input.summary.available}`, reason: null }
}

/** Toast agregado, sem IDs e sem PII. */
export function nextBatchToast(body: Record<string, unknown> | null): string {
  if (!body) return "Falha ao carregar próxima leva."
  if (body.ok !== true) return String(body.message ?? "Falha ao carregar próxima leva.")
  const n = Number(body.contractsAdmitted ?? 0)
  const att = Number(body.invoicesUpdatedOrAttached ?? 0)
  const cap = body.capacityReached === true ? " Capacidade atingida." : ""
  return `Próxima leva: ${n} novo(s) contrato(s), ${att} fatura(s) vinculada(s)/atualizada(s).${cap}`
}
