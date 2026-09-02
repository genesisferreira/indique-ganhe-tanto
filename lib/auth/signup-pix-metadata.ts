import type { TipoChavePix } from "@/types/profile"
import { validateIndicatorPixKeyForSignup } from "./pix-key-validation"

export type SignupPixMetadataState = "absent" | "partial" | "complete"

export type SignupPixTriggerError =
  | "invalid_pix_metadata"
  | "invalid_pix_key_type"
  | "invalid_pix_key_value"
  | "pix_key_already_registered"
  | "pix_primary_already_exists"

export type SignupPixTriggerDecision =
  | { action: "profile_only" }
  | { action: "insert_pix"; keyType: TipoChavePix; normalizedValue: string }
  | { action: "skip_pix"; reason: "same_profile_same_key" }
  | { action: "reject"; reason: SignupPixTriggerError }

export type ExistingPixKeyRow = {
  profile_id: string
  key_value: string
  is_primary?: boolean
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function classifySignupPixMetadata(
  pixKeyType: string | null | undefined,
  pixKeyValue: string | null | undefined
): SignupPixMetadataState {
  const typeRaw = trimOrNull(pixKeyType ?? null)
  const valueRaw = trimOrNull(pixKeyValue ?? null)

  if (typeRaw === null && valueRaw === null) {
    return "absent"
  }
  if (typeRaw === null || valueRaw === null) {
    return "partial"
  }
  return "complete"
}

/**
 * Espelha a política do trigger handle_new_user_profile() para testes unitários.
 * Nunca transfere profile_id entre usuários.
 */
export function resolveSignupPixTriggerDecision(input: {
  pixKeyType: string | null | undefined
  pixKeyValue: string | null | undefined
  newUserId: string
  existingPixKeys: ExistingPixKeyRow[]
}): SignupPixTriggerDecision {
  const metadataState = classifySignupPixMetadata(input.pixKeyType, input.pixKeyValue)

  if (metadataState === "absent") {
    return { action: "profile_only" }
  }

  if (metadataState === "partial") {
    return { action: "reject", reason: "invalid_pix_metadata" }
  }

  const validation = validateIndicatorPixKeyForSignup(
    input.pixKeyType!.trim(),
    input.pixKeyValue!.trim()
  )
  if (!validation.ok) {
    return { action: "reject", reason: validation.reason }
  }

  const { keyType, normalizedValue } = validation

  const existingPrimary = input.existingPixKeys.find(
    (row) => row.profile_id === input.newUserId && row.is_primary !== false
  )
  if (existingPrimary) {
    if (existingPrimary.key_value === normalizedValue) {
      return { action: "skip_pix", reason: "same_profile_same_key" }
    }
    return { action: "reject", reason: "pix_primary_already_exists" }
  }

  const owner = input.existingPixKeys.find((row) => row.key_value === normalizedValue)
  if (owner) {
    if (owner.profile_id !== input.newUserId) {
      return { action: "reject", reason: "pix_key_already_registered" }
    }
    return { action: "skip_pix", reason: "same_profile_same_key" }
  }

  return { action: "insert_pix", keyType, normalizedValue }
}
