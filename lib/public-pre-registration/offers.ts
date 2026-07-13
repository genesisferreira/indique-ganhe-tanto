/**
 * Catálogo comercial exclusivo do pré-cadastro público.
 * Não depende de `plans` nem do Controllr — source of truth server-side.
 */

export type PublicPreRegistrationOffer = {
  code: string
  name: string
  price: number
  displayPrice: string
}

export const PUBLIC_PRE_REGISTRATION_OFFERS: readonly PublicPreRegistrationOffer[] =
  [
    {
      code: "500_mega",
      name: "500 MEGA",
      price: 89.9,
      displayPrice: "R$ 89,90",
    },
    {
      code: "1000_mega",
      name: "1000 MEGA",
      price: 99.9,
      displayPrice: "R$ 99,90",
    },
    {
      code: "1000_mega_mesh",
      name: "1000 MEGA + MESH",
      price: 124.9,
      displayPrice: "R$ 124,90",
    },
    {
      code: "corporativo_1",
      name: "PLANO CORPORATIVO 1",
      price: 199.9,
      displayPrice: "R$ 199,90",
    },
    {
      code: "corporativo_2",
      name: "PLANO CORPORATIVO 2",
      price: 349.9,
      displayPrice: "R$ 349,90",
    },
    {
      code: "tanto_play",
      name: "TANTO PLAY",
      price: 134.9,
      displayPrice: "R$ 134,90",
    },
    {
      code: "tanto_play_cinema",
      name: "TANTO PLAY CINEMA",
      price: 154.9,
      displayPrice: "R$ 154,90",
    },
    {
      code: "tanto_play_sports",
      name: "TANTO PLAY SPORTS",
      price: 154.9,
      displayPrice: "R$ 154,90",
    },
    {
      code: "tanto_play_elite",
      name: "TANTO PLAY ELITE",
      price: 184.9,
      displayPrice: "R$ 184,90",
    },
    {
      code: "smart_one",
      name: "SMART ONE",
      price: 124.9,
      displayPrice: "R$ 124,90",
    },
    {
      code: "smart_plus",
      name: "SMART PLUS",
      price: 144.9,
      displayPrice: "R$ 144,90",
    },
    {
      code: "smart_pro",
      name: "SMART PRO",
      price: 164.9,
      displayPrice: "R$ 164,90",
    },
    {
      code: "tanto_fone_400",
      name: "TANTO FONE 400",
      price: 99.9,
      displayPrice: "R$ 99,90",
    },
    {
      code: "tanto_fone_1000",
      name: "TANTO FONE 1000",
      price: 124.9,
      displayPrice: "R$ 124,90",
    },
    {
      code: "tanto_gamer_s",
      name: "TANTO GAMER S",
      price: 144.9,
      displayPrice: "R$ 144,90",
    },
  ] as const

const OFFERS_BY_CODE = new Map(
  PUBLIC_PRE_REGISTRATION_OFFERS.map((offer) => [offer.code, offer])
)

export function getPublicPreRegistrationOfferByCode(
  code: string | null | undefined
): PublicPreRegistrationOffer | null {
  const key = code?.trim()
  if (!key) return null
  return OFFERS_BY_CODE.get(key) ?? null
}

export function formatPublicOfferSelectLabel(
  offer: PublicPreRegistrationOffer
): string {
  return `${offer.name} — ${offer.displayPrice}`
}

export function formatPublicOfferPrice(
  price: number | null | undefined
): string | null {
  if (price == null || !Number.isFinite(Number(price))) return null
  return Number(price).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
}
