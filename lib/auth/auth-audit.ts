import type { UserRole } from "@/types/user"

export type AuthAuditPayload = {
  role: string | null
  route: string
  allowed: boolean
  reason: string
}

/** Home do painel após login, por perfil. */
export function getDashboardHomeForRole(role: UserRole): string {
  switch (role) {
    case "indicador":
      return "/indicador"
    case "comercial":
      return "/comercial"
    case "admin_consulta":
    case "admin_financeiro":
    case "admin_master":
      return "/admin"
    default:
      return "/"
  }
}

/** O layout (variant) da área corresponde ao role do perfil autenticado. */
export function isRoleAllowedOnDashboardVariant(
  variant: "indicador" | "comercial" | "admin",
  role: UserRole
): boolean {
  if (variant === "indicador") return role === "indicador"
  if (variant === "comercial") {
    return (
      role === "comercial" ||
      role === "admin_financeiro" ||
      role === "admin_master"
    )
  }
  return (
    role === "admin_consulta" ||
    role === "admin_financeiro" ||
    role === "admin_master"
  )
}

/**
 * Log de auditoria de acesso (somente `NODE_ENV === "development"`).
 */
export function logAuthAudit(payload: AuthAuditPayload): void {
  if (process.env.NODE_ENV !== "development") return
  console.log("[auth-audit]", payload)
}

/**
 * Verifica se o prefixo da URL é compatível com o role vindo do perfil Supabase.
 */
export function evaluateRouteAccessForRole(
  pathname: string,
  role: UserRole | null
): { allowed: boolean; reason: string } {
  if (!role) {
    return {
      allowed: false,
      reason: "role ausente (sem sessão ou perfil não carregado)",
    }
  }
  if (pathname.startsWith("/indicador")) {
    if (role === "indicador") {
      return { allowed: true, reason: "/indicador + role indicador" }
    }
    return {
      allowed: false,
      reason: `/indicador exige role indicador; obtido: ${role}`,
    }
  }
  if (pathname.startsWith("/comercial")) {
    if (role === "comercial") {
      return { allowed: true, reason: "/comercial + role comercial" }
    }
    if (role === "admin_financeiro" || role === "admin_master") {
      return {
        allowed: true,
        reason:
          "/comercial + admin financeiro/master (ex.: confirmar 1ª mensalidade no lead)",
      }
    }
    return {
      allowed: false,
      reason: `/comercial exige comercial ou admin financeiro/master; obtido: ${role}`,
    }
  }
  if (pathname.startsWith("/admin")) {
    if (
      role === "admin_consulta" ||
      role === "admin_financeiro" ||
      role === "admin_master"
    ) {
      return { allowed: true, reason: "/admin + role administrativa" }
    }
    return {
      allowed: false,
      reason: `/admin exige admin_consulta | admin_financeiro | admin_master; obtido: ${role}`,
    }
  }
  if (pathname.startsWith("/notificacoes")) {
    return {
      allowed: true,
      reason:
        "/notificacoes: layout por perfil; restrição de dados é RLS em notifications",
    }
  }
  return {
    allowed: true,
    reason: "rota fora dos prefixos de área por perfil (sem regra estrita aqui)",
  }
}

/**
 * Verifica se o `variant` do shell (sidebar) corresponde ao role do perfil.
 */
export function evaluateVariantRoleMatch(
  variant: "indicador" | "comercial" | "admin",
  role: UserRole | null
): { allowed: boolean; reason: string } {
  if (!role) {
    return { allowed: false, reason: "role ausente" }
  }
  if (isRoleAllowedOnDashboardVariant(variant, role)) {
    return {
      allowed: true,
      reason: `variant ${variant} alinhado ao role ${role}`,
    }
  }
  return {
    allowed: false,
    reason: `variant ${variant} incompatível com role ${role}`,
  }
}
