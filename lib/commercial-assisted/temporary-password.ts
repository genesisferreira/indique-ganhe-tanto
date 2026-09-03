import { randomBytes } from "node:crypto"

/**
 * Senha temporária gerada no servidor (nunca persistida).
 * Evita caracteres ambíguos (0/O, 1/l/I) para facilitar digitação/cópia.
 */
const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"

export const ASSISTED_TEMP_PASSWORD_LENGTH = 16

export function generateAssistedTemporaryPassword(
  length: number = ASSISTED_TEMP_PASSWORD_LENGTH
): string {
  if (length < 12) {
    throw new Error("temporary_password_too_short")
  }
  const bytes = randomBytes(length)
  const chars: string[] = []
  for (let i = 0; i < length; i += 1) {
    chars.push(TEMP_PASSWORD_ALPHABET[bytes[i]! % TEMP_PASSWORD_ALPHABET.length]!)
  }
  return chars.join("")
}
