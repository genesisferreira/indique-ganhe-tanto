/**
 * Catálogo comercial canônico (pré-cadastro + Rede Neutra + Nova Indicação).
 * Ofertas comerciais NÃO são `public.plans`.
 * O preço exibido NÃO define recompensa — no Indique e Ganhe a recompensa
 * é o valor efetivamente pago na primeira fatura Controllr.
 */

import type { PublicPlanSlotKey } from "@/lib/public-pre-registration/plan-resolver"
import type { ReferralContractType } from "@/types/referral"

export type CommercialOfferModality = ReferralContractType

export type CommercialOffer = {
  code: string
  name: string
  /** Preço Tanto Livre (também usado pela Rede Neutra). */
  priceLivre: number
  /** Preço Tanto Vantagens. */
  priceVantagens: number
  /**
   * Alias de compatibilidade = priceVantagens.
   * Preferir resolveOfferPrice / listOffersForModality.
   * NÃO usar como valor de recompensa.
   */
  price: number
  /** Label de preço Vantagens (compat). */
  displayPrice: string
  displayPriceLivre: string
  displayPriceVantagens: string
  availableInPreRegistration: boolean
  availableInNeutralNetwork: boolean
  availableInIndicator: boolean
  /** Corporativos: false em Vantagens. */
  availableInVantagens: boolean
  availableInLivre: boolean
  /**
   * Hint técnico opcional do plano CRM usado só para `plan_id` / `plan_pk`.
   * NÃO define elegibilidade visual nem o valor da recompensa.
   */
  controllrPlanSlot: PublicPlanSlotKey | null
}

/** Oferta com preço já resolvido para a modalidade/canal. */
export type ResolvedCommercialOffer = {
  code: string
  name: string
  price: number
  displayPrice: string
  modality: CommercialOfferModality
  base: CommercialOffer
}

/** @deprecated Use controllrPlanSlot */
export type CommercialOfferLegacySlot = CommercialOffer & {
  indicatorRewardPlanSlot?: PublicPlanSlotKey | null
}

/** @deprecated Use CommercialOffer */
export type PublicPreRegistrationOffer = CommercialOffer

