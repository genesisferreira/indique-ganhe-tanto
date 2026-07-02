import type { UserRole } from "@/types/user"

export type DemoDashboardRole = "indicador" | "comercial" | "admin"

type DemoCredentials = {
  email: string
  password: string
  expectedRole: UserRole
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? ""
}

/** Credenciais opcionais de demonstração (variáveis NEXT_PUBLIC_*). */
export function getDemoCredentials(
  role: DemoDashboardRole
): DemoCredentials | null {
  const map: Record<DemoDashboardRole, DemoCredentials | null> = {
    indicador: pair(
      readEnv("NEXT_PUBLIC_DEMO_INDICADOR_EMAIL"),
      readEnv("NEXT_PUBLIC_DEMO_INDICADOR_PASSWORD"),
      "indicador"
    ),
    comercial: pair(
      readEnv("NEXT_PUBLIC_DEMO_COMERCIAL_EMAIL"),
      readEnv("NEXT_PUBLIC_DEMO_COMERCIAL_PASSWORD"),
      "comercial"
    ),
    admin: pair(
      readEnv("NEXT_PUBLIC_DEMO_ADMIN_EMAIL"),
      readEnv("NEXT_PUBLIC_DEMO_ADMIN_PASSWORD"),
      "admin_master"
    ),
  }

  return map[role]
}

function pair(
  email: string,
  password: string,
  expectedRole: UserRole
): DemoCredentials | null {
  if (!email || !password) return null
  return { email, password, expectedRole }
}

export function getDemoDashboardPath(role: DemoDashboardRole): string {
  if (role === "indicador") return "/indicador"
  if (role === "comercial") return "/comercial"
  return "/admin"
}
