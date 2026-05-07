"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { getSupabaseClient } from "@/lib/supabase/client"
import { processExpiredLeadAssignments } from "@/lib/services/supabase-data.service"

type SlaRunResult = {
  scanned: number
  redistributed: number
  alerted: number
  skipped: number
}

const SLA_PAGE_LOG_PREFIX = "[admin-sla-page]"

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function devLog(...args: unknown[]): void {
  if (!isDev()) return
  console.log(SLA_PAGE_LOG_PREFIX, ...args)
}

export default function AdminSlaPage() {
  const [isCheckingAccess, setIsCheckingAccess] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SlaRunResult | null>(null)

  useEffect(() => {
    void (async () => {
      setIsCheckingAccess(true)
      setError(null)

      try {
        const supabase = getSupabaseClient()
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()

        devLog("auth.getUser", {
          hasUser: Boolean(user && !authError),
          userId: user?.id ?? null,
          authError: authError?.message ?? null,
        })

        if (authError || !user) {
          setHasAccess(false)
          setError("Acesso negado: sessão inválida.")
          setIsCheckingAccess(false)
          return
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .maybeSingle()

        const role = (profile as { role?: string } | null)?.role ?? null
        devLog("profile", {
          hasProfile: Boolean(profile && !profileError),
          role,
          profileError: profileError?.message ?? null,
        })

        if (profileError || !profile || role !== "admin_master") {
          setHasAccess(false)
          setError("Acesso negado: apenas admin_master pode executar esta ação.")
          setIsCheckingAccess(false)
          return
        }

        setHasAccess(true)
        setIsCheckingAccess(false)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        devLog("erro validação acesso", msg)
        setHasAccess(false)
        setError("Erro ao validar acesso para ferramenta de SLA.")
        setIsCheckingAccess(false)
      }
    })()
  }, [])

  const handleProcessSla = async () => {
    if (isRunning || !hasAccess) return

    setIsRunning(true)
    setError(null)
    setResult(null)

    const response = await processExpiredLeadAssignments()
    devLog("resultado processExpiredLeadAssignments", response)

    if (!response.ok) {
      setError(response.message)
      setIsRunning(false)
      return
    }

    setResult({
      scanned: response.scanned,
      redistributed: response.redistributed,
      alerted: response.alerted,
      skipped: response.skipped,
    })
    setIsRunning(false)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA e Redistribuição"
        description="Ferramenta manual temporária para testar redistribuição automática de leads por SLA."
      />

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Esta página é um disparador manual para admins testarem o processamento
          de leads vencidos por SLA. Nenhum cron é executado automaticamente.
        </p>

        {isCheckingAccess ? (
          <p className="text-sm text-muted-foreground">
            Validando permissões...
          </p>
        ) : !hasAccess ? (
          <p className="text-sm text-destructive">
            {error ?? "Acesso negado."}
          </p>
        ) : (
          <Button onClick={() => void handleProcessSla()} disabled={isRunning}>
            {isRunning ? "Processando..." : "Processar leads vencidos"}
          </Button>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-base font-semibold text-foreground">Resultado</h2>

        {error && hasAccess && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {result ? (
          <div className="space-y-1 text-sm text-foreground">
            <p>scanned: {result.scanned}</p>
            <p>redistributed: {result.redistributed}</p>
            <p>alerted: {result.alerted}</p>
            <p>skipped: {result.skipped}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum processamento executado nesta sessão.
          </p>
        )}
      </div>
    </div>
  )
}
