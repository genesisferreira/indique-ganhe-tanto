import type { UserRole } from "@/types/user"

export type DashboardVariant = "indicador" | "comercial" | "admin" | "funcionario"

export function dashboardVariantForRole(role: UserRole): DashboardVariant {
  if (role === "indicador") return "indicador"
  if (role === "comercial") return "comercial"
  if (role === "funcionario") return "funcionario"
  return "admin"
}

/** Shell de /cobranca e /retencao: funcionario tem identidade própria, não “Comercial”. */
export function operationalShellVariantForRole(
  role: UserRole
): "comercial" | "admin" | "funcionario" {
  if (role === "funcionario") return "funcionario"
  if (
    role === "admin_consulta" ||
    role === "admin_financeiro" ||
    role === "admin_master"
  ) {
    return "admin"
  }
  return "comercial"
}

export function isAdminDashboardRole(role: string | null | undefined): boolean {
  return (
    role === "admin_consulta" ||
    role === "admin_financeiro" ||
    role === "admin_master"
  )
}

export function isFuncionarioRole(role: string | null | undefined): boolean {
  return role === "funcionario"
}
