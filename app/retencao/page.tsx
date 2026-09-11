"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { OperationalAttendance } from "@/types/collections"

type SearchResult = {
  found: boolean
  documentMasked: string | null
  customerName: string | null
  clientPk: string | null
  contractPk: string | null
  phone: string | null
  interestStatus: string | null
  sources: string[]
  collectionCases: Array<{
    id: string
    invoicePk: string | null
    daysOverdue: number
    status: string
    outstandingAmount: number | null
  }>
  openAttendanceId: string | null
  cancelledStatusAvailable: false
  controllrHistoryAvailable: false
}

export default function RetencaoPage() {
  const [document, setDocument] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [mine, setMine] = useState<OperationalAttendance[]>([])
  const [reason, setReason] = useState("")

  const loadMine = useCallback(async () => {
    const res = await fetch("/api/retencao/attendances", { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) setMine(json.items ?? [])
  }, [])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  async function search() {
    setBusy(true)
    const res = await fetch("/api/retencao/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível buscar.")
      return
    }
    setResult(json as SearchResult)
    if (!json.found) toast.message("Nenhum cliente encontrado com esse documento.")
  }

  async function startAttendance() {
    if (!result?.found) return
    setBusy(true)
    const res = await fetch("/api/retencao/attendances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document,
        clientPk: result.clientPk,
        contractPk: result.contractPk,
        customerName: result.customerName,
        reason,
      }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível iniciar o atendimento.")
      return
    }
    window.location.href = `/retencao/${json.attendance.id}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retenção"
        description="Busque o cliente por CPF/CNPJ, consulte os dados disponíveis e registre o atendimento."
      />

      <div className="rounded-lg border p-4 space-y-3">
        <Label htmlFor="doc">CPF ou CNPJ</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="doc"
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            placeholder="Somente números ou com máscara"
          />
          <Button disabled={busy || !document.trim()} onClick={() => void search()}>
            Buscar cliente
          </Button>
        </div>
      </div>

      {result ? (
        <div className="rounded-lg border p-4 space-y-3 text-sm">
          {!result.found ? (
            <p className="text-muted-foreground">Nenhum registro comprovado para este documento.</p>
          ) : (
            <>
              <h2 className="font-semibold text-base">
                {result.customerName || "Cliente localizado"}
              </h2>
              <p><span className="text-muted-foreground">Documento:</span> {result.documentMasked || "—"}</p>
              <p><span className="text-muted-foreground">Cliente PK:</span> {result.clientPk || "—"}</p>
              <p><span className="text-muted-foreground">Contrato PK:</span> {result.contractPk || "—"}</p>
              {result.phone ? (
                <p><span className="text-muted-foreground">Telefone:</span> {result.phone}</p>
              ) : null}
              {result.interestStatus ? (
                <p>
                  <span className="text-muted-foreground">Status do Interessado (Controllr):</span>{" "}
                  {result.interestStatus}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                Cancelamento ERP: não confirmado neste repositório. Histórico Controllr: consulta
                ainda não disponível.
              </p>
              {result.collectionCases.length > 0 ? (
                <div>
                  <p className="font-medium mb-1">Faturas em Cobrança (CRM)</p>
                  <ul className="space-y-1">
                    {result.collectionCases.map((c) => (
                      <li key={c.id}>
                        {c.invoicePk || "fatura"} · {c.daysOverdue} dias · {c.status}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Input
                placeholder="Motivo inicial (opcional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {result.openAttendanceId ? (
                <Button asChild>
                  <Link href={`/retencao/${result.openAttendanceId}`}>Abrir atendimento em andamento</Link>
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => void startAttendance()}>
                  Iniciar atendimento
                </Button>
              )}
            </>
          )}
        </div>
      ) : null}

      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">Meus atendimentos</h2>
        <ul className="space-y-2 text-sm">
          {mine.length === 0 ? (
            <li className="text-muted-foreground">Nenhum atendimento recente.</li>
          ) : (
            mine.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span>
                  {item.customerNameSnapshot || item.documentMasked || item.id} · {item.status}
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/retencao/${item.id}`}>Abrir</Link>
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
