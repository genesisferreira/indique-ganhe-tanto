import {
  maskCpfForDisplay,
  maskEmailForDisplay,
  maskPhoneForDisplay,
} from "./mask"
import type { IndicatorSearchQueryType } from "./search-query"

/** Linha mínima lida do banco para montar a resposta (nunca retornar raw ao client). */
export type IndicatorSearchDbRow = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  cpf: string | null
  is_active: boolean
  role: string
}

export type IndicatorSearchResultItem = {
  id: string
  full_name: string
  phone_masked: string | null
  email_masked: string | null
  document_masked: string | null
  is_active: boolean
}

export type IndicatorSearchAuditMetadata = {
  event: "commercial_indicator_search"
  query_type: IndicatorSearchQueryType
  results_count: number
}

/**
 * Mapeia row do banco → payload público mínimo.
 * Nunca inclui Pix, wallet, rewards, CPF completo, etc.
 */
export function mapIndicatorSearchResult(
  row: IndicatorSearchDbRow
): IndicatorSearchResultItem | null {
  if (row.role !== "indicador") return null
  if (!row.is_active) return null

  return {
    id: row.id,
    full_name: row.full_name,
    phone_masked: maskPhoneForDisplay(row.phone),
    email_masked: maskEmailForDisplay(row.email),
    document_masked: maskCpfForDisplay(row.cpf),
    is_active: true,
  }
}

export function buildIndicatorSearchAuditMetadata(input: {
  queryType: IndicatorSearchQueryType
  resultsCount: number
}): IndicatorSearchAuditMetadata {
  return {
    event: "commercial_indicator_search",
    query_type: input.queryType,
    results_count: input.resultsCount,
  }
}

/**
 * Fase 2: revalidar indicator_profile_id no backend na criação assistida.
 * Não confiar no objeto retornado pela busca UX.
 */
export function isValidIndicatorForAssistedReferral(input: {
  id: string
  role: string | null | undefined
  is_active: boolean | null | undefined
}): { ok: true } | { ok: false; reason: "not_found" | "not_indicator" | "inactive" } {
  if (!input.id?.trim()) {
    return { ok: false, reason: "not_found" }
  }
  if (input.role !== "indicador") {
    return { ok: false, reason: "not_indicator" }
  }
  if (input.is_active === false) {
    return { ok: false, reason: "inactive" }
  }
  return { ok: true }
}
