"use client"

/**
 * Shell do dashboard (sidebar + área principal). Com Supabase, prefira montar via
 * `AuthenticatedDashboardShell` para nome e role reais do perfil autenticado.
 */
import { Sidebar } from "./sidebar"
import { AuthRouteAudit } from "@/components/auth-route-audit"
import type { UserRole } from "@/types/user"
import type { DashboardVariant } from "@/lib/auth/dashboard-variant"

interface DashboardLayoutProps {
  children: React.ReactNode
  variant: DashboardVariant
  userName: string
  userRole: string
  /** Role real do perfil (filtros de menu); opcional em layouts legados. */
  policyRole?: UserRole | null
}

export function DashboardLayout({
  children,
  variant,
  userName,
  userRole,
  policyRole = null,
}: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <AuthRouteAudit variant={variant} />
      <Sidebar
        variant={variant}
        userName={userName}
        userRole={userRole}
        policyRole={policyRole}
      />
      <main className="flex-1 pt-14 lg:pt-0">
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  )
}
