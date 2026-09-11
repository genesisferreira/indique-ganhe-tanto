import type { UserRole } from "@/types/user"

/** Rótulo amigável do perfil para sidebar / layout. */
export function formatUserRoleLabel(role: UserRole): string {
  switch (role) {
    case "indicador":
      return "Indicador"
    case "comercial":
      return "Comercial"
    case "funcionario":
      return "Funcionário"
    case "admin_consulta":
      return "Administrador (consulta)"
    case "admin_financeiro":
      return "Administrador (financeiro)"
    case "admin_master":
      return "Administrador (master)"
    default:
      return "Usuário"
  }
}
