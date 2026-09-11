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
import type { OperationalAttendance } from "@/types/collections"
import type { OperationalHistoryItem } from "@/lib/operational/history"

const SECTOR_LABEL: Record<string, string> = {
  collections: "Cobrança",
  retention: "Retenção",
  post_sale: "Pós-venda",
  upgrade: "Upgrade",
  technician: "Técnico",
  commercial: "Comercial",
  external_sales: "Vendas externas",
}

export default function RetencaoAttendancePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [attendance, setAttendance] = useState<OperationalAttendance | null>(null)
  const [history, setHistory] = useState<OperationalHistoryItem[]>([])
  const [actionTaken, setActionTaken] = useState("")
  const [notes, setNotes] = useState("")
  const [customerRemains, setCustomerRemains] = useState<"sim" | "nao" | "">("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/retencao/attendances/${id}`, { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Atendimento não encontrado.")
      return
    }
    setAttendance(json.attendance)
    setHistory(json.operationalHistory ?? [])
    setActionTaken(json.attendance.actionTaken ?? "")
    setNotes(json.attendance.notes ?? "")
    if (json.attendance.customerRemains === true) setCustomerRemains("sim")
    if (json.attendance.customerRemains === false) setCustomerRemains("nao")
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function complete() {
    setBusy(true)
    const res = await fetch(`/api/retencao/attendances/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionTaken,
        notes,
        customerRemains:
          customerRemains === "sim" ? true : customerRemains === "nao" ? false : null,
      }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || json?.ok === false) {
      toast.error(json?.message || "Não foi possível concluir.")
      return
    }
    toast.success("Atendimento concluído.")
    await load()
  }

  if (!attendance) {
    return <p className="text-muted-foreground">Carregando atendimento…</p>
  }

  const locked = attendance.status === "completed"

  return (
    <div className="space-y-6">
      <PageHeader
        title={attendance.customerNameSnapshot || "Atendimento de retenção"}
        description={`${attendance.documentMasked || "Documento mascarado"} · ${attendance.status}`}
      >
        <Button asChild variant="outline">
          <Link href="/retencao">Voltar</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Cliente PK:</span> {attendance.clientPk || "—"}</p>
          <p><span className="text-muted-foreground">Contrato PK:</span> {attendance.contractPk || "—"}</p>
          <p><span className="text-muted-foreground">Motivo inicial:</span> {attendance.reason || "—"}</p>
          <p>
            <span className="text-muted-foreground">Cliente permanece:</span>{" "}
            {attendance.customerRemains == null ? "—" : attendance.customerRemains ? "Sim" : "Não"}
          </p>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="font-semibold">Relatório</h2>
          <div>
            <Label>O que foi feito?</Label>
            <Textarea
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              disabled={locked || busy}
              maxLength={500}
            />
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={locked || busy}
              maxLength={500}
            />
          </div>
          <div>
            <Label>Cliente permanecerá?</Label>
            <Select
              value={customerRemains}
              onValueChange={(v) => setCustomerRemains(v as "sim" | "nao")}
              disabled={locked || busy}
            >
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sim">Sim</SelectItem>
                <SelectItem value="nao">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={locked || busy || !actionTaken.trim() || !customerRemains}
            onClick={() => void complete()}
          >
            Concluir atendimento
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">Histórico do cliente</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Timeline do CRM. Histórico do Controllr ainda não tem endpoint confirmado neste
          repositório (somente leitura futura; escrita ERP desligada).
        </p>
        <ul className="space-y-2 text-sm">
          {history.length === 0 ? (
            <li className="text-muted-foreground">Nenhum evento operacional.</li>
          ) : (
            history.map((item) => (
              <li key={item.id}>
                {new Date(item.occurredAt).toLocaleString("pt-BR")} ·{" "}
                {item.source === "controllr" ? "Controllr" : "CRM"} ·{" "}
                {SECTOR_LABEL[item.sectorCode] ?? item.sectorCode} · {item.eventType}
                {item.customerRemains == null
                  ? ""
                  : item.customerRemains
                    ? " · permanece"
                    : " · não permanece"}
                {item.notes ? ` — ${item.notes}` : ""}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
