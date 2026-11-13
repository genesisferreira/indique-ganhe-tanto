"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { J6_ENDPOINT, postCommission } from "@/lib/commission-activation/client"
import { newIdempotencyKey } from "@/lib/compensation-config/contract"
import { formatMoney } from "@/lib/employee-portal/format"
import { ENTITLEMENT_STATUS_LABEL } from "@/lib/employee-portal/terminology"

type Ent = {
  entitlementId: string
  employeeId: string
  opportunityId: string
  role: string
  status: string
  amount: string | null
  competenceMonth: string | null
  method: string | null
}

function asList(raw: unknown): { items: Ent[]; activeRuleCount: number } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const items = Array.isArray(r.entitlements)
    ? r.entitlements.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map((x) => ({
        entitlementId: String(x.entitlementId ?? ""),
        employeeId: String(x.employeeId ?? ""),
        opportunityId: String(x.opportunityId ?? ""),
        role: String(x.role ?? ""),
        status: String(x.status ?? ""),
        amount: typeof x.amount === "string" ? x.amount : null,
        competenceMonth: typeof x.competenceMonth === "string" ? x.competenceMonth : null,
        method: typeof x.method === "string" ? x.method : null,
      }))
    : []
  return { items, activeRuleCount: typeof r.activeRuleCount === "number" ? r.activeRuleCount : 0 }
}

export function CommissionReconcileBoard({ raw }: { raw: unknown }) {
  const router = useRouter()
  const { items, activeRuleCount } = asList(raw)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [runId, setRunId] = useState<string | null>(null)

  async function reconcile() {
    setError(null)
    setBusy(true)
    const r = await postCommission(J6_ENDPOINT.reconcile, {
      idempotencyKey: newIdempotencyKey(),
      limit: 50,
      ...(runId ? { runId } : {}),
    })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    if (typeof r.body.runId === "string") setRunId(r.body.runId)
    setNotice(`Reconciliação ${String(r.body.status ?? "ok")}. Apurados ${String(r.body.accrued ?? 0)}. ERP ${String(r.body.erpRequests ?? 0)}. Agendador desligado.`)
    router.refresh()
  }

  async function act(kind: "approve" | "include", id: string) {
    setError(null)
    setBusy(true)
    const r = await postCommission(kind === "approve" ? J6_ENDPOINT.entitlement_approve : J6_ENDPOINT.entitlement_include, {
      idempotencyKey: newIdempotencyKey(),
      entitlementId: id,
      reason: reason.trim(),
      ...(kind === "include" ? { visibleToEmployee: true } : {}),
    })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    setNotice(kind === "approve" ? "Direito aprovado manualmente." : "Comissão incluída na competência.")
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        Regras ativas: {activeRuleCount}. Agendador diário: desligado. Nenhuma chamada ERP nesta tela.
      </div>
      {notice ? <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="button" disabled={busy} onClick={reconcile}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Reconciliar comissões
      </Button>
      <p className="text-xs text-muted-foreground">Processamento limitado e retomável. Uma operação por vez. Falha do ERP (quando existir) não altera oportunidade nem competência.</p>
      <div className="space-y-2">
        <Textarea rows={2} maxLength={500} placeholder="Motivo para aprovar ou incluir (mín. 20)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <ul className="space-y-2">
        {items.length === 0 ? <li className="text-sm text-muted-foreground">Nenhum direito de comissão. Modalidades permanecem bloqueadas até a prova financeira.</li> : null}
        {items.map((e) => (
          <li key={e.entitlementId} className="rounded-xl border border-border/50 bg-card/40 px-4 py-3 text-sm">
            <div className="font-medium">{ENTITLEMENT_STATUS_LABEL[e.status] ?? e.status} · {e.method ?? "—"}</div>
            <p className="text-muted-foreground">Competência {e.competenceMonth ?? "—"} · {e.amount ? formatMoney(e.amount) : "sem valor"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {e.status === "accrued" ? <Button type="button" size="sm" disabled={busy} onClick={() => act("approve", e.entitlementId)}>Aprovar</Button> : null}
              {e.status === "approved" ? <Button type="button" size="sm" disabled={busy} onClick={() => act("include", e.entitlementId)}>Incluir na competência</Button> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
