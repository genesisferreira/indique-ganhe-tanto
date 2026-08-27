/**
 * Resolução técnica oferta → plan_id CRM (FK / Controllr plan_pk).
 * NÃO define o valor da recompensa — esse vem da primeira fatura paga.
 */

import {
  getCommercialOfferByCode,
  getAllCommercialOffers,
  formatCommercialOfferSelectLabel,
  listOffersForModality,
  resolveOfferForModality,
  type CommercialOffer,
  type CommercialOfferModality,
} from "@/lib/commercial-offers/catalog"
import {
  resolvePublicPlanSlots,
  type PlanCatalogRow,
  type PublicPlanSlotKey,
} from "@/lib/public-pre-registration/plan-resolver"

export type ResolveIndicatorCrmPlanInput = {
  offerCode: string
  planRows: PlanCatalogRow[]
  plan500Id?: string | null
  plan1000Id?: string | null
  /**
   * Plano CRM base documentado (env PUBLIC_PRE_REGISTRATION_BASE_CRM_PLAN_ID
   * ou equivalente). Usado quando a oferta não tem controllrPlanSlot.
   */
  baseCrmPlanId?: string | null
}

export type ResolveIndicatorCrmPlanResult =
  | {
      ok: true
      offer: CommercialOffer
      planId: string
      planSource: "offer_slot" | "base_crm_plan"
      slotKey: PublicPlanSlotKey | null
    }
  | {
      ok: false
      reason: "unknown_offer" | "crm_plan_unresolved"
    }

/**
 * Resolve apenas o plan_id técnico para Controllr/FK.
 * Documentação do fallback: ofertas sem controllrPlanSlot usam
 * `baseCrmPlanId` (mesmo padrão do pré-cadastro público).
 */
export function resolveIndicatorCrmPlanId(
  input: ResolveIndicatorCrmPlanInput
): ResolveIndicatorCrmPlanResult {
  const offer = getCommercialOfferByCode(input.offerCode)
  if (!offer) return { ok: false, reason: "unknown_offer" }

  const slotKey = offer.controllrPlanSlot
  if (slotKey) {
    const slotsResult = resolvePublicPlanSlots({
      rows: input.planRows,
      plan500Id: input.plan500Id,
      plan1000Id: input.plan1000Id,
    })
    if (slotsResult.ok) {
      const slot = slotsResult.slots.find((item) => item.slotKey === slotKey)
      if (slot) {
        return {
          ok: true,
          offer,
          planId: slot.row.id,
          planSource: "offer_slot",
          slotKey,
        }
      }
    }
  }

  const baseId = input.baseCrmPlanId?.trim()
  if (baseId) {
    const exists = input.planRows.some((row) => row.id === baseId)
    if (exists || input.planRows.length === 0) {
      // Se planRows veio vazio (edge), ainda aceita UUID configurado via env.
      return {
        ok: true,
        offer,
        planId: baseId,
        planSource: "base_crm_plan",
        slotKey: null,
      }
    }
    // Env aponta para id inexistente no catálogo carregado
    return { ok: false, reason: "crm_plan_unresolved" }
  }

  // Último recurso documentado: tentar slot 500 via resolução pública
  const slotsResult = resolvePublicPlanSlots({
    rows: input.planRows,
    plan500Id: input.plan500Id,
    plan1000Id: input.plan1000Id,
  })
  if (slotsResult.ok) {
    const fallback500 = slotsResult.slots.find((s) => s.slotKey === "500")
    if (fallback500) {
      return {
        ok: true,
        offer,
        planId: fallback500.row.id,
        planSource: "base_crm_plan",
        slotKey: "500",
      }
    }
  }

  return { ok: false, reason: "crm_plan_unresolved" }
}

/** @deprecated Prefer resolveIndicatorCrmPlanId — não usa plans.reward_amount. */
export function resolveIndicatorOfferFinancials(input: {
  offerCode: string
  planRows: PlanCatalogRow[]
  planRewardById?: Record<string, number>
  plan500Id?: string | null
  plan1000Id?: string | null
  baseCrmPlanId?: string | null
}):
  | {
      ok: true
      offer: CommercialOffer
      slotKey: PublicPlanSlotKey | null
      planId: string
      /** Sempre null — recompensa só na 1ª fatura. */
      rewardAmount: null
      planName: string
    }
  | {
      ok: false
      reason: "unknown_offer" | "crm_plan_unresolved" | "not_indicator_eligible"
    } {
  const resolved = resolveIndicatorCrmPlanId(input)
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason }
  }
  const planName =
    input.planRows.find((r) => r.id === resolved.planId)?.name ?? "Plano CRM"
  return {
    ok: true,
    offer: resolved.offer,
    slotKey: resolved.slotKey,
    planId: resolved.planId,
    rewardAmount: null,
    planName,
  }
}

export function buildIndicatorCommercialOfferOptions(
  modality: CommercialOfferModality | null | undefined = "tanto_vantagens"
): Array<{
  code: string
  name: string
  price: number
  displayPrice: string
  label: string
}> {
  const modalitySafe: CommercialOfferModality =
    modality === "tanto_livre" ? "tanto_livre" : "tanto_vantagens"
  return listOffersForModality(modalitySafe, { channel: "indicator" }).map(
    (offer) => ({
      code: offer.code,
      name: offer.name,
      price: offer.price,
      displayPrice: offer.displayPrice,
      label: formatCommercialOfferSelectLabel(offer),
    })
  )
}

/** @deprecated Use buildIndicatorCommercialOfferOptions */
export function buildIndicatorEligibleOfferOptions(input: {
  offers: readonly CommercialOffer[]
  slots?: unknown
  planRewardById?: Record<string, number>
}): Array<{
  code: string
  name: string
  price: number
  displayPrice: string
  label: string
}> {
  return buildIndicatorCommercialOfferOptions("tanto_vantagens")
}

