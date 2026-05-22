"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatCard } from "@/components/ui/stat-card"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Users,
  UserCheck,
  AlertTriangle,
  Handshake,
  ShoppingCart,
  UserX,
  Clock,
  ArrowRight,
  Phone,
} from "lucide-react"
import { subscribeReferralDataMutated } from "@/lib/client/referral-data-sync"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_COMERCIAL,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { dashboardComercial, leads, currentComercial } from "@/lib/services/mock-data.service"
import {
  getAuthProfileBasicsFromSupabase,
  loadComercialLeadsFromSupabase,
} from "@/lib/services/supabase-data.service"
import {
  loadComercialLeadSettingsFromSupabase,
  mapSettingsToDisponibilidade,
  devLogCommercialRealtime,
} from "@/lib/services/commercial-lead.service"
import type { ComercialDisponibilidade } from "@/types/profile"
import type { DashboardComercial } from "@/types/dashboard"
import type { Lead } from "@/types/lead"
import { CommercialSlaOverdueBadge } from "@/components/commercial/commercial-sla-overdue-badge"
import { CommercialRedistributedBadge } from "@/components/commercial/commercial-redistributed-badge"
import { devLogCommercialSla } from "@/lib/commercial-sla"

function primeNome(nome: string): string {
  const p = (nome ?? "").trim().split(/\s+/)[0]
  return p || "—"
}

function dashboardFromComercialLeads(
  allLeads: Lead[],
  uid: string | null
): DashboardComercial {
  const base: DashboardComercial = {
    leadsNovos: 0,
    leadsEmAtendimento: 0,
    leadsSemContato: 0,
    leadsEmNegociacao: 0,
    vendasRealizadas: 0,
    leadsPerdidos: 0,
    tempoMedioPrimeiroContato: "N/D",
  }
  if (!uid) return base

  const diffMins: number[] = []

  for (const l of allLeads) {
    const pool = !l.comercialId
    const mine = l.comercialId === uid

    switch (l.status) {
      case "novo":
        if (pool || mine) base.leadsNovos += 1
        break
      case "em_atendimento":
      case "redistribuido":
        if (mine) base.leadsEmAtendimento += 1
        break
      case "sem_contato":
        if (mine) base.leadsSemContato += 1
        break
      case "em_negociacao":
        if (mine) base.leadsEmNegociacao += 1
        break
      case "vendido":
        if (mine) base.vendasRealizadas += 1
        break
      case "perdido":
        if (mine) base.leadsPerdidos += 1
        break
      default:
        break
    }
    if (mine && l.primeiroContato) {
      const ms = l.primeiroContato.getTime() - l.createdAt.getTime()
      if (ms >= 0) diffMins.push(ms / 60000)
    }
  }

  if (diffMins.length > 0) {
    const avg = diffMins.reduce((a, b) => a + b, 0) / diffMins.length
    base.tempoMedioPrimeiroContato = `${Math.max(0, Math.round(avg))} min`
  }

  return base
}

function initialMockComercialState(): {
  nome: string
  dashboard: DashboardComercial
  leadsAtivos: Lead[]
} | null {
  if (!isDataProviderMock()) return null
  const meus = leads.filter((l) => l.comercialId === currentComercial.id)
  return {
    nome: currentComercial.nome,
    dashboard: dashboardComercial,
    leadsAtivos: meus.filter((l) => l.status !== "vendido" && l.status !== "perdido"),
  }
}

