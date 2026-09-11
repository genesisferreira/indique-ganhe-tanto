"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"
import {
  evaluateRouteAccessForRole,
  evaluateVariantRoleMatch,
  logAuthAudit,
} from "@/lib/auth/auth-audit"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import type { UserRole } from "@/types/user"
import type { DashboardVariant } from "@/lib/auth/dashboard-variant"

type AuthRouteAuditProps = {
  variant: DashboardVariant
  /** Quando true, não consulta perfil nem loga (ex.: layout ainda sem sessão). */
  disabled?: boolean
}

/**
 * Em desenvolvimento, registra alinhamento entre rota, variant do layout e role do perfil (`[auth-audit]`).
 * Não altera layout (renderiza null).
 */
export function AuthRouteAudit({ variant, disabled }: AuthRouteAuditProps) {
  const pathname = usePathname()

  useEffect(() => {
    if (disabled || process.env.NODE_ENV !== "development") return
    let cancelled = false
    void (async () => {
      const basics = await getAuthProfileBasicsFromSupabase()
      if (cancelled) return
      const role = (basics?.role ?? null) as UserRole | null
      const pathEval = evaluateRouteAccessForRole(pathname, role)
      const variantEval = evaluateVariantRoleMatch(variant, role)
      const allowed = pathEval.allowed && variantEval.allowed
      if (process.env.NODE_ENV === "development") {
        console.log("[permission-check:debug]", {
          route: pathname,
          variant,
          role,
          routeOk: pathEval.allowed,
          variantOk: variantEval.allowed,
          allowed,
        })
      }
      logAuthAudit({
        role: role ?? "(null)",
        route: pathname,
        allowed,
        reason: allowed
          ? "rota e variant coerentes com o role"
          : `rota: ${pathEval.reason}; variant: ${variantEval.reason}`,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [pathname, variant, disabled])

  return null
}
