/**
 * Gate de autorização: must_change_password bloqueia operações sensíveis.
 * Usado por APIs Next.js; RLS cobre acesso direto Supabase no browser.
 */

export const PASSWORD_CHANGE_REQUIRED_CODE = "PASSWORD_CHANGE_REQUIRED" as const

export const PASSWORD_CHANGE_REQUIRED_MESSAGE =
  "Defina sua nova senha antes de continuar." as const

export type PasswordChangeGateProfile = {
  must_change_password?: boolean | null
  mustChangePassword?: boolean | null
}

export function isPasswordChangeRequired(
  profile: PasswordChangeGateProfile | null | undefined
): boolean {
  if (!profile) return false
  return (
    profile.must_change_password === true ||
    profile.mustChangePassword === true
  )
}

/**
 * Deny-by-default para operações de negócio do indicador com senha temporária.
 * Retorna null se permitido; caso contrário o payload de erro 403.
 */
export function assertPasswordChangeCompleted(
  profile: PasswordChangeGateProfile | null | undefined
): null | {
  ok: false
  status: 403
  code: typeof PASSWORD_CHANGE_REQUIRED_CODE
  message: typeof PASSWORD_CHANGE_REQUIRED_MESSAGE
} {
  if (!isPasswordChangeRequired(profile)) return null
  return {
    ok: false,
    status: 403,
    code: PASSWORD_CHANGE_REQUIRED_CODE,
    message: PASSWORD_CHANGE_REQUIRED_MESSAGE,
  }
}

/** Espelha a semântica SQL de current_user_password_change_completed(). */
export function currentUserPasswordChangeCompleted(
  mustChangePassword: boolean | null | undefined
): boolean {
  return mustChangePassword !== true
}

/**
 * Classifica se uma operação indicador+cliente seria permitida sob a flag.
 * Usado em testes unitários do inventário P1-2 (espelho de policies).
 */
export type IndicatorClientOperation =
  | "primeiro_acesso_page"
  | "complete_first_password_change"
  | "logout"
  | "profiles_select_own"
  | "profiles_update_own"
  | "pix_keys_mutate"
  | "referrals_insert"
  | "referrals_select_own"
  | "rewards_select_own"
  | "wallet_select_own"
  | "payments_select_own"
  | "request_pix_withdrawal"
  | "create_interest_api"
  | "dashboard_page"

export function isIndicatorClientOperationAllowed(input: {
  mustChangePassword: boolean
  operation: IndicatorClientOperation
}): boolean {
  if (!input.mustChangePassword) return true

  switch (input.operation) {
    case "primeiro_acesso_page":
    case "complete_first_password_change":
    case "logout":
    case "profiles_select_own":
      return true
    default:
      return false
  }
}
