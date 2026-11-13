"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { selectClass } from "@/components/compensation-config/ui"
import { EMPLOYEE_STATUS_LABEL, type EmployeeListItem } from "@/lib/compensation-config/contract"
import {
  COMPETENCE_STATUS_LABEL,
  MANUAL_LINE_LABEL,
  MANUAL_LINE_TYPES,
  newIdempotencyKey,
  type CompetenceDetail,
  type CompetenceListItem,
  type ManualLineType,
} from "@/lib/payroll-competence/contract"
import { PAYROLL_ENDPOINT, postPayroll } from "@/lib/payroll-competence/client"
import { J6_ENDPOINT, postCommission } from "@/lib/commission-activation/client"
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/commission-activation/contract"
import { formatCompetence, formatMoney } from "@/lib/employee-portal/format"

function parseMoneyInputLike(raw: string): string | null {
  let s = raw.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "")
  if (!s) return null
  const neg = s.startsWith("-")
  if (neg) s = s.slice(1)
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".")
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null
  const [i, f = ""] = s.split(".")
  const out = `${neg ? "-" : ""}${String(parseInt(i, 10))}.${f.padEnd(2, "0")}`
  return out === "0.00" || out === "-0.00" ? null : out
}

export function CompetenceBoard({
  employees,
  items,
  detail,
  employeeId,
  month,
}: {
  employees: EmployeeListItem[]
  items: CompetenceListItem[]
  detail: CompetenceDetail | null
  employeeId: string | null
  month: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [adjType, setAdjType] = useState<ManualLineType>("other_earning")
  const [adjAmount, setAdjAmount] = useState("")
  const [adjVisible, setAdjVisible] = useState(true)
  const [adjReason, setAdjReason] = useState("")

  function go(emp: string, m: string, id?: string) {
    const q = new URLSearchParams()
    if (emp) q.set("funcionario", emp)
    if (m) q.set("competencia", m)
    if (id) q.set("id", id)
    router.push(`/admin/remuneracao/competencias?${q.toString()}`)
  }

  async function run(endpoint: (typeof PAYROLL_ENDPOINT)[keyof typeof PAYROLL_ENDPOINT], payload: Record<string, unknown>, okMsg: string) {
    setError(null)
    setSubmitting(true)
    const r = await postPayroll(endpoint, { idempotencyKey: newIdempotencyKey(), ...payload })
    setSubmitting(false)
    if (!r.ok) return setError(r.message)
    setNotice(okMsg)
    router.refresh()
  }

  const st = detail?.status
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pc-emp">Funcionário</Label>
          <select id="pc-emp" className={selectClass} value={employeeId ?? ""} onChange={(e) => go(e.target.value, month)}>
            <option value="">Todos</option>
            {employees.map((e) => (
              <option key={e.employeeId} value={e.employeeId}>{e.name} — {EMPLOYEE_STATUS_LABEL[e.status] ?? e.status}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pc-month">Competência</Label>
          <input id="pc-month" type="month" className={selectClass} value={month.slice(0, 7)} onChange={(e) => go(employeeId ?? "", e.target.value ? `${e.target.value}-01` : month)} />
        </div>
      </div>
      {notice ? <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      {employeeId ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={submitting} onClick={() => run(PAYROLL_ENDPOINT.open, { employeeId, competenceMonth: month }, "Competência aberta em rascunho. Nenhum pagamento.")}>
            Abrir competência
          </Button>
        </div>
      ) : null}

      <ul className="space-y-2">
        {items.length === 0 ? <li className="text-sm text-muted-foreground">Nenhuma competência neste filtro.</li> : null}
        {items.map((c) => (
          <li key={c.competenceId}>
            <button type="button" className={`w-full rounded-xl border px-4 py-3 text-left text-sm ${detail?.competenceId === c.competenceId ? "border-primary/50 bg-primary/10" : "border-border/50 bg-card/40"}`} onClick={() => go(c.employeeId, c.competenceMonth, c.competenceId)}>
              <span className="font-medium">{c.employeeName}</span> · {formatCompetence(c.competenceMonth)} · {COMPETENCE_STATUS_LABEL[c.status] ?? c.status}
              <span className="mt-1 block tabular-nums text-muted-foreground">Líquido {formatMoney(c.netTotal)} · Comissão {formatMoney(c.commissionTotal)}</span>
            </button>
          </li>
        ))}
      </ul>

      {detail ? (
        <section className="space-y-4 rounded-xl border border-border/50 bg-card/50 p-4">
          <h2 className="text-lg font-semibold">{detail.employeeName} · {formatCompetence(detail.competenceMonth)} · {COMPETENCE_STATUS_LABEL[detail.status] ?? detail.status} v{detail.version}</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Bruto</dt><dd className="tabular-nums">{formatMoney(detail.totals.gross)}</dd></div>
            <div><dt className="text-muted-foreground">Descontos</dt><dd className="tabular-nums">{formatMoney(detail.totals.discounts)}</dd></div>
            <div><dt className="text-muted-foreground">Líquido</dt><dd className="font-semibold tabular-nums">{formatMoney(detail.totals.net)}</dd></div>
            <div><dt className="text-muted-foreground">Comissão</dt><dd className="tabular-nums">{formatMoney(detail.totals.commission)}</dd></div>
            {detail.paidOn ? <div><dt className="text-muted-foreground">Pagamento registrado</dt><dd>{detail.paidOn}{detail.paymentReversed ? " · estornado" : ""}</dd></div> : null}
          </dl>
          <ul className="divide-y divide-border/40 rounded-lg border text-sm">
            {detail.lines.length === 0 ? <li className="px-3 py-2 text-muted-foreground">Nenhuma linha. Calcule para gerar salário/benefícios.</li> : null}
            {detail.lines.map((l) => (
              <li key={l.lineId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{l.description}{l.visibleToEmployee ? "" : " · oculto do funcionário"}</span>
                <span className="tabular-nums">{formatMoney(l.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {st === "draft" || st === "calculated" ? (
              <Button type="button" size="sm" disabled={submitting} onClick={() => run(PAYROLL_ENDPOINT.calculate, { competenceId: detail.competenceId }, "Cálculo gravado. Comissão permanece zero.")}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Calcular
              </Button>
            ) : null}
            {st === "calculated" ? (
              <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => run(PAYROLL_ENDPOINT.review, { competenceId: detail.competenceId }, "Competência em revisão. Dias bloqueados.")}>Enviar para revisão</Button>
            ) : null}
            {st === "under_review" ? (
              <div className="w-full space-y-2">
                <Label htmlFor="pc-close">Motivo do fechamento (mín. 20)</Label>
                <Textarea id="pc-close" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button type="button" size="sm" disabled={submitting} onClick={() => run(PAYROLL_ENDPOINT.close, { competenceId: detail.competenceId, reason }, "Competência fechada. Nenhum pagamento registrado.")}>Fechar competência</Button>
              </div>
            ) : null}
            {st === "closed" ? (
              <PaymentAndReopen detailId={detail.competenceId} reason={reason} setReason={setReason} submitting={submitting} setError={setError} setNotice={setNotice} onRefresh={() => router.refresh()} onReopen={() => run(PAYROLL_ENDPOINT.reopen, { competenceId: detail.competenceId, reason }, "Nova versão em rascunho. A fechada permanece no histórico.")} />
            ) : null}
            {st === "paid" ? (
              <ReversePayment detailId={detail.competenceId} reversed={detail.paymentReversed} submitting={submitting} setError={setError} setNotice={setNotice} onRefresh={() => router.refresh()} />
            ) : null}
          </div>
          {st && st !== "closed" && st !== "paid" ? (
            <fieldset className="space-y-2 rounded-lg border border-border/40 p-3">
              <legend className="text-sm font-medium">Ajuste manual (não apaga linhas anteriores)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={selectClass} value={adjType} onChange={(e) => setAdjType(e.target.value as ManualLineType)}>
                  {MANUAL_LINE_TYPES.map((t) => <option key={t} value={t}>{MANUAL_LINE_LABEL[t]}</option>)}
                </select>
                <Input inputMode="decimal" placeholder="Valor (ex. 10,00)" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
              </div>
              <Textarea rows={2} maxLength={500} placeholder="Motivo (mínimo 20 caracteres)" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={adjVisible} onChange={(e) => setAdjVisible(e.target.checked)} />
                Visível ao funcionário
              </label>
              <Button
                type="button"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  const amt = parseMoneyInputLike(adjAmount)
                  if (!amt) return setError("Informe um valor diferente de zero.")
                  return run(PAYROLL_ENDPOINT.adjust, {
                    competenceId: detail.competenceId,
                    lineType: adjType,
                    amount: amt,
                    reason: adjReason.trim(),
                    visibleToEmployee: adjVisible,
                  }, "Ajuste lançado. Correção futura exige nova linha, sem apagar.")
                }}
              >
                Lançar ajuste
              </Button>
            </fieldset>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function PaymentAndReopen({
  detailId, reason, setReason, submitting, setError, setNotice, onRefresh, onReopen,
}: {
  detailId: string
  reason: string
  setReason: (v: string) => void
  submitting: boolean
  setError: (v: string | null) => void
  setNotice: (v: string | null) => void
  onRefresh: () => void
  onReopen: () => void
}) {
  const [paidOn, setPaidOn] = useState("")
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [payReason, setPayReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="w-full space-y-4">
      <fieldset className="space-y-2 rounded-lg border border-border/40 p-3">
        <legend className="text-sm font-medium">Registrar pagamento</legend>
        <p className="text-xs text-muted-foreground">Não transfere dinheiro, não chama Pix e não usa carteira. Apenas registra a competência como paga.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pc-paid-on">Data do pagamento</Label>
            <Input id="pc-paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pc-pay-method">Método</Label>
            <select id="pc-pay-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
            </select>
          </div>
        </div>
        <Input placeholder="Referência (opcional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Textarea rows={2} maxLength={500} placeholder="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Textarea rows={2} maxLength={500} placeholder="Motivo obrigatório (mín. 20)" value={payReason} onChange={(e) => setPayReason(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          Confirmo o registro manual deste pagamento
        </label>
        <Button type="button" size="sm" disabled={busy || submitting} onClick={async () => {
          setError(null); setBusy(true)
          const r = await postCommission(J6_ENDPOINT.pay, {
            idempotencyKey: newIdempotencyKey(), competenceId: detailId, paidOn, method,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            reason: payReason.trim(), confirmed,
          })
          setBusy(false)
          if (!r.ok) return setError(r.message)
          setNotice("Pagamento registrado. Nenhum dinheiro foi transferido.")
          onRefresh()
        }}>Registrar pagamento</Button>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="pc-reopen">Motivo da reabertura (mín. 20)</Label>
        <Textarea id="pc-reopen" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={onReopen}>Reabrir (nova versão)</Button>
      </div>
    </div>
  )
}

function ReversePayment({
  detailId, reversed, submitting, setError, setNotice, onRefresh,
}: {
  detailId: string
  reversed: boolean
  submitting: boolean
  setError: (v: string | null) => void
  setNotice: (v: string | null) => void
  onRefresh: () => void
}) {
  const [revReason, setRevReason] = useState("")
  const [busy, setBusy] = useState(false)
  if (reversed) return <p className="text-sm text-muted-foreground">Pagamento estornado. Correção exige nova versão; o registro pago permanece no histórico.</p>
  return (
    <div className="w-full space-y-2">
      <Label htmlFor="pc-rev">Estorno auditado (mín. 20)</Label>
      <Textarea id="pc-rev" rows={2} maxLength={500} value={revReason} onChange={(e) => setRevReason(e.target.value)} />
      <Button type="button" size="sm" variant="destructive" disabled={busy || submitting} onClick={async () => {
        setError(null); setBusy(true)
        const r = await postCommission(J6_ENDPOINT.reverse, { idempotencyKey: newIdempotencyKey(), competenceId: detailId, reason: revReason.trim() })
        setBusy(false)
        if (!r.ok) return setError(r.message)
        setNotice("Estorno registrado. Nenhum DELETE foi feito.")
        onRefresh()
      }}>Estornar pagamento</Button>
    </div>
  )
}
