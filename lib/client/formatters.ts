/** Formatação e validação leve para inputs do formulário de indicação (client-only). */

/** Remove caracteres não numéricos. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "")
}

/** Máscara progressiva: (31) 99999-9999 ou (31) 3333-4444 */
export function formatPhoneBR(value: string): string {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length === 0) return ""
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

/** Máscara progressiva: 000.000.000-00 */
export function formatCPF(value: string): string {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/** Máscara progressiva: 00000-000 */
export function formatCEP(value: string): string {
  const digits = onlyDigits(value).slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

/** Telefone BR com DDD: 10 (fixo) ou 11 (celular) dígitos. */
export function isValidPhoneBR(value: string): boolean {
  let digits = onlyDigits(value)
  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2)
  }
  if (digits.length > 11) digits = digits.slice(-11)
  return digits.length === 10 || digits.length === 11
}

/** CEP com exatamente 8 dígitos. */
export function isValidCEP(value: string): boolean {
  return onlyDigits(value).length === 8
}

/** Validação básica de CPF (dígitos verificadores + rejeita sequências iguais). */
export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += Number(cpf[i]) * (10 - i)
  }
  let remainder = (sum * 10) % 11
  if (remainder === 10) remainder = 0
  if (remainder !== Number(cpf[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) {
    sum += Number(cpf[i]) * (11 - i)
  }
  remainder = (sum * 10) % 11
  if (remainder === 10) remainder = 0
  return remainder === Number(cpf[10])
}
