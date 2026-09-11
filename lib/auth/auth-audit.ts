import type { UserRole } from "@/types/user"
import { FIRST_ACCESS_PATH } from "@/lib/commercial-assisted/constants"
import type { DashboardVariant } from "@/lib/auth/dashboard-variant"

export type AuthAuditPayload = {
  role: string | null
  route: string
  allowed: boolean
  reason: string
}

const INACTIVE_ACCOUNT_PATH = "/conta-inativa"

/** Home do painel após login, por perfil. */
export function getDashboardHomeForRole(role: UserRole): string {
  switch (role) {
    case "indicador":
      return "/indicador"
    case "comercial":
      return "/comercial"
    case "funcionario":
      return "/funcionario"
    case "admin_consulta":
    case "admin_financeiro":
    case "admin_master":
      return "/admin"
    default:
      return "/"
  }
}

export function isFirstAccessPath(pathname: string): boolean {
  return (
    pathname === FIRST_ACCESS_PATH ||
    pathname.startsWith(`${FIRST_ACCESS_PATH}/`)
  )
}

export function isInactiveAccountPath(pathname: string): boolean {
  return pathname === INACTIVE_ACCOUNT_PATH || pathname.startsWith(`${INACTIVE_ACCOUNT_PATH}/`)
}

/**
 * Rotas permitidas enquanto must_change_password = true.
 * Demais áreas autenticadas redirecionam para /primeiro-acesso.
 */
export function isAllowedDuringMustChangePassword(pathname: string): boolean {
  if (isFirstAccessPath(pathname)) return true
  if (pathname.startsWith("/auth/logout")) return true
  if (pathname.startsWith("/api/auth/complete-first-password-change")) return true
  return false
}

export function isProfileInactive(isActive: boolean | null | undefined): boolean {
  return isActive === false
}

export function resolvePostAuthPath(input: {
  role: UserRole | null
  mustChangePassword: boolean
  redirectParam?: string | null
  isActive?: boolean | null
}): string {
  if (isProfileInactive(input.isActive)) {
    return INACTIVE_ACCOUNT_PATH
  }
  if (input.mustChangePassword) {
    return FIRST_ACCESS_PATH
  }
  if (
    input.redirectParam &&
    input.redirectParam.startsWith("/") &&
    !input.redirectParam.startsWith("//") &&
    !isFirstAccessPath(input.redirectParam) &&
    !isInactiveAccountPath(input.redirectParam)
  ) {
    return input.redirectParam
  }
  return input.role ? getDashboardHomeForRole(input.role) : "/indicador"
}

/** O layout (variant) da área corresponde ao role do perfil autenticado. */
export function isRoleAllowedOnDashboardVariant(
  variant: DashboardVariant,
  role: UserRole
): boolean {
  if (variant === "indicador") return role === "indicador"
  if (variant === "funcionario") return role === "funcionario"
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
 * Membership de setor é autoridade nas layouts/APIs de /cobranca e /retencao.
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
  if (isFirstAccessPath(pathname)) {
    return { allowed: true, reason: "/primeiro-acesso (qualquer role autenticado)" }
  }
  if (isInactiveAccountPath(pathname)) {
    return { allowed: true, reason: "/conta-inativa" }
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
  if (pathname.startsWith("/funcionario")) {
    if (role === "funcionario") {
      return { allowed: true, reason: "/funcionario + role funcionario" }
    }
    return {
      allowed: false,
      reason: `/funcionario exige role funcionario; obtido: ${role}`,
    }
  }
  if (pathname.startsWith("/comercial")) {
    // Cadastro assistido: UI exclusiva de comercial / admin_master.
    // admin_financeiro continua com acesso ao restante de /comercial (leads).
    // funcionario NÃO herda o legado Comercial 2.1B.
    if (
      pathname === "/comercial/nova-indicacao" ||
      pathname.startsWith("/comercial/nova-indicacao/")
    ) {
      if (role === "comercial" || role === "admin_master") {
        return {
          allowed: true,
          reason: "/comercial/nova-indicacao + comercial|admin_master",
        }
      }
      return {
        allowed: false,
        reason: `/comercial/nova-indicacao exige comercial ou admin_master; obtido: ${role}`,
      }
    }
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
  if (pathname.startsWith("/cobranca") || pathname.startsWith("/retencao")) {
    if (
      role === "funcionario" ||
      role === "comercial" ||
      role === "admin_consulta" ||
      role === "admin_financeiro" ||
      role === "admin_master"
    ) {
      return {
        allowed: true,
        reason:
          `${pathname.startsWith("/cobranca") ? "/cobranca" : "/retencao"} + role operacional/admin (membership checada no servidor)`,
      }
    }
    return {
      allowed: false,
      reason: `${pathname} exige funcionario, comercial ou admin; obtido: ${role}`,
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
  variant: DashboardVariant,
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
