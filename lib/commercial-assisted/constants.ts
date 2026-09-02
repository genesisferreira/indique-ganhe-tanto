/**
 * Cadastro assistido pelo Comercial — constantes compartilhadas.
 *
 * Semântica (referrals):
 * - indicator_profile_id  = indicador real / beneficiário da recompensa
 * - created_by_profile_id = ator original que criou o registro (imutável)
 * - commercial_profile_id = responsável comercial atual (pode mudar no SLA)
 * - source                = commercial_assisted_referral
 * - reward_eligible       = true
 */

export const COMMERCIAL_ASSISTED_REFERRAL_SOURCE =
  "commercial_assisted_referral" as const

export const COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE =
  "Cadastro Assistido Comercial" as const

/** Roles autorizados a buscar indicadores para cadastro assistido. */
export const COMMERCIAL_INDICATOR_SEARCH_ALLOWED_ROLES = [
  "comercial",
  "admin_master",
] as const

export type CommercialIndicatorSearchAllowedRole =
  (typeof COMMERCIAL_INDICATOR_SEARCH_ALLOWED_ROLES)[number]

export const COMMERCIAL_INDICATOR_SEARCH_MIN_QUERY_LENGTH = 3
export const COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS = 10

export const COMMERCIAL_INDICATOR_SEARCH_AUDIT_ENTITY =
  "commercial_indicator_search" as const

export const COMMERCIAL_INDICATOR_SEARCH_AUDIT_EVENT =
  "commercial_indicator_search" as const
