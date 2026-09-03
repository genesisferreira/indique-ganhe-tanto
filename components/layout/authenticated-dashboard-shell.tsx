"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/components/auth/auth-provider"
import { AppToaster } from "@/components/notifications/app-toaster"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { NotificationsProvider } from "@/components/notifications/notifications-provider"
import { mockDataService } from "@/lib/services/mock-data.service"
import type { AuthProfileBasics } from "@/types/auth-profile"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { formatUserRoleLabel } from "@/lib/auth/format-user-role-label"
import {
  evaluateRouteAccessForRole,
  getDashboardHomeForRole,
  isAllowedDuringMustChangePassword,
  isRoleAllowedOnDashboardVariant,
} from "@/lib/auth/auth-audit"
import { FIRST_ACCESS_PATH } from "@/lib/commercial-assisted/constants"
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
  const auth = useAuth()
  const [ready, setReady] = useState(false)
  const [userName, setUserName] = useState("")
  const [userRoleLabel, setUserRoleLabel] = useState("")
  const [policyRole, setPolicyRole] = useState<UserRole | null>(null)
  const [sessionProfile, setSessionProfile] = useState<AuthProfileBasics | null>(
    lockedProfile ?? null
  )
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
          setSessionProfile({
            id: "mock-indicador",
            fullName: snap.currentIndicador.nome,
            email: snap.currentIndicador.email,
            phone: snap.currentIndicador.telefone,
            role: "indicador",
            avatarUrl: null,
            createdAt: null,
          })
        } else if (variant === "comercial") {
          setUserName(snap.currentComercial.nome)
          setUserRoleLabel(formatUserRoleLabel("comercial"))
          setPolicyRole("comercial")
          setSessionProfile({
            id: "mock-comercial",
            fullName: snap.currentComercial.nome,
            email: snap.currentComercial.email,
            phone: snap.currentComercial.telefone,
            role: "comercial",
            avatarUrl: null,
            createdAt: null,
          })
        } else {
          const admin = snap.currentAdmin
          setUserName(admin.nome)
          setUserRoleLabel(formatUserRoleLabel(admin.role))
          setPolicyRole(admin.role)
          setSessionProfile({
            id: "mock-admin",
            fullName: admin.nome,
            email: admin.email,
            phone: admin.telefone,
            role: admin.role,
            avatarUrl: null,
            createdAt: null,
          })
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
        setSessionProfile(lockedProfile)
        if (lockedProfile.mustChangePassword) {
          if (!isAllowedDuringMustChangePassword(pathname)) {
            setRedirecting(true)
            router.replace(FIRST_ACCESS_PATH)
            return
          }
        }
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
        const routeAccess = evaluateRouteAccessForRole(
          pathname,
          lockedProfile.role
        )
        if (!routeAccess.allowed) {
          setRedirecting(true)
          router.replace(getDashboardHomeForRole(lockedProfile.role))
          return
        }
        if (!cancelled) setReady(true)
        return
      }

      if (!auth.ready) return

      if (!auth.profile) {
        setRedirecting(true)
        const dest = `/login?redirect=${encodeURIComponent(pathname)}`
        router.replace(dest)
        return
      }

      if (auth.profile.mustChangePassword) {
        if (!isAllowedDuringMustChangePassword(pathname)) {
          setRedirecting(true)
          router.replace(FIRST_ACCESS_PATH)
          return
        }
      }

      if (!isRoleAllowedOnDashboardVariant(variant, auth.profile.role)) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[permission-check:debug]", {
            flow: "dashboard-shell",
            action: "redirect_variant_mismatch",
            variant,
            role: auth.profile.role,
            dest: getDashboardHomeForRole(auth.profile.role),
          })
        }
        setRedirecting(true)
        router.replace(getDashboardHomeForRole(auth.profile.role))
        return
      }

      const routeAccess = evaluateRouteAccessForRole(pathname, auth.profile.role)
      if (!routeAccess.allowed) {
        setRedirecting(true)
        router.replace(getDashboardHomeForRole(auth.profile.role))
        return
      }

      if (cancelled) return

      setUserName(auth.profile.fullName)
      setUserRoleLabel(formatUserRoleLabel(auth.profile.role))
      setPolicyRole(auth.profile.role)
      setSessionProfile(auth.profile)
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [variant, lockedProfile, pathname, router, auth.ready, auth.profile])

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
      <NotificationsProvider initialProfile={sessionProfile}>
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
