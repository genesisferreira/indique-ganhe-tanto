"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { RetentionCaseListItem } from "@/types/collections"

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  in_contact: "Em contato",
  offer_made: "Oferta feita",
  retained: "Retido",
  not_retained: "Não retido",
  cancelled: "Cancelado",
  closed: "Encerrado",
}

export default function RetencaoPage() {
  const [items, setItems] = useState<RetentionCaseListItem[]>([])
  const [dashboard, setDashboard] = useState({
    mine: 0,
    open: 0,
    offerMade: 0,
    retained: 0,
    notRetained: 0,
  })
  const [reason, setReason] = useState("")
  const [clientPk, setClientPk] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/retencao/cases", { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível carregar a Retenção.")
      return
    }
    setItems(json.items ?? [])
    setDashboard(json.dashboard)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createManual() {
    setBusy(true)
    const res = await fetch("/api/retencao/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, clientPk }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível criar o caso.")
      return
    }
    toast.success("Caso criado.")
    setReason("")
    setClientPk("")
    await load()
  }

  return (
    <div>
      <PageHeader
        title="Retenção"
        description="Clientes com risco de cancelamento ou inadimplência relevante."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Meus casos", dashboard.mine],
          ["Abertos", dashboard.open],
          ["Oferta feita", dashboard.offerMade],
          ["Retidos", dashboard.retained],
          ["Não retidos", dashboard.notRetained],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 rounded-lg border p-4 space-y-3">
        <h2 className="font-semibold">Marcar risco manualmente</h2>
        <Input
          placeholder="client_pk (opcional)"
          value={clientPk}
          onChange={(e) => setClientPk(e.target.value)}
        />
        <Textarea
          placeholder="Motivo de risco"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        <Button disabled={busy} onClick={() => void createManual()}>
          Criar caso
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2">Responsável</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-muted-foreground" colSpan={6}>
                  Nenhum caso de retenção.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-3 py-2">{item.clientPk || "—"}</td>
                  <td className="px-3 py-2">{item.source}</td>
                  <td className="px-3 py-2">{STATUS_LABEL[item.status] ?? item.status}</td>
                  <td className="px-3 py-2">{item.reason || "—"}</td>
                  <td className="px-3 py-2">{item.assigneeName || "—"}</td>
                  <td className="px-3 py-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/retencao/${item.id}`}>Abrir</Link>
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
