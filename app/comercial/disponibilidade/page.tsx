"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/ui/page-header"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_COMERCIAL,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { currentComercial } from "@/lib/services/mock-data.service"
import {
  loadComercialLeadSettingsFromSupabase,
  saveComercialAvailabilityStatusFromSupabase,
  setComercialReceivingLeadsFromSupabase,
  mapSettingsToDisponibilidade,
  mapDisponibilidadeToSettings,
  devLogCommercialRealtime,
} from "@/lib/services/commercial-lead.service"
import {
  CheckCircle2,
  PauseCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Users,
} from "lucide-react"
import type { ComercialDisponibilidade } from "@/types"

const statusOptions = [
  {
    value: "disponivel" as const,
    label: "Disponível",
    description: "Você receberá novos leads automaticamente",
    icon: CheckCircle2,
    color: "success",
  },
  {
    value: "em_pausa" as const,
    label: "Em Pausa",
    description: "Pausado temporariamente, leads não serão atribuídos",
    icon: PauseCircle,
    color: "warning",
  },
  {
    value: "offline" as const,
    label: "Offline",
    description: "Fora do horário de trabalho",
    icon: XCircle,
    color: "muted",
  },
]

export default function DisponibilidadePage() {
  const [status, setStatus] = useState<ComercialDisponibilidade>("disponivel")
  const [receivingLeads, setReceivingLeads] = useState(true)
  const [activeLeads, setActiveLeads] = useState(0)
  const [receivedToday, setReceivedToday] = useState(0)
  const [dailyLimit, setDailyLimit] = useState(20)
  const [isLoading, setIsLoading] = useState(false)
  const [carregando, setCarregando] = useState(true)

  const recarregar = useCallback(async () => {
    if (isDataProviderMock()) {
      setStatus(currentComercial.disponibilidade)
      setReceivingLeads(true)
      setActiveLeads(currentComercial.leadsAtivos)
      setReceivedToday(0)
      setDailyLimit(20)
      setCarregando(false)
      return
    }
    const settings = await loadComercialLeadSettingsFromSupabase()
    if (settings) {
      setStatus(mapSettingsToDisponibilidade(settings.isAvailable, settings.receivingLeads))
      setReceivingLeads(settings.receivingLeads)
      setActiveLeads(settings.activeLeads)
      setReceivedToday(settings.totalReceivedToday)
      setDailyLimit(settings.dailyLimit)
    }
    setCarregando(false)
    devLogCommercialRealtime("disponibilidade recarregada", {
      activeLeads: settings?.activeLeads,
      receivedToday: settings?.totalReceivedToday,
    })
  }, [])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  useRealtimeReload(recarregar, REALTIME_TABLES_COMERCIAL, {
    enabled: !isDataProviderMock(),
    logPrefix: "[commercial-realtime]",
  })

  const handleChangeStatus = async (newStatus: ComercialDisponibilidade) => {
    if (isDataProviderMock()) {
      setStatus(newStatus)
      setReceivingLeads(newStatus === "disponivel")
      toast.success("Status atualizado (modo demonstração).")
      return
    }
    setIsLoading(true)
    const result = await saveComercialAvailabilityStatusFromSupabase(newStatus)
    setIsLoading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    const mapped = mapDisponibilidadeToSettings(newStatus)
    setStatus(newStatus)
    setReceivingLeads(mapped.receivingLeads)
    toast.success("Disponibilidade atualizada.")
    await recarregar()
  }

  const handleToggleReceiving = async (checked: boolean) => {
    if (isDataProviderMock()) {
      setReceivingLeads(checked)
      return
    }
    setIsLoading(true)
    const result = await setComercialReceivingLeadsFromSupabase(checked)
    setIsLoading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    setReceivingLeads(checked)
    if (!checked) setStatus("em_pausa")
    else if (status === "em_pausa") setStatus("disponivel")
    toast.success(checked ? "Recebimento de leads ativado." : "Recebimento de leads pausado.")
    await recarregar()
  }

  const currentStatus = statusOptions.find((s) => s.value === status)!

  return (
    <div>
      <PageHeader
        title="Controle de Disponibilidade"
        description="Gerencie seu status para recebimento de leads"
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Users className="w-4 h-4" />
            Leads ativos
          </div>
          <p className="text-2xl font-bold">{carregando ? "…" : activeLeads}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Clock className="w-4 h-4" />
            Recebidos hoje
          </div>
          <p className="text-2xl font-bold">
            {carregando ? "…" : `${receivedToday}/${dailyLimit}`}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 flex items-center justify-between">
          <div>
            <Label htmlFor="receiving-leads" className="font-medium">
              Receber leads
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Distribuição automática quando indicação for aprovada
            </p>
          </div>
          <Switch
            id="receiving-leads"
            checked={receivingLeads}
            disabled={isLoading || carregando}
            onCheckedChange={(v) => void handleToggleReceiving(v)}
          />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Status Atual</h2>
        <div
          className={`flex items-center gap-4 p-4 rounded-lg ${
            status === "disponivel"
              ? "bg-success/10 border border-success/20"
              : status === "em_pausa"
                ? "bg-warning/10 border border-warning/20"
                : "bg-muted border border-muted"
          }`}
        >
          <currentStatus.icon
            className={`w-10 h-10 ${
              status === "disponivel"
                ? "text-success"
                : status === "em_pausa"
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
          />
          <div>
            <p className="text-lg font-semibold text-foreground">{currentStatus.label}</p>
            <p className="text-sm text-muted-foreground">{currentStatus.description}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Alterar Status</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void handleChangeStatus(option.value)}
              disabled={isLoading || status === option.value || carregando}
              className={`flex flex-col items-center gap-3 p-6 rounded-xl border transition-all ${
                status === option.value
                  ? option.value === "disponivel"
                    ? "border-success bg-success/5"
                    : option.value === "em_pausa"
                      ? "border-warning bg-warning/5"
                      : "border-muted bg-muted/5"
                  : "border-border hover:border-primary/50 bg-card"
              } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <option.icon className="w-12 h-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-semibold text-foreground">{option.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
        {isLoading && (
          <p className="text-sm text-muted-foreground mt-4 text-center">Salvando…</p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-start gap-3">
            <Clock className="w-6 h-6 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold text-foreground mb-2">Distribuição Automática</h3>
              <p className="text-sm text-muted-foreground">
                Indicações com status <strong>aprovada</strong> são atribuídas ao comercial
                elegível com menor <code>last_lead_received_at</code>, respeitando limite diário.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-warning mt-0.5" />
            <div>
              <h3 className="font-semibold text-foreground mb-2">Regras de Redistribuição</h3>
              <p className="text-sm text-muted-foreground">
                Leads sem contato em 15 minutos geram alerta. Após 30 minutos, podem ser
                redistribuídos (fluxo existente).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
