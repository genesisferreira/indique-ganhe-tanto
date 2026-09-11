"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type CollectionSettings = {
  isEnabled: boolean
  minimumDaysOverdue: number
  includeCancelledCustomers: boolean
  cancelledFilterOperational: false
}

export default function AdminCobrancaSettingsPage() {
  const [settings, setSettings] = useState<CollectionSettings | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState("5")
  const [enabled, setEnabled] = useState(true)
  const [includeCancelled, setIncludeCancelled] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/operational-settings/collections", { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível carregar as configurações.")
      return
    }
    setCanWrite(Boolean(json.canWrite))
    setNote(String(json.cancelledIntegrationNote ?? ""))
    const s = json.settings as CollectionSettings
    setSettings(s)
    setDays(String(s.minimumDaysOverdue))
    setEnabled(s.isEnabled)
    setIncludeCancelled(s.includeCancelledCustomers)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    const res = await fetch("/api/admin/operational-settings/collections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isEnabled: enabled,
        minimumDaysOverdue: Number(days),
        includeCancelledCustomers: includeCancelled,
      }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível salvar.")
      return
    }
    toast.success("Configurações salvas.")
    await load()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações de Cobrança"
        description="Regras de entrada na fila operacional. Somente Admin Master altera."
      />

      <Card>
        <CardHeader>
          <CardTitle>Fila de Cobrança</CardTitle>
          <CardDescription>
            {days || settings?.minimumDaysOverdue || 5} dias significa que clientes com{" "}
            {days || settings?.minimumDaysOverdue || 5} ou mais dias de atraso podem entrar na
            Cobrança.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="font-medium">Cobrança ativa</p>
              <p className="text-sm text-muted-foreground">
                Se desligada, o sync não abre novos casos.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canWrite || busy} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="minDays">Dias mínimos de atraso</Label>
            <Input
              id="minDays"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={!canWrite || busy}
            />
            <p className="text-sm text-muted-foreground">
              Exemplo: 5 dias = entra a partir do 5º dia (mais de 4 dias). Inteiro de 1 a 365.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="font-medium">Incluir clientes cancelados</p>
              <p className="text-sm text-muted-foreground">
                {note ||
                  "Integração ERP de cancelamento ainda não confirmada. Esta opção não filtra sozinha."}
              </p>
            </div>
            <Switch
              checked={includeCancelled}
              onCheckedChange={setIncludeCancelled}
              disabled={!canWrite || busy}
            />
          </div>

          <Button onClick={() => void save()} disabled={!canWrite || busy}>
            Salvar
          </Button>
          {!canWrite ? (
            <p className="text-sm text-muted-foreground">Somente leitura para o seu perfil.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
