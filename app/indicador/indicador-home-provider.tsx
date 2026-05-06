"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { mockDataService } from "@/lib/services/mock-data.service"
import {
  getIndicadorHomeLoadFailureReasonForDev,
  loadIndicadorHomeFromSupabase,
} from "@/lib/services/supabase-data.service"
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

export function useIndicadorHome() {
  const ctx = useContext(IndicadorHomeContext)
  if (!ctx) {
    throw new Error("useIndicadorHome deve ser usado dentro de IndicadorHomeProvider")
  }
  return ctx
}

export function IndicadorHomeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IndicadorHomeContextValue>(() =>
    mockIndicadorHome()
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[indicador-home:provider]",
          "início: buscando dados Supabase (estado inicial = mock)"
        )
      }
      const remote = await loadIndicadorHomeFromSupabase()
      if (cancelled) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[indicador-home:provider]",
            "load ignorado: componente desmontou antes de concluir"
          )
        }
        return
      }
      if (!remote) {
        if (process.env.NODE_ENV === "development") {
          const motivo =
            getIndicadorHomeLoadFailureReasonForDev() ??
            "(sem motivo no buffer dev — ver console [indicador-home:supabase])"
          console.warn(
            "[indicador-home:provider]",
            "Fallback para mock. Motivo:",
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
      if (process.env.NODE_ENV === "development") {
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
      <DashboardLayout
        variant="indicador"
        userName={state.indicador.nome}
        userRole="Indicador"
      >
        {children}
      </DashboardLayout>
    </IndicadorHomeContext.Provider>
  )
}
