/** Mascaramento LGPD para respostas de busca de indicadores (server-side). */

export function maskPhoneForDisplay(phone: string | null | undefined): string | null {
  if (phone == null) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 4) return null
  const last4 = digits.slice(-4)
  return `(**) *****-${last4}`
}

export function maskEmailForDisplay(email: string | null | undefined): string | null {
  if (email == null) return null
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.indexOf("@")
  if (at <= 0 || at === trimmed.length - 1) return null
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  if (!domain.includes(".")) return null
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

export function maskCpfForDisplay(cpf: string | null | undefined): string | null {
  if (cpf == null) return null
  const digits = cpf.replace(/\D/g, "")
  if (digits.length !== 11) return null
  return `***.***.***-${digits.slice(-2)}`
}

export function maskCnpjForDisplay(cnpj: string | null | undefined): string | null {
  if (cnpj == null) return null
  const digits = cnpj.replace(/\D/g, "")
  if (digits.length !== 14) return null
  return `**.***.***/****-${digits.slice(-2)}`
}

export function maskDocumentForDisplay(
  document: string | null | undefined,
  personType: "pf" | "pj" | string | null | undefined
): string | null {
  if (personType === "pj") return maskCnpjForDisplay(document)
  return maskCpfForDisplay(document)
}
