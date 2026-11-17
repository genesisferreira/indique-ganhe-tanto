"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  AUTH_DELETE_CONFIRMATION,
  CONTROLLR_WARNING,
  DEACTIVATE_CONFIRMATION,
  FINANCE_CONFIRMATION,
  INDICATOR_CONFIRMATION,
  PRESERVE_MESSAGE,
  REFERRAL_CONFIRMATION,
  bulkConfirmation,
} from "@/lib/admin-deletion/contract"

type Kind = "referral" | "indicator" | "bulk"

function newKey() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40)
}

async function postDeletion(action: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/admin/deletions?action=${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({ ok: false, code: "unavailable" }))
  return { ok: response.ok && body?.ok === true, body }
}

export function ControlledDeletionButton({
  kind,
  ids,
  enabled,
  label,
  onCompleted,
}: {
  kind: Kind
  ids: string[]
  enabled: boolean
  label: string
  onCompleted?: () => void
}) {
  const keyRef = useRef(newKey())
  const busy = useRef(false)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [authConfirmation, setAuthConfirmation] = useState("")
  const [financeConfirmation, setFinanceConfirmation] = useState("")
  const [dropAuth, setDropAuth] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const expected = kind === "referral"
    ? REFERRAL_CONFIRMATION
    : kind === "bulk"
      ? bulkConfirmation(ids.length)
      : INDICATOR_CONFIRMATION
  const blocked = preview?.canHardDelete !== true

  async function openPreview() {
    if (!enabled || ids.length === 0 || busy.current) return
    keyRef.current = newKey()
    setReason("")
    setConfirmation("")
    setAuthConfirmation("")
    setFinanceConfirmation("")
    setDropAuth(false)
    setMessage(null)
    setPreview(null)
    setOpen(true)
    const payload = kind === "indicator"
      ? { indicatorId: ids[0] }
      : kind === "bulk"
        ? { referralIds: ids }
        : { referralId: ids[0] }
    const action = kind === "indicator" ? "preview_indicator" : kind === "bulk" ? "preview_bulk" : "preview_referral"
    const result = await postDeletion(action, payload)
    if (!result.ok) {
      setMessage("Não foi possível montar a prévia.")
      return
    }
    setPreview(result.body)
  }

  async function commit(mode: "hard_delete" | "deactivate") {
    if (busy.current) return
    busy.current = true
    setSending(true)
    setMessage(null)
    try {
      const phrase = mode === "deactivate" ? DEACTIVATE_CONFIRMATION : expected
      if (confirmation.trim() !== phrase) {
        setMessage("A confirmação digitada não confere.")
        return
      }
      const common = { reason, confirmation: phrase, idempotencyKey: keyRef.current, financeConfirmation: financeConfirmation || null }
      const action = mode === "deactivate"
        ? kind === "indicator" ? "commit_indicator" : "deactivate_referral"
        : kind === "indicator" ? "commit_indicator" : kind === "bulk" ? "delete_bulk" : "delete_referral"
      const payload = kind === "indicator"
        ? { ...common, indicatorId: ids[0], mode, authConfirmation: dropAuth ? authConfirmation.trim() : null }
        : kind === "bulk"
          ? { ...common, referralIds: ids }
          : { ...common, referralId: ids[0] }
      const result = await postDeletion(action, payload)
      if (!result.ok) {
        setMessage(result.body?.code === "confirmation_mismatch"
          ? "A confirmação digitada não confere."
          : result.body?.code === "reason_invalid" || result.body?.code === "reason_too_short"
            ? "Informe um motivo detalhado, sem documento ou e-mail. Registro real exige pelo menos 40 caracteres."
            : result.body?.code === "finance_confirmation_required" || result.body?.code === "finance_confirmation_mismatch"
              ? "A limpeza financeira exige a confirmação adicional."
            : "A exclusão não foi concluída. Nenhum dado financeiro foi apagado.")
        return
      }
      setOpen(false)
      onCompleted?.()
    } finally {
      busy.current = false
      setSending(false)
    }
  }

  const blockers = Array.isArray(preview?.blockers) ? preview.blockers.map(String) : []

  return (
    <>
      <Button type="button" variant="outline" className="text-destructive" disabled={!enabled || ids.length === 0} onClick={() => void openPreview()}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Prévia do impacto</DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className="grid gap-3 text-sm">
              {preview.controllrInterest === true || preview.controllrWarning ? <p className="font-medium">{CONTROLLR_WARNING}</p> : null}
              {blocked ? <p>{PRESERVE_MESSAGE}</p> : <p>A exclusão definitiva está disponível. O Controllr não será alterado.</p>}
              <ul className="grid gap-1 text-muted-foreground">
                {preview.classification ? <li>Classificação: {String(preview.classification)}</li> : null}
                {preview.externalPayment === true ? <li>Pagamento externo comprovado: sim</li> : <li>Pagamento externo comprovado: não</li>}
                {preview.masked ? <li>Indicação: {String(preview.masked)}</li> : null}
                {preview.origin ? <li>Origem: {String(preview.origin)}</li> : null}
                {preview.originatorMasked ? <li>Originador: {String(preview.originatorMasked)}</li> : null}
                {preview.rewards != null ? <li>Rewards: {String(preview.rewards)}</li> : null}
                {preview.wallet != null ? <li>Carteira: {String(preview.wallet)}</li> : null}
                {preview.payments != null ? <li>Pagamentos: {String(preview.payments)}</li> : null}
                {preview.withdrawals != null ? <li>Saques: {String(preview.withdrawals)}</li> : null}
                {preview.pendingOperations != null ? <li>Operações pendentes: {String(preview.pendingOperations)}</li> : null}
                {preview.contractOrInvoice != null ? <li>Contrato ou fatura: {String(preview.contractOrInvoice)}</li> : null}
                {preview.notifications != null ? <li>Notificações: {String(preview.notifications)}</li> : null}
                {preview.operationalEvents != null ? <li>Eventos operacionais: {String(preview.operationalEvents)}</li> : null}
                {preview.referrals != null ? <li>Indicações: {String(preview.referrals)}</li> : null}
                {preview.activeLinks != null ? <li>Links ativos: {String(preview.activeLinks)}</li> : null}
                {preview.revokedLinks != null ? <li>Links revogados: {String(preview.revokedLinks)}</li> : null}
                {preview.count != null ? <li>Selecionadas: {String(preview.count)}</li> : null}
                {preview.blocked != null ? <li>Bloqueadas: {String(preview.blocked)}</li> : null}
              </ul>
              {blockers.length > 0 ? <p>Bloqueios: {blockers.join(", ")}</p> : null}
              <div className="grid gap-1.5">
                <Label htmlFor="deletion-reason">Motivo</Label>
                <Textarea id="deletion-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              </div>
              {preview.financeConfirmationRequired === true && !blocked ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="deletion-finance-confirmation">Digite {FINANCE_CONFIRMATION}</Label>
                  <Input id="deletion-finance-confirmation" value={financeConfirmation} onChange={(event) => setFinanceConfirmation(event.target.value)} autoComplete="off" />
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="deletion-confirmation">Digite {blocked ? DEACTIVATE_CONFIRMATION : expected}</Label>
                <Input id="deletion-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
              </div>
              {kind === "indicator" && !blocked ? (
                <label className="flex items-start gap-2" htmlFor="deletion-auth">
                  <Checkbox id="deletion-auth" checked={dropAuth} onCheckedChange={(value) => setDropAuth(value === true)} />
                  <span>Excluir dados do CRM e excluir conta de acesso. Sem esta opção, o acesso permanece desativado.</span>
                </label>
              ) : null}
              {dropAuth ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="deletion-auth-confirmation">Digite {AUTH_DELETE_CONFIRMATION}</Label>
                  <Input id="deletion-auth-confirmation" value={authConfirmation} onChange={(event) => setAuthConfirmation(event.target.value)} autoComplete="off" />
                </div>
              ) : null}
            </div>
          ) : <p className="text-sm text-muted-foreground">Carregando a prévia…</p>}
          {message ? <p className="text-sm text-destructive" role="status">{message}</p> : null}
          <DialogFooter className="gap-2">
            {blocked ? (
              <Button type="button" variant="outline" disabled={sending || !preview} onClick={() => void commit("deactivate")}>Desativar</Button>
            ) : (
              <Button type="button" variant="destructive" disabled={sending || !preview} onClick={() => void commit("hard_delete")}>
                {dropAuth ? "Excluir dados e conta" : kind === "indicator" ? "Excluir dados e manter acesso desativado" : "Excluir"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
