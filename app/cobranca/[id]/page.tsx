"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CollectionCase,
  CollectionCaseEvent,
  ContactChannel,
  ContactOutcome,
  OperationalContactAttempt,
} from "@/types/collections"

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  in_contact: "Em contato",
  promise_to_pay: "Promessa de pagamento",
  paid: "Pago",
  unresolved: "Não resolvido",
  escalated_retention: "Escalado (retenção)",
  closed: "Encerrado",
}

function formatMoney(value: number | null) {
  if (value == null) return "—"
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
}

export default function CobrancaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [item, setItem] = useState<CollectionCase | null>(null)
  const [events, setEvents] = useState<CollectionCaseEvent[]>([])
  const [attempts, setAttempts] = useState<OperationalContactAttempt[]>([])
  const [channel, setChannel] = useState<ContactChannel>("phone")
  const [outcome, setOutcome] = useState<ContactOutcome>("contacted")
  const [notes, setNotes] = useState("")
  const [reason, setReason] = useState("")
  const [toEmployeeId, setToEmployeeId] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/cobranca/cases/${id}`, { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Caso não encontrado.")
      return
    }
    setItem(json.case)
    setEvents(json.events ?? [])
    setAttempts(json.attempts ?? [])
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function post(path: string, body?: unknown) {
    setBusy(true)
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || json?.ok === false) {
      toast.error(json?.message || "Não foi possível concluir a ação.")
      return
    }
    toast.success("Atualizado.")
    await load()
  }

  if (!item) {
    return <p className="text-muted-foreground">Carregando caso…</p>
  }

  const locked = item.status === "paid" || item.status === "closed" || item.status === "escalated_retention"

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.customerName || "Caso de cobrança"}
        description={`Fatura ${item.invoicePk || "—"} · ${item.daysOverdue} dias em atraso`}
      >
        <Button asChild variant="outline">
          <Link href="/cobranca">Voltar</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Cliente PK:</span> {item.clientPk || "—"}</p>
          <p><span className="text-muted-foreground">Contrato PK:</span> {item.contractPk || "—"}</p>
          <p><span className="text-muted-foreground">Fatura PK:</span> {item.invoicePk || "—"}</p>
          <p><span className="text-muted-foreground">Documento:</span> {item.customerDocument || "—"}</p>
          <p><span className="text-muted-foreground">Valor:</span> {formatMoney(item.outstandingAmount)}</p>
          <p><span className="text-muted-foreground">Vencido desde:</span> {item.overdueSince || "—"}</p>
          <p><span className="text-muted-foreground">Status:</span> {STATUS_LABEL[item.status] ?? item.status}</p>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="font-semibold">Registrar contato</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Canal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as ContactChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">Telefone</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Resultado</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as ContactOutcome)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contacted">Contato feito</SelectItem>
                  <SelectItem value="no_answer">Sem resposta</SelectItem>
                  <SelectItem value="promised_payment">Prometeu pagar</SelectItem>
                  <SelectItem value="callback">Retornar</SelectItem>
                  <SelectItem value="refused">Recusou</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas (sem dados sensíveis excessivos)"
            maxLength={500}
          />
          <Button
            disabled={busy || locked}
            onClick={() => void post(`/api/cobranca/cases/${id}/contact`, { channel, outcome, notes })}
          >
            Registrar tentativa
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || locked}
          onClick={() => void post(`/api/cobranca/cases/${id}/status`, { status: "promise_to_pay" })}
        >
          Promessa de pagamento
        </Button>
        <Button
          variant="secondary"
          disabled={busy || locked}
          onClick={() => void post(`/api/cobranca/cases/${id}/close`)}
        >
          Encerrar
        </Button>
        <div className="flex gap-2">
          <input
            className="h-9 rounded-md border px-3 text-sm"
            placeholder="Motivo da escalada"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="destructive"
            disabled={busy || locked}
            onClick={() => void post(`/api/cobranca/cases/${id}/escalate`, { reason })}
          >
            Escalar retenção
          </Button>
        </div>
        <div className="flex gap-2">
          <input
            className="h-9 rounded-md border px-3 text-sm"
            placeholder="employee_id destino"
            value={toEmployeeId}
            onChange={(e) => setToEmployeeId(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || locked || !toEmployeeId.trim()}
            onClick={() =>
              void post(`/api/cobranca/cases/${id}/transfer`, { toEmployeeId })
            }
          >
            Transferir
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Tentativas</h2>
          <ul className="space-y-2 text-sm">
            {attempts.length === 0 ? <li className="text-muted-foreground">Nenhuma.</li> : attempts.map((a) => (
              <li key={a.id}>
                {new Date(a.createdAt).toLocaleString("pt-BR")} · {a.channel} · {a.outcome}
                {a.notes ? ` — ${a.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Histórico</h2>
          <ul className="space-y-2 text-sm">
            {events.length === 0 ? <li className="text-muted-foreground">Nenhum.</li> : events.map((e) => (
              <li key={e.id}>
                {new Date(e.createdAt).toLocaleString("pt-BR")} · {e.eventType}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
