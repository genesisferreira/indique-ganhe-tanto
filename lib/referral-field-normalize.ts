/** Normalização leve para campos de indicação (cliente e servidor). */

/** Remove caracteres não numéricos. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "")
}

/**
 * Telefone BR: DDD + número (10 ou 11 dígitos).
 * Remove +55 e caracteres não numéricos.
 */
export function normalizeReferralPhone(
  value: string | null | undefined
): string | null {
  if (value == null) return null
  let digits = digitsOnly(value)
  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2)
  }
  if (digits.length === 11 || digits.length === 10) return digits
  if (digits.length > 11) return digits.slice(-11)
  if (digits.length >= 8) return digits
  return null
}

/** CPF/CNPJ: somente dígitos; retorna null se vazio. */
export function normalizeReferralDocument(
  value: string | null | undefined
): string | null {
  if (value == null) return null
  const digits = digitsOnly(value)
  return digits.length > 0 ? digits : null
}

/** CEP: somente dígitos; retorna null se vazio. */
export function normalizeReferralZipcode(
  value: string | null | undefined
): string | null {
  if (value == null) return null
  const digits = digitsOnly(value)
  return digits.length > 0 ? digits : null
}
