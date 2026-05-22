"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  leads,
  currentComercial,
} from "@/lib/services/mock-data.service"
import {
  emitReferralDataMutated,
  subscribeReferralDataMutated,
} from "@/lib/client/referral-data-sync"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_COMERCIAL,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import {
  claimComercialLead,
  loadComercialLeadsFromSupabase,
} from "@/lib/services/supabase-data.service"
import type { Lead } from "@/types/lead"
import { Search, Filter, Eye, Phone, Clock } from "lucide-react"
import { CommercialSlaOverdueBadge } from "@/components/commercial/commercial-sla-overdue-badge"
import { CommercialRedistributedBadge } from "@/components/commercial/commercial-redistributed-badge"
import { devLogCommercialSla } from "@/lib/commercial-sla"

const statusOptions = [
  { value: "all", label: "Todos os status" },
  { value: "novo", label: "Novo" },
  { value: "em_atendimento", label: "Em Atendimento" },
  { value: "sem_contato", label: "Sem Contato" },
  { value: "em_negociacao", label: "Em Negociação" },
  { value: "vendido", label: "Vendido" },
  { value: "perdido", label: "Perdido" },
]

export default function LeadsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [claimingLeadId, setClaimingLeadId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [listVersion, setListVersion] = useState(0)

  const mockLeads = useMemo(
    () =>
      isDataProviderMock()
        ? leads.filter((l) => l.comercialId === currentComercial.id)
        : [],
    []
  )

  const [listaLeads, setListaLeads] = useState<Lead[]>(() => mockLeads)

  const loadComercialLeads = useCallback(async () => {
    if (isDataProviderMock()) {
      setListaLeads([...mockLeads])
      return
    }
    const remote = await loadComercialLeadsFromSupabase()
    if (!remote.ok) {
      console.error("[commercial-leads:error]", remote.error, remote.meta)
      toast.error(
        remote.error ||
          "Não foi possível carregar os leads. Veja o console do servidor/navegador."
      )
      setListaLeads([])
      return
    }
    const cloned = remote.data.map((l) => structuredClone(l))
    setListaLeads(cloned)
    const byLevel = {
      warning: cloned.filter((l) => l.slaLevel === "warning").length,
      critical: cloned.filter((l) => l.slaLevel === "critical").length,
      redistribution_ready: cloned.filter((l) => l.slaLevel === "redistribution_ready")
        .length,
    }
    devLogCommercialSla("lista leads", { total: cloned.length, byLevel })
  }, [mockLeads])

  useEffect(() => {
    void loadComercialLeads()
  }, [loadComercialLeads, pathname, reloadTick])

  useEffect(() => {
    return subscribeReferralDataMutated(() => {
      void loadComercialLeads().then(() => {
        setListVersion((v) => v + 1)
      })
    })
  }, [loadComercialLeads])

  useRealtimeReload(
    () => {
      setReloadTick((t) => t + 1)
    },
    REALTIME_TABLES_COMERCIAL,
    { enabled: !isDataProviderMock() }
  )

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setReloadTick((t) => t + 1)
      }
    }
    window.addEventListener("focus", onVisible)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onVisible)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const refreshAfterMutation = useCallback(async () => {
    await loadComercialLeads()
    setListVersion((v) => v + 1)
    emitReferralDataMutated()
    router.refresh()
  }, [loadComercialLeads, router])

  const handleClaimLead = async (lead: Lead) => {
    if (claimingLeadId) return

    setClaimingLeadId(lead.id)
    const result = await claimComercialLead(lead.id)

    if (result.ok) {
      setListaLeads((prev) =>
        prev.map((item) =>
          item.id === lead.id
            ? {
                ...item,
                status: item.status === "novo" ? "em_atendimento" : item.status,
                updatedAt: new Date(),
              }
            : item
        )
      )
      setListVersion((v) => v + 1)
      toast.success("Lead assumido com sucesso!")
      await refreshAfterMutation()
      setClaimingLeadId(null)
      return
    }

    toast.error(result.message)
    setClaimingLeadId(null)
  }

  const filteredLeads = listaLeads.filter((lead) => {
    if (!lead.indicacao) return false
    const matchesSearch = lead.indicacao.nomeIndicado
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesStatus =
      statusFilter === "all" || lead.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div>
      <PageHeader
        title="Meus Leads"
        description="Gerencie seus leads de indicações"
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Leads Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredLeads.length === 0 ? (
          <div className="col-span-full rounded-xl border bg-card p-12 text-center">
            <p className="text-muted-foreground">Nenhum lead encontrado</p>
          </div>
        ) : (
          filteredLeads.map((lead) => {
            const indicacao = lead.indicacao
            if (!indicacao) return null

            return (
              <div
                key={`${lead.id}-${listVersion}`}
                className="rounded-xl border bg-card p-5 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-lg">
                      {indicacao.nomeIndicado.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {indicacao.nomeIndicado}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {indicacao.plano?.nome || "Plano não definido"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={lead.status} />
                    <CommercialRedistributedBadge
                      redistributionCount={lead.redistributionCount}
                      previousCommercialName={lead.previousCommercialNome}
                      variant="compact"
                    />
                    <CommercialSlaOverdueBadge level={lead.slaLevel} variant="compact" />
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span className="text-foreground">
                      {indicacao.telefoneIndicado}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-muted-foreground shrink-0">
                      Recompensa
                    </span>
                    <span className="font-medium text-foreground text-right">
                      R${" "}
                      {indicacao.valorRecompensa.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cadastro:{" "}
                    {lead.createdAt.toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  {lead.retornoAgendado && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-warning" />
                      <span className="text-warning">
                        Retorno:{" "}
                        {lead.retornoAgendado.toLocaleDateString("pt-BR")} às{" "}
                        {lead.retornoAgendado.toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground flex-1">
                    Indicado por: {indicacao.indicador?.nome || "—"}
                  </p>
                  {!lead.comercialId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void handleClaimLead(lead)
                      }}
                      disabled={claimingLeadId === lead.id}
                    >
                      {claimingLeadId === lead.id
                        ? "Assumindo..."
                        : "Assumir Lead"}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/comercial/leads/${lead.id}`}>
                      <Eye className="w-4 h-4 mr-1" />
                      Detalhes
                    </Link>
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
