import type { UserRole } from "@/types/user"
import {
  COMMERCIAL_INDICATOR_SEARCH_ALLOWED_ROLES,
  type CommercialIndicatorSearchAllowedRole,
} from "./constants"

export type IndicatorSearchActorProfile = {
  id: string
  role: string
  is_active: boolean | null
}

export type IndicatorSearchAuthResult =
  | {
      ok: true
      profileId: string
      role: CommercialIndicatorSearchAllowedRole
    }
  | {
      ok: false
      status: 401 | 403
      message: string
    }

export function isCommercialIndicatorSearchAllowedRole(
  role: string | null | undefined
): role is CommercialIndicatorSearchAllowedRole {
  return (
    role === "comercial" ||
    role === "admin_master"
  )
}

/**
 * Autorização da busca de indicadores.
 * - comercial ativo: SIM
 * - admin_master ativo: SIM (suporte)
 * - indicador / admin_consulta / admin_financeiro / inativo / sem sessão: NÃO
 */
export function authorizeCommercialIndicatorSearch(input: {
  userId: string | null | undefined
  profile: IndicatorSearchActorProfile | null | undefined
}): IndicatorSearchAuthResult {
  if (!input.userId) {
    return {
      ok: false,
      status: 401,
      message: "Sessão não encontrada. Faça login novamente.",
    }
  }

  if (!input.profile || input.profile.id !== input.userId) {
    return {
      ok: false,
      status: 403,
      message: "Perfil não autorizado.",
    }
  }

  if (input.profile.is_active === false) {
    return {
      ok: false,
      status: 403,
      message: "Perfil inativo.",
    }
  }

  const role = input.profile.role as UserRole
  if (!isCommercialIndicatorSearchAllowedRole(role)) {
    return {
      ok: false,
      status: 403,
      message: "Acesso restrito ao Comercial.",
    }
  }

  return {
    ok: true,
    profileId: input.profile.id,
    role,
  }
}
