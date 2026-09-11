import type { UserRole } from "@/types/user"
import { isAdminMasterRole } from "@/lib/auth/sector-membership"

export type OperationalAdminSettingsAuth =
  | { ok: true; kind: "admin_master" | "admin_consulta"; profileId: string; canWrite: boolean }
  | { ok: false; status: 401 | 403; message: string }

export function authorizeOperationalAdminSettings(input: {
  userId?: string | null
  profileId?: string | null
  role?: UserRole | string | null
  action: "read" | "write"
}): OperationalAdminSettingsAuth {
  if (!input.userId?.trim()) {
    return { ok: false, status: 401, message: "Sessão não encontrada. Faça login novamente." }
  }
  if (!input.profileId || input.profileId !== input.userId) {
    return { ok: false, status: 403, message: "Perfil não autorizado." }
  }
  const role = input.role as UserRole | null
  if (isAdminMasterRole(role)) {
    return {
      ok: true,
      kind: "admin_master",
      profileId: input.profileId,
      canWrite: true,
    }
  }
  if (role === "admin_consulta" && input.action === "read") {
    return {
      ok: true,
      kind: "admin_consulta",
      profileId: input.profileId,
      canWrite: false,
    }
  }
  return {
    ok: false,
    status: 403,
    message: "Configurações operacionais restritas ao Admin Master (consulta somente leitura).",
  }
}

export function authorizeRetentionCustomerAccess(input: {
  role?: UserRole | string | null
  membershipActive: boolean
  employeeStatus?: string | null
  action: "read" | "write"
}): { ok: true } | { ok: false; status: 403; message: string } {
  if (isAdminMasterRole(input.role)) return { ok: true }
  if (input.action === "read" && input.role === "admin_consulta") return { ok: true }
  if (input.role === "admin_financeiro") {
    return { ok: false, status: 403, message: "Acesso operacional de Retenção não liberado." }
  }
  if (input.employeeStatus !== "active" || input.membershipActive !== true) {
    return {
      ok: false,
      status: 403,
      message: "É necessário employee ativo com membership em retention.",
    }
  }
  if (input.action === "write" && input.role === "admin_consulta") {
    return { ok: false, status: 403, message: "Perfil com leitura somente." }
  }
  return { ok: true }
}
