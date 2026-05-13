"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { mockDataService } from "@/lib/services/mock-data.service"
import {
  getIndicadorHomeLoadFailureReasonForDev,
  loadIndicadorHomeFromSupabase,
} from "@/lib/services/supabase-data.service"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import type { DashboardIndicador } from "@/types/dashboard"
import type { Indicador } from "@/types/profile"
import type { Indicacao } from "@/types/referral"

type IndicadorHomeContextValue = {
  indicador: Indicador
  dashboard: DashboardIndicador
  recentIndicacoes: Indicacao[]
  source: "mock" | "supabase"
}

const IndicadorHomeContext = createContext<IndicadorHomeContextValue | null>(
  null
)

function mockIndicadorHome(): IndicadorHomeContextValue {
  const s = mockDataService.getSnapshot()
  const recent = s.indicacoes
    .filter((i) => i.indicadorId === s.currentIndicador.id)
    .slice(0, 5)
  return {
    indicador: s.currentIndicador,
    dashboard: s.dashboardIndicador,
    recentIndicacoes: recent,
    source: "mock",
  }
}

function emptyIndicadorHome(): IndicadorHomeContextValue {
  const now = new Date()
  const emptyInd: Indicador = {
    id: "",
    nome: "",
    email: "",
    telefone: "",
    role: "indicador",
    ativo: true,
    createdAt: now,
    totalIndicacoes: 0,
    indicacoesAprovadas: 0,
    totalRecebido: 0,
    saldoDisponivel: 0,
    saldoDesconto: 0,
  }
  const emptyDash: DashboardIndicador = {
    totalIndicacoes: 0,
    emAndamento: 0,
    aprovadas: 0,
    recusadas: 0,
    totalRecebido: 0,
    totalAReceber: 0,
    saldoDisponivel: 0,
    saldoEmDesconto: 0,
    recompensasPendentesCount: 0,
    recompensasDisponiveisCount: 0,
    valorRecompensasPendentes: 0,
    valorRecompensasDisponiveis: 0,
  }
  return {
    indicador: emptyInd,
    dashboard: emptyDash,
    recentIndicacoes: [],
    source: "supabase",
  }
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

export function useIndicadorHome() {
  const ctx = useContext(IndicadorHomeContext)
  if (!ctx) {
    throw new Error("useIndicadorHome deve ser usado dentro de IndicadorHomeProvider")
  }
  return ctx
}

export function IndicadorHomeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IndicadorHomeContextValue>(() =>
    isDataProviderMock() ? mockIndicadorHome() : emptyIndicadorHome()
  )

  useEffect(() => {
    if (isDataProviderMock()) {
      return
    }
    let cancelled = false
    void (async () => {
      if (isDev()) {
        console.log(
          "[indicador-home:provider]",
          "buscando dados Supabase (estado inicial vazio até carregar)"
        )
      }
      const remote = await loadIndicadorHomeFromSupabase()
      if (cancelled) {
        if (isDev()) {
          console.log(
            "[indicador-home:provider]",
            "load ignorado: componente desmontou antes de concluir"
          )
        }
        return
      }
      if (!remote) {
        if (isDev()) {
          const motivo =
            getIndicadorHomeLoadFailureReasonForDev() ??
            "(sem motivo no buffer dev — ver console [indicador-home:supabase])"
          console.warn(
            "[indicador-home:provider]",
            "Supabase não retornou home; mantendo estado vazio (sem fallback mock). Motivo:",
            motivo
          )
        }
        return
      }
      setState({
        indicador: remote.indicador,
        dashboard: remote.dashboard,
        recentIndicacoes: remote.recentIndicacoes,
        source: "supabase",
      })
      if (isDev()) {
        console.log(
          "[indicador-home:provider]",
          "Estado atualizado com fonte supabase",
          { indicadorId: remote.indicador.id }
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <IndicadorHomeContext.Provider value={state}>
      {children}
    </IndicadorHomeContext.Provider>
  )
}
