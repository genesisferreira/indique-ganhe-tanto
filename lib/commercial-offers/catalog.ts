/**
 * Catálogo comercial canônico (pré-cadastro + Nova Indicação).
 * Ofertas comerciais NÃO são `public.plans`.
 * O preço exibido NÃO define recompensa — no Indique e Ganhe a recompensa
 * é o valor efetivamente pago na primeira fatura Controllr.
 */

import type { PublicPlanSlotKey } from "@/lib/public-pre-registration/plan-resolver"

export type CommercialOffer = {
  code: string
  name: string
  price: number
  displayPrice: string
  /**
   * Hint técnico opcional do plano CRM usado só para `plan_id` / `plan_pk`
   * na criação do Interessado. NÃO define elegibilidade visual nem o valor
   * da recompensa. `null` = usar plano CRM base documentado via env.
   */
  controllrPlanSlot: PublicPlanSlotKey | null
}

/** @deprecated Use controllrPlanSlot */
export type CommercialOfferLegacySlot = CommercialOffer & {
  indicatorRewardPlanSlot?: PublicPlanSlotKey | null
}

/** @deprecated Use CommercialOffer */
export type PublicPreRegistrationOffer = CommercialOffer

export const COMMERCIAL_OFFERS: readonly CommercialOffer[] = [
  {
    code: "500_mega",
    name: "500 MEGA",
    price: 89.9,
    displayPrice: "R$ 89,90",
    controllrPlanSlot: "500",
  },
  {
    code: "1000_mega",
    name: "1000 MEGA",
    price: 99.9,
    displayPrice: "R$ 99,90",
    controllrPlanSlot: "1000",
  },
  {
    code: "1000_mega_mesh",
    name: "1000 MEGA + MESH",
    price: 124.9,
    displayPrice: "R$ 124,90",
    controllrPlanSlot: "1000",
  },
  {
    code: "corporativo_1",
    name: "PLANO CORPORATIVO 1",
    price: 199.9,
    displayPrice: "R$ 199,90",
    controllrPlanSlot: null,
  },
  {
    code: "corporativo_2",
    name: "PLANO CORPORATIVO 2",
    price: 349.9,
    displayPrice: "R$ 349,90",
    controllrPlanSlot: null,
  },
  {
    code: "tanto_play",
    name: "TANTO PLAY",
    price: 134.9,
    displayPrice: "R$ 134,90",
    controllrPlanSlot: null,
  },
  {
    code: "tanto_play_cinema",
    name: "TANTO PLAY CINEMA",
    price: 154.9,
    displayPrice: "R$ 154,90",
    controllrPlanSlot: null,
  },
  {
    code: "tanto_play_sports",
    name: "TANTO PLAY SPORTS",
    price: 154.9,
    displayPrice: "R$ 154,90",
    controllrPlanSlot: null,
  },
  {
    code: "tanto_play_elite",
    name: "TANTO PLAY ELITE",
    price: 184.9,
    displayPrice: "R$ 184,90",
    controllrPlanSlot: null,
  },
  {
    code: "smart_one",
    name: "SMART ONE",
    price: 124.9,
    displayPrice: "R$ 124,90",
    controllrPlanSlot: null,
  },
  {
    code: "smart_plus",
    name: "SMART PLUS",
    price: 144.9,
    displayPrice: "R$ 144,90",
    controllrPlanSlot: null,
  },
  {
    code: "smart_pro",
    name: "SMART PRO",
    price: 164.9,
    displayPrice: "R$ 164,90",
    controllrPlanSlot: null,
  },
  {
    code: "tanto_fone_400",
    name: "TANTO FONE 400",
    price: 99.9,
    displayPrice: "R$ 99,90",
    controllrPlanSlot: null,
  },
  {
    code: "tanto_fone_1000",
    name: "TANTO FONE 1000",
    price: 124.9,
    displayPrice: "R$ 124,90",
    controllrPlanSlot: null,
  },
  {
    code: "tanto_gamer_s",
    name: "TANTO GAMER S",
    price: 144.9,
    displayPrice: "R$ 144,90",
    controllrPlanSlot: null,
  },
] as const

/** Alias — mesma fonte do pré-cadastro. */
export const PUBLIC_PRE_REGISTRATION_OFFERS = COMMERCIAL_OFFERS

const OFFERS_BY_CODE = new Map(
  COMMERCIAL_OFFERS.map((offer) => [offer.code, offer])
)

export function getCommercialOfferByCode(
  code: string | null | undefined
): CommercialOffer | null {
  const key = code?.trim()
  if (!key) return null
  return OFFERS_BY_CODE.get(key) ?? null
}

/** @deprecated Use getCommercialOfferByCode */
export function getPublicPreRegistrationOfferByCode(
  code: string | null | undefined
): CommercialOffer | null {
  return getCommercialOfferByCode(code)
}

export function getAllCommercialOffers(): readonly CommercialOffer[] {
  return COMMERCIAL_OFFERS
}

/**
 * Ofertas exibidas na Nova Indicação = catálogo completo ativo.
 * Não filtra por controllrPlanSlot.
 */
export function getIndicatorEligibleOffers(): CommercialOffer[] {
  return [...COMMERCIAL_OFFERS]
}

export function isIndicatorEligibleOffer(
  code: string | null | undefined
): boolean {
  return getCommercialOfferByCode(code) != null
}

export function formatCommercialOfferSelectLabel(
  offer: CommercialOffer
): string {
  return `${offer.name} — ${offer.displayPrice}`
}

/** @deprecated Use formatCommercialOfferSelectLabel */
export function formatPublicOfferSelectLabel(
  offer: CommercialOffer
): string {
  return formatCommercialOfferSelectLabel(offer)
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
