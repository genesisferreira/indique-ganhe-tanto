"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { mockDataService } from "@/lib/services/mock-data.service"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import type { AuthProfileBasics } from "@/types/auth-profile"
import type { UserRole } from "@/types/user"

function roleToVariant(role: UserRole): "indicador" | "comercial" | "admin" {
  if (role === "indicador") return "indicador"
  if (role === "comercial") return "comercial"
  return "admin"
}

export default function NotificacoesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [phase, setPhase] = useState<"loading" | "ready" | "redirect">("loading")
  const [shell, setShell] = useState<{
    variant: "indicador" | "comercial" | "admin"
    profile: AuthProfileBasics
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (isDataProviderMock()) {
        const snap = mockDataService.getSnapshot()
        const ind = snap.currentIndicador
        const profile: AuthProfileBasics = {
          id: ind.id,
          fullName: ind.nome,
          email: ind.email,
          phone: ind.telefone,
          role: "indicador",
          avatarUrl: null,
          createdAt: ind.createdAt.toISOString(),
        }
        if (!cancelled) {
          setShell({ variant: "indicador", profile })
          setPhase("ready")
        }
        return
      }

      const basics = await getAuthProfileBasicsFromSupabase()
      if (cancelled) return
      if (!basics) {
        setPhase("redirect")
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`)
        return
      }
      setShell({
        variant: roleToVariant(basics.role),
        profile: basics,
      })
      setPhase("ready")
    })()
    return () => {
      cancelled = true
    }
  }, [pathname, router])

  if (phase === "loading" || !shell) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Carregando…
      </div>
    )
  }

  if (phase === "redirect") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Redirecionando…
      </div>
    )
  }

  return (
    <>
      <AuthenticatedDashboardShell variant={shell.variant} lockedProfile={shell.profile}>
        {children}
      </AuthenticatedDashboardShell>
    </>
  )
}
