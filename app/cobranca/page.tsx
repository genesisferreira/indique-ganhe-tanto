"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import type { CollectionCaseListItem } from "@/types/collections"

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
  const [syncing, setSyncing] = useState(false)

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
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function runSync() {
    setSyncing(true)
    const res = await fetch("/api/admin/collections/sync", { method: "POST" })
    const json = await res.json().catch(() => null)
    setSyncing(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Falha no sync Controllr.")
      return
    }
    toast.success(
      `Sync: ${json.created ?? 0} criados, ${json.updated ?? 0} atualizados, ${json.closedPaid ?? 0} pagos.`
    )
    await load()
  }

  return (
    <div>
      <PageHeader
        title="Cobrança"
        description="Clientes com 5 ou mais dias de atraso. A fonte de verdade é o Controllr."
      >
        {kind === "admin_master" ? (
          <Button onClick={() => void runSync()} disabled={syncing}>
            {syncing ? "Sincronizando…" : "Sync Controllr"}
          </Button>
        ) : null}
      </PageHeader>

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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Dias</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Última tentativa</th>
              <th className="px-3 py-2">Responsável</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td className="px-3 py-6 text-muted-foreground" colSpan={7}>
                  Nenhum caso de cobrança.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-3 py-2">{item.customerName || item.clientPk || "—"}</td>
                  <td className="px-3 py-2">{item.daysOverdue}</td>
                  <td className="px-3 py-2">{formatMoney(item.outstandingAmount)}</td>
                  <td className="px-3 py-2">{STATUS_LABEL[item.status] ?? item.status}</td>
                  <td className="px-3 py-2">
                    {item.lastContactAt
                      ? new Date(item.lastContactAt).toLocaleString("pt-BR")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{item.assigneeName || "—"}</td>
                  <td className="px-3 py-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/cobranca/${item.id}`}>Abrir</Link>
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
