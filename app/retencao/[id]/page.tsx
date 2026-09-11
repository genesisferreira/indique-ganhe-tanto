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
  ContactChannel,
  ContactOutcome,
  OperationalContactAttempt,
  RetentionCase,
  RetentionCaseEvent,
} from "@/types/collections"

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  in_contact: "Em contato",
  offer_made: "Oferta feita",
  retained: "Retido",
  not_retained: "Não retido",
  cancelled: "Cancelado",
  closed: "Encerrado",
}

export default function RetencaoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [item, setItem] = useState<RetentionCase | null>(null)
  const [events, setEvents] = useState<RetentionCaseEvent[]>([])
  const [attempts, setAttempts] = useState<OperationalContactAttempt[]>([])
  const [channel, setChannel] = useState<ContactChannel>("phone")
  const [outcome, setOutcome] = useState<ContactOutcome>("contacted")
  const [notes, setNotes] = useState("")
  const [toEmployeeId, setToEmployeeId] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/retencao/cases/${id}`, { cache: "no-store" })
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

  if (!item) return <p className="text-muted-foreground">Carregando caso…</p>
  const locked = ["retained", "not_retained", "cancelled", "closed"].includes(item.status)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caso de retenção"
        description={`Origem: ${item.source}${item.linkedCollectionCaseId ? " · vinculado à cobrança" : ""}`}
      >
        <Button asChild variant="outline">
          <Link href="/retencao">Voltar</Link>
        </Button>
      </PageHeader>

      <div className="rounded-lg border p-4 space-y-2 text-sm">
        <p><span className="text-muted-foreground">Cliente PK:</span> {item.clientPk || "—"}</p>
        <p><span className="text-muted-foreground">Contrato PK:</span> {item.contractPk || "—"}</p>
        <p><span className="text-muted-foreground">Motivo:</span> {item.reason || "—"}</p>
        <p><span className="text-muted-foreground">Status:</span> {STATUS_LABEL[item.status] ?? item.status}</p>
        {item.linkedCollectionCaseId ? (
          <p>
            <Link className="underline" href={`/cobranca/${item.linkedCollectionCaseId}`}>
              Ver caso de cobrança
            </Link>
          </p>
        ) : null}
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
                <SelectItem value="callback">Retornar</SelectItem>
                <SelectItem value="refused">Recusou</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        <Button
          disabled={busy || locked}
          onClick={() => void post(`/api/retencao/cases/${id}/contact`, { channel, outcome, notes })}
        >
          Registrar tentativa
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || locked} variant="secondary" onClick={() => void post(`/api/retencao/cases/${id}/status`, { status: "offer_made" })}>
          Oferta feita
        </Button>
        <Button disabled={busy || locked} onClick={() => void post(`/api/retencao/cases/${id}/status`, { status: "retained" })}>
          Retido
        </Button>
        <Button disabled={busy || locked} variant="secondary" onClick={() => void post(`/api/retencao/cases/${id}/status`, { status: "not_retained" })}>
          Não retido
        </Button>
        <Button disabled={busy || locked} variant="outline" onClick={() => void post(`/api/retencao/cases/${id}/close`)}>
          Encerrar
        </Button>
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
            onClick={() => void post(`/api/retencao/cases/${id}/transfer`, { toEmployeeId })}
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
              <li key={a.id}>{new Date(a.createdAt).toLocaleString("pt-BR")} · {a.channel} · {a.outcome}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Histórico</h2>
          <ul className="space-y-2 text-sm">
            {events.length === 0 ? <li className="text-muted-foreground">Nenhum.</li> : events.map((e) => (
              <li key={e.id}>{new Date(e.createdAt).toLocaleString("pt-BR")} · {e.eventType}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
