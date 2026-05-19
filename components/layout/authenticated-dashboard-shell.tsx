"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AppToaster } from "@/components/notifications/app-toaster"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { NotificationsProvider } from "@/components/notifications/notifications-provider"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { mockDataService } from "@/lib/services/mock-data.service"
import type { AuthProfileBasics } from "@/types/auth-profile"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { formatUserRoleLabel } from "@/lib/auth/format-user-role-label"
import {
  getDashboardHomeForRole,
  isRoleAllowedOnDashboardVariant,
} from "@/lib/auth/auth-audit"
import type { UserRole } from "@/types/user"

type DashboardVariant = "indicador" | "comercial" | "admin"

export type AuthenticatedDashboardShellProps = {
  variant: DashboardVariant
  children: React.ReactNode
  /**
   * Perfil já carregado pelo layout pai. Quando definido, o shell não refaz a query ao Supabase.
   */
  lockedProfile?: AuthProfileBasics
}

export function AuthenticatedDashboardShell({
  variant,
  children,
  lockedProfile,
}: AuthenticatedDashboardShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [userName, setUserName] = useState("")
  const [userRoleLabel, setUserRoleLabel] = useState("")
  const [policyRole, setPolicyRole] = useState<UserRole | null>(null)
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (isDataProviderMock()) {
        const snap = mockDataService.getSnapshot()
        if (variant === "indicador") {
          setUserName(snap.currentIndicador.nome)
          setUserRoleLabel(formatUserRoleLabel("indicador"))
          setPolicyRole("indicador")
        } else if (variant === "comercial") {
          setUserName(snap.currentComercial.nome)
          setUserRoleLabel(formatUserRoleLabel("comercial"))
          setPolicyRole("comercial")
        } else {
          const admin = snap.currentAdmin
          setUserName(admin.nome)
          setUserRoleLabel(formatUserRoleLabel(admin.role))
          setPolicyRole(admin.role)
        }
        if (process.env.NODE_ENV === "development") {
          console.log("[auth-profile:debug]", {
            userId: "(mock)",
            email: "(mock)",
            profile: { variant },
            source: "mock",
          })
        }
        if (!cancelled) setReady(true)
        return
      }

      if (lockedProfile) {
        setUserName(lockedProfile.fullName)
        setUserRoleLabel(formatUserRoleLabel(lockedProfile.role))
        setPolicyRole(lockedProfile.role)
        if (!isRoleAllowedOnDashboardVariant(variant, lockedProfile.role)) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[permission-check:debug]", {
              flow: "dashboard-shell",
              action: "redirect_variant_mismatch",
              variant,
              role: lockedProfile.role,
              dest: getDashboardHomeForRole(lockedProfile.role),
            })
          }
          setRedirecting(true)
          router.replace(getDashboardHomeForRole(lockedProfile.role))
          return
        }
        if (!cancelled) setReady(true)
        return
      }

      const profile = await getAuthProfileBasicsFromSupabase()
      if (cancelled) return
      if (!profile) {
        setRedirecting(true)
        const dest = `/login?redirect=${encodeURIComponent(pathname)}`
        router.replace(dest)
        return
      }
      if (!isRoleAllowedOnDashboardVariant(variant, profile.role)) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[permission-check:debug]", {
            flow: "dashboard-shell",
            action: "redirect_variant_mismatch",
            variant,
            role: profile.role,
            dest: getDashboardHomeForRole(profile.role),
          })
        }
        setRedirecting(true)
        router.replace(getDashboardHomeForRole(profile.role))
        return
      }
      setUserName(profile.fullName)
      setUserRoleLabel(formatUserRoleLabel(profile.role))
      setPolicyRole(profile.role)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [variant, lockedProfile, pathname, router])

  if (!ready) {
    if (redirecting) {
      return (
        <>
          <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
            Redirecionando…
          </div>
          <AppToaster variant={variant} />
        </>
      )
    }
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          Carregando…
        </div>
        <AppToaster variant={variant} />
      </>
    )
  }

  return (
    <>
      <NotificationsProvider>
        <DashboardLayout
          variant={variant}
          userName={userName}
          userRole={userRoleLabel}
          policyRole={policyRole}
        >
          {children}
        </DashboardLayout>
      </NotificationsProvider>
      <AppToaster variant={variant} />
    </>
  )
}
