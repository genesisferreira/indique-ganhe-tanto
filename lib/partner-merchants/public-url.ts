export const PARTNER_PUBLIC_ORIGIN = "https://crm.tantotelecom.com.br"

export function partnerPublicUrl(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("partner_token_shape")
  }
  return `${PARTNER_PUBLIC_ORIGIN}/parceiro/${token}`
}

export function isPartnerPublicUrl(url: string): boolean {
  return new RegExp(`^${PARTNER_PUBLIC_ORIGIN.replace(/\./g, "\\.")}/parceiro/[A-Za-z0-9_-]{43}$`).test(url)
}