function moneyLabel(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`
}

function offer(input: {
  code: string
  name: string
  priceLivre: number
  priceVantagens: number | null
  controllrPlanSlot: PublicPlanSlotKey | null
  availableInPreRegistration?: boolean
  availableInNeutralNetwork?: boolean
  availableInIndicator?: boolean
}): CommercialOffer {
  const priceVantagens = input.priceVantagens ?? input.priceLivre
  const availableInVantagens = input.priceVantagens != null
  return {
    code: input.code,
    name: input.name,
    priceLivre: input.priceLivre,
    priceVantagens,
    price: priceVantagens,
    displayPrice: moneyLabel(priceVantagens),
    displayPriceLivre: moneyLabel(input.priceLivre),
    displayPriceVantagens: moneyLabel(priceVantagens),
    availableInPreRegistration: input.availableInPreRegistration ?? true,
    availableInNeutralNetwork: input.availableInNeutralNetwork ?? true,
    availableInIndicator: input.availableInIndicator ?? true,
    availableInVantagens,
    availableInLivre: true,
    controllrPlanSlot: input.controllrPlanSlot,
  }
}

/**
 * Catálogo canônico.
 * Código `tanto_gamer_s` preservado (produção) — nome comercial "TANTO GAMER S".
 * Em Vantagens o róulo de marketing pode ser "TANTO GAMER"; o code permanece.
 */
export const COMMERCIAL_OFFERS: readonly CommercialOffer[] = [
  offer({
    code: "500_mega",
    name: "500 MEGA",
    priceLivre: 109.9,
    priceVantagens: 89.9,
    controllrPlanSlot: "500",
  }),
  offer({
    code: "1000_mega",
    name: "1000 MEGA",
    priceLivre: 119.9,
    priceVantagens: 99.9,
    controllrPlanSlot: "1000",
  }),
  offer({
    code: "1000_mega_mesh",
    name: "1000 MEGA + MESH",
    priceLivre: 144.9,
    priceVantagens: 124.9,
    controllrPlanSlot: "1000",
  }),
  offer({
    code: "corporativo_1",
    name: "PLANO CORPORATIVO 1",
    priceLivre: 199.9,
    priceVantagens: null,
    controllrPlanSlot: null,
  }),
  offer({
    code: "corporativo_2",
    name: "PLANO CORPORATIVO 2",
    priceLivre: 349.9,
    priceVantagens: null,
    controllrPlanSlot: null,
  }),
  offer({
    code: "tanto_play",
    name: "TANTO PLAY",
    priceLivre: 154.9,
    priceVantagens: 134.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "tanto_play_cinema",
    name: "TANTO PLAY CINEMA",
    priceLivre: 174.9,
    priceVantagens: 154.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "tanto_play_sports",
    name: "TANTO PLAY SPORTS",
    priceLivre: 174.9,
    priceVantagens: 154.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "tanto_play_elite",
    name: "TANTO PLAY ELITE",
    priceLivre: 204.9,
    priceVantagens: 184.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "smart_one",
    name: "SMART ONE",
    priceLivre: 144.9,
    priceVantagens: 124.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "smart_plus",
    name: "SMART PLUS",
    priceLivre: 164.9,
    priceVantagens: 144.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "smart_pro",
    name: "SMART PRO",
    priceLivre: 184.9,
    priceVantagens: 164.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "tanto_fone_400",
    name: "TANTO FONE 400",
    priceLivre: 119.9,
    priceVantagens: 99.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "tanto_fone_1000",
    name: "TANTO FONE 1000",
    priceLivre: 144.9,
    priceVantagens: 124.9,
    controllrPlanSlot: null,
  }),
  offer({
    code: "tanto_gamer_s",
    name: "TANTO GAMER S",
    priceLivre: 164.9,
    priceVantagens: 144.9,
    controllrPlanSlot: null,
  }),
] as const

/** Alias — mesma fonte do pré-cadastro. */
export const PUBLIC_PRE_REGISTRATION_OFFERS = COMMERCIAL_OFFERS

const OFFERS_BY_CODE = new Map(
  COMMERCIAL_OFFERS.map((item) => [item.code, item])
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

export function isCommercialOfferModality(
  value: string | null | undefined
): value is CommercialOfferModality {
  return value === "tanto_livre" || value === "tanto_vantagens"
}

export function resolveOfferPrice(
  code: string | null | undefined,
  modality: CommercialOfferModality
): number | null {
  const resolved = resolveOfferForModality(code, modality)
  return resolved?.price ?? null
}

export function resolveOfferForModality(
  code: string | null | undefined,
  modality: CommercialOfferModality
): ResolvedCommercialOffer | null {
  const base = getCommercialOfferByCode(code)
  if (!base) return null
  if (modality === "tanto_vantagens" && !base.availableInVantagens) return null
  if (modality === "tanto_livre" && !base.availableInLivre) return null

  const price =
    modality === "tanto_livre" ? base.priceLivre : base.priceVantagens
  const displayPrice =
    modality === "tanto_livre"
      ? base.displayPriceLivre
      : base.displayPriceVantagens

  return {
    code: base.code,
    name: base.name,
    price,
    displayPrice,
    modality,
    base,
  }
}

export function listOffersForModality(
  modality: CommercialOfferModality,
  options?: { channel?: "pre_registration" | "indicator" }
): ResolvedCommercialOffer[] {
  const channel = options?.channel ?? "pre_registration"
  return COMMERCIAL_OFFERS.filter((base) => {
    if (channel === "pre_registration" && !base.availableInPreRegistration) {
      return false
    }
    if (channel === "indicator" && !base.availableInIndicator) {
      return false
    }
    if (modality === "tanto_vantagens") return base.availableInVantagens
    return base.availableInLivre
  }).map((base) => {
    const price =
      modality === "tanto_livre" ? base.priceLivre : base.priceVantagens
    const displayPrice =
      modality === "tanto_livre"
        ? base.displayPriceLivre
        : base.displayPriceVantagens
    return {
      code: base.code,
      name: base.name,
      price,
      displayPrice,
      modality,
      base,
    }
  })
}

/** Rede Neutra: catálogo Livre, sem seletor de modalidade. */
export function listNeutralNetworkOffers(): ResolvedCommercialOffer[] {
  return COMMERCIAL_OFFERS.filter((base) => base.availableInNeutralNetwork).map(
    (base) => ({
      code: base.code,
      name: base.name,
      price: base.priceLivre,
      displayPrice: base.displayPriceLivre,
      modality: "tanto_livre" as const,
      base,
    })
  )
}

export function resolveNeutralNetworkOffer(
  code: string | null | undefined
): ResolvedCommercialOffer | null {
  const base = getCommercialOfferByCode(code)
  if (!base?.availableInNeutralNetwork) return null
  return {
    code: base.code,
    name: base.name,
    price: base.priceLivre,
    displayPrice: base.displayPriceLivre,
    modality: "tanto_livre",
    base,
  }
}

/**
 * Ofertas exibidas na Nova Indicação.
 * Por padrão (sem modalidade) usa preços Vantagens + inclui corporativos (Livre).
 * Com modalidade, filtra e resolve preço corretamente.
 */
export function getIndicatorEligibleOffers(
  modality?: CommercialOfferModality | null
): CommercialOffer[] | ResolvedCommercialOffer[] {
  if (modality) {
    return listOffersForModality(modality, { channel: "indicator" })
  }
  return COMMERCIAL_OFFERS.filter((o) => o.availableInIndicator)
}

export function isIndicatorEligibleOffer(
  code: string | null | undefined,
  modality?: CommercialOfferModality | null
): boolean {
  if (modality) {
    return resolveOfferForModality(code, modality) != null
  }
  const offer = getCommercialOfferByCode(code)
  return Boolean(offer?.availableInIndicator)
}

export function formatCommercialOfferSelectLabel(
  offer: Pick<CommercialOffer, "name" | "displayPrice"> | ResolvedCommercialOffer
): string {
  return `${offer.name} — ${offer.displayPrice}`
}

/** @deprecated Use formatCommercialOfferSelectLabel */
export function formatPublicOfferSelectLabel(
  offer: Pick<CommercialOffer, "name" | "displayPrice"> | ResolvedCommercialOffer
): string {
  return formatCommercialOfferSelectLabel(offer)
}

export function formatPublicOfferPrice(
  price: number | null | undefined
): string | null {
  if (price == null || !Number.isFinite(Number(price))) return null
  return moneyLabel(Number(price))
}
