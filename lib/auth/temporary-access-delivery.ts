export const CRM_LOGIN_URL = "https://crm.tantotelecom.com.br/login" as const

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function buildTemporaryAccessClipboardText(input: {
  email: string
  temporaryPassword: string
  loginUrl?: string
}): string {
  const url = input.loginUrl ?? CRM_LOGIN_URL
  return [
    "Acesso ao Indique e Ganhe — Tanto Telecom",
    "",
    `Login: ${normalizeLoginEmail(input.email)}`,
    `Senha temporária: ${input.temporaryPassword}`,
    "",
    "Acesse:",
    url,
    "",
    "No primeiro acesso, você deverá criar uma nova senha.",
  ].join("\n")
}
