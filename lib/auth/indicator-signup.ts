import type { Session, User } from "@supabase/supabase-js"
import type { TipoChavePix } from "@/types/profile"

export const INDICATOR_PIX_KEY_TYPES: readonly TipoChavePix[] = [
  "cpf",
  "cnpj",
  "email",
  "telefone",
  "aleatoria",
]

export const SIGNUP_EXISTING_ACCOUNT_MESSAGE =
  "Não foi possível concluir um novo cadastro com esses dados. Se você já possui uma conta, faça login ou recupere sua senha."

export const SIGNUP_SESSION_MISMATCH_MESSAGE =
  "Não foi possível concluir o cadastro nesta sessão. Faça login para continuar."

export type IndicatorSignupUserMetadata = {
  full_name: string
  phone: string
  pix_key_type: string
  pix_key_value: string
}

export type IndicatorSignupOutcome =
  | "existing_account_hint"
  | "awaiting_email_confirmation"
  | "authenticated_ready"
  | "session_mismatch"

export function buildSignupEmailRedirectTo(origin: string): string {
  const base = origin.trim().replace(/\/+$/, "")
  return `${base}/login`
}

export function buildIndicatorSignupUserMetadata(input: {
  fullName: string
  phone: string
  pixKeyType: string
  pixKeyValue: string
}): IndicatorSignupUserMetadata {
  return {
    full_name: input.fullName.trim(),
    phone: input.phone.trim(),
    pix_key_type: input.pixKeyType.trim(),
    pix_key_value: input.pixKeyValue.trim(),
  }
}

export function isIndicatorPixKeyType(value: string): value is TipoChavePix {
  return (INDICATOR_PIX_KEY_TYPES as readonly string[]).includes(value)
}

/** Supabase anti-enumeration: user object without identities usually means e-mail already registered. */
export function isSignupExistingAccountHint(user: User | null | undefined): boolean {
  if (!user) return false
  const identities = user.identities
  return Array.isArray(identities) && identities.length === 0
}

export function classifyIndicatorSignupResult(
  user: User | null | undefined,
  session: Session | null | undefined
): IndicatorSignupOutcome | null {
  if (!user?.id) return null

  if (isSignupExistingAccountHint(user)) {
    return "existing_account_hint"
  }

  if (!session?.user?.id) {
    return "awaiting_email_confirmation"
  }

  if (session.user.id !== user.id) {
    return "session_mismatch"
  }

  return "authenticated_ready"
}

/** Metadata keys allowed on signUp — never includes profile_id or other privileged fields. */
export function getIndicatorSignupMetadataKeys(metadata: IndicatorSignupUserMetadata): string[] {
  return Object.keys(metadata).filter(
    (key) => key !== "profile_id" && key in metadata
  )
}
