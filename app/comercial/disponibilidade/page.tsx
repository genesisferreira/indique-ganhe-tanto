"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { currentComercial } from "@/lib/services/mock-data.service"
import {
  CheckCircle2,
  PauseCircle,
  XCircle,
  Clock,
  AlertTriangle,
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
  const [status, setStatus] = useState<ComercialDisponibilidade>(
    currentComercial.disponibilidade
  )
  const [isLoading, setIsLoading] = useState(false)

  const handleChangeStatus = async (newStatus: ComercialDisponibilidade) => {
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setStatus(newStatus)
    setIsLoading(false)
  }

  const currentStatus = statusOptions.find((s) => s.value === status)!

  return (
    <div>
      <PageHeader
        title="Controle de Disponibilidade"
        description="Gerencie seu status para recebimento de leads"
      />

      {/* Current Status */}
      <div className="rounded-xl border bg-card p-6 mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Status Atual
        </h2>
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
            <p className="text-lg font-semibold text-foreground">
              {currentStatus.label}
            </p>
            <p className="text-sm text-muted-foreground">
              {currentStatus.description}
            </p>
          </div>
        </div>
      </div>

      {/* Change Status */}
      <div className="rounded-xl border bg-card p-6 mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Alterar Status
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => handleChangeStatus(option.value)}
              disabled={isLoading || status === option.value}
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
              <option.icon
                className={`w-12 h-12 ${
                  status === option.value
                    ? option.value === "disponivel"
                      ? "text-success"
                      : option.value === "em_pausa"
                        ? "text-warning"
                        : "text-muted-foreground"
                    : "text-muted-foreground"
                }`}
              />
              <div className="text-center">
                <p className="font-semibold text-foreground">{option.label}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {option.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-start gap-3">
            <Clock className="w-6 h-6 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                Distribuição Automática
              </h3>
              <p className="text-sm text-muted-foreground">
                Os leads são distribuídos automaticamente entre os comerciais
                disponíveis usando o sistema round-robin. Mantenha-se disponível
                para receber leads.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-warning mt-0.5" />
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                Regras de Redistribuição
              </h3>
              <p className="text-sm text-muted-foreground">
                Leads sem contato em 15 minutos geram alerta. Após 30 minutos,
                são redistribuídos automaticamente para outro comercial.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