export default function ComercialDashboard() {
  const pathname = usePathname()
  const init = initialMockComercialState()
  const [nomeCumprimento, setNomeCumprimento] = useState(init?.nome ?? "")
  const [dashboard, setDashboard] = useState<DashboardComercial | null>(init?.dashboard ?? null)
  const [leadsAtivosLista, setLeadsAtivosLista] = useState<Lead[]>(init?.leadsAtivos ?? [])
  const [reloadTick, setReloadTick] = useState(0)
  const [disponibilidade, setDisponibilidade] = useState<ComercialDisponibilidade>("disponivel")
  const [leadsHoje, setLeadsHoje] = useState("0/20")

  const loadComercialDashboard = useCallback(async () => {
    if (isDataProviderMock()) {
      const meus = leads.filter((l) => l.comercialId === currentComercial.id)
      setDashboard(dashboardComercial)
      setLeadsAtivosLista(
        meus.filter((l) => l.status !== "vendido" && l.status !== "perdido")
      )
      if (process.env.NODE_ENV === "development") {
        console.log("[page-data:debug]", { page: "/comercial", source: "mock", total: meus.length })
      }
      return
    }

    const [remote, basics, settings] = await Promise.all([
      loadComercialLeadsFromSupabase(),
      getAuthProfileBasicsFromSupabase(),
      loadComercialLeadSettingsFromSupabase(),
    ])
    if (!remote.ok) {
      console.error("[commercial-leads:error]", remote.error, remote.meta)
    }
    const uid = basics?.id ?? null
    if (settings) {
      setDisponibilidade(
        mapSettingsToDisponibilidade(settings.isAvailable, settings.receivingLeads)
      )
      setLeadsHoje(`${settings.totalReceivedToday}/${settings.dailyLimit}`)
      devLogCommercialRealtime("dashboard settings", {
        activeLeads: settings.activeLeads,
        leadsHoje: settings.totalReceivedToday,
      })
    }
    setNomeCumprimento(basics?.fullName ?? "")
    const allLeads = remote.ok ? remote.data : []
    const poolNovos =
      uid && allLeads.length > 0
        ? allLeads.filter((l) => !l.comercialId && l.status === "novo")
        : []
    const assignedAtivos =
      uid && allLeads.length > 0
        ? allLeads.filter(
            (l) =>
              l.comercialId === uid &&
              l.status !== "vendido" &&
              l.status !== "perdido"
          )
        : []

    setDashboard({ ...dashboardFromComercialLeads(allLeads, uid) })
    const ativos = [...assignedAtivos, ...poolNovos].map((l) => structuredClone(l))
    setLeadsAtivosLista(ativos)
    devLogCommercialSla("dashboard leads ativos", {
      total: allLeads?.length ?? 0,
      ativos: ativos.length,
      sla: {
        warning: ativos.filter((l) => l.slaLevel === "warning").length,
        critical: ativos.filter((l) => l.slaLevel === "critical").length,
        redistribution_ready: ativos.filter((l) => l.slaLevel === "redistribution_ready")
          .length,
      },
    })
  }, [])

  useEffect(() => {
    void loadComercialDashboard()
  }, [loadComercialDashboard, pathname, reloadTick])

  useEffect(() => {
    return subscribeReferralDataMutated(() => {
      setReloadTick((t) => t + 1)
    })
  }, [])

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

  const d =
    dashboard ??
    ({
      leadsNovos: 0,
      leadsEmAtendimento: 0,
      leadsSemContato: 0,
      leadsEmNegociacao: 0,
      vendasRealizadas: 0,
      leadsPerdidos: 0,
      tempoMedioPrimeiroContato: "N/D",
    } satisfies DashboardComercial)

  return (
    <div>
      <PageHeader
        title={`Olá, ${primeNome(nomeCumprimento)}!`}
        description="Gerencie seus leads e acompanhe seu desempenho"
      >
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
            disponibilidade === "disponivel"
              ? "bg-success/10 border-success/20"
              : disponibilidade === "em_pausa"
                ? "bg-warning/10 border-warning/20"
                : "bg-muted border-muted"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              disponibilidade === "disponivel"
                ? "bg-success animate-pulse"
                : disponibilidade === "em_pausa"
                  ? "bg-warning"
                  : "bg-muted-foreground"
            }`}
          />
          <span
            className={`text-sm font-medium ${
              disponibilidade === "disponivel"
                ? "text-success"
                : disponibilidade === "em_pausa"
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
          >
            {disponibilidade === "disponivel"
              ? "Disponível"
              : disponibilidade === "em_pausa"
                ? "Em pausa"
                : "Offline"}
          </span>
          <span className="text-xs text-muted-foreground">· {leadsHoje} hoje</span>
        </div>
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Leads Novos"
          value={d.leadsNovos}
          icon={Users}
          variant="primary"
        />
        <StatCard
          title="Em Atendimento"
          value={d.leadsEmAtendimento}
          icon={UserCheck}
        />
        <StatCard
          title="Sem Contato"
          value={d.leadsSemContato}
          icon={AlertTriangle}
          variant="warning"
        />
        <StatCard
          title="Em Negociação"
          value={d.leadsEmNegociacao}
          icon={Handshake}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        <StatCard
          title="Vendas Realizadas"
          value={d.vendasRealizadas}
          icon={ShoppingCart}
          variant="success"
        />
        <StatCard
          title="Leads Perdidos"
          value={d.leadsPerdidos}
          icon={UserX}
          variant="destructive"
        />
        <StatCard
          title="Tempo Médio 1º Contato"
          value={d.tempoMedioPrimeiroContato}
          icon={Clock}
        />
      </div>

      {/* Active Leads */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">
              Leads Ativos
            </h2>
            {leadsAtivosLista.some((l) => l.slaLevel && l.slaLevel !== "none") ? (
              <CommercialSlaOverdueBadge
                level={
                  leadsAtivosLista.some((l) => l.slaLevel === "redistribution_ready")
                    ? "redistribution_ready"
                    : leadsAtivosLista.some((l) => l.slaLevel === "critical")
                      ? "critical"
                      : "warning"
                }
                variant="compact"
              />
            ) : null}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/comercial/leads">
              Ver todos
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>

        <div className="space-y-3">
          {leadsAtivosLista.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum lead ativo no momento
            </div>
          ) : (
            leadsAtivosLista.slice(0, 5).map((lead) => {
              const indicacao = lead.indicacao
              if (!indicacao) return null
              return (
              <Link
                key={lead.id}
                href={`/comercial/leads/${lead.id}`}
                className="flex items-center justify-between p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                    {indicacao.nomeIndicado.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {indicacao.nomeIndicado}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {indicacao.telefoneIndicado} -{" "}
                      {indicacao.plano?.nome || "Plano"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CommercialRedistributedBadge
                    redistributionCount={lead.redistributionCount}
                    previousCommercialName={lead.previousCommercialNome}
                    variant="compact"
                  />
                  <CommercialSlaOverdueBadge level={lead.slaLevel} variant="compact" />
                  <StatusBadge status={lead.status} />
                  <Button variant="ghost" size="icon" asChild>
                    <span>
                      <Phone className="w-4 h-4" />
                    </span>
                  </Button>
                </div>
              </Link>
              )
            })
          )}
        </div>
      </div>

      {/* Alert for leads without contact */}
      {d.leadsSemContato > 0 && (
        <div className="mt-6 p-4 rounded-xl bg-warning/10 border border-warning/20 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
          <div>
            <p className="font-medium text-foreground">Atenção!</p>
            <p className="text-sm text-muted-foreground">
              Você tem {d.leadsSemContato} lead(s) sem contato.
              Entre em contato em até 15 minutos para evitar redistribuição.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
