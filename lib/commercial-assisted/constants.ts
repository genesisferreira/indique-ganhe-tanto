/**
 * Cadastro assistido pelo Comercial — constantes compartilhadas.
 *
 * Semântica (referrals):
 * - indicator_profile_id  = indicador real / beneficiário da recompensa
 * - created_by_profile_id = ator original que criou o registro (imutável)
 * - commercial_profile_id = responsável comercial atual (pode mudar no SLA)
 * - source                = commercial_assisted_referral
 * - erp_lead_source       = Indique e Ganhe
 * - reward_eligible       = true
 */

export {
  COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
  COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
} from "@/lib/referral-reward-eligibility"

/** Roles autorizados a buscar indicadores / criar assistido. */
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

export const COMMERCIAL_ASSISTED_CREATE_AUDIT_ENTITY =
  "commercial_assisted_referral" as const

export const COMMERCIAL_ASSISTED_CREATE_AUDIT_EVENT =
  "commercial_assisted_referral_created" as const

export const COMMERCIAL_ASSISTED_CADASTRO_URL =
  "https://crm.tantotelecom.com.br/cadastro" as const

export const COMMERCIAL_ASSISTED_INDICATOR_AUDIT_ENTITY =
  "commercial_assisted_indicator" as const

export const COMMERCIAL_ASSISTED_INDICATOR_AUDIT_EVENT =
  "commercial_assisted_indicator_created" as const

export const FIRST_ACCESS_PATH = "/primeiro-acesso" as const
