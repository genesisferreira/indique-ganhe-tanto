import {
  COMMERCIAL_INDICATOR_SEARCH_AUDIT_ENTITY,
  COMMERCIAL_INDICATOR_SEARCH_AUDIT_EVENT,
  COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS,
} from "./constants"
import {
  authorizeCommercialIndicatorSearch,
  type IndicatorSearchActorProfile,
} from "./search-auth"
import {
  escapeIlikePattern,
  normalizeIndicatorSearchQuery,
  type IndicatorSearchQueryType,
} from "./search-query"
import {
  buildIndicatorSearchAuditMetadata,
  mapIndicatorSearchResult,
  type IndicatorSearchDbRow,
  type IndicatorSearchResultItem,
} from "./search-result"

export type NormalizedSearchFilters = {
  namePattern: string | null
  emailPattern: string | null
  phoneDigitsPattern: string | null
  cpfDigits: string | null
  queryType: IndicatorSearchQueryType
  limit: number
}

export type IndicatorSearchDeps = {
  getUser: () => Promise<{ id: string } | null>
  getActorProfile: (
    userId: string
  ) => Promise<IndicatorSearchActorProfile | null>
  searchIndicatorRows: (
    input: NormalizedSearchFilters
  ) => Promise<IndicatorSearchDbRow[]>
  insertSearchAudit: (input: {
    actorProfileId: string
    metadata: ReturnType<typeof buildIndicatorSearchAuditMetadata>
  }) => Promise<void>
}

export type IndicatorSearchServiceResult =
  | {
      ok: true
      results: IndicatorSearchResultItem[]
      query_type: IndicatorSearchQueryType
    }
  | {
      ok: false
      status: number
      message: string
    }

export function buildSearchFilters(
  normalized: Extract<
    ReturnType<typeof normalizeIndicatorSearchQuery>,
    { ok: true }
  >
): NormalizedSearchFilters {
  const escapedTrimmed = escapeIlikePattern(normalized.trimmed)
  const escapedEmail = normalized.emailCandidate
    ? escapeIlikePattern(normalized.emailCandidate)
    : null

  switch (normalized.queryType) {
    case "email":
      return {
        namePattern: null,
        emailPattern: `%${escapedEmail ?? escapedTrimmed.toLowerCase()}%`,
        phoneDigitsPattern: null,
        cpfDigits: null,
        queryType: "email",
        limit: COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS,
      }
    case "phone":
      return {
        namePattern: null,
        emailPattern: null,
        phoneDigitsPattern: `%${normalized.digits}%`,
        cpfDigits: null,
        queryType: "phone",
        limit: COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS,
      }
    case "cpf":
      return {
        namePattern: null,
        emailPattern: null,
        phoneDigitsPattern: `%${normalized.digits}%`,
        cpfDigits: normalized.digits,
        queryType: "cpf",
        limit: COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS,
      }
    case "mixed":
      return {
        namePattern: `%${escapedTrimmed}%`,
        emailPattern: escapedEmail ? `%${escapedEmail}%` : null,
        phoneDigitsPattern:
          normalized.digits.length >= 3 ? `%${normalized.digits}%` : null,
        cpfDigits:
          normalized.digits.length === 11 ? normalized.digits : null,
        queryType: "mixed",
        limit: COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS,
      }
    case "name":
    default:
      return {
        namePattern: `%${escapedTrimmed}%`,
        emailPattern: null,
        phoneDigitsPattern: null,
        cpfDigits: null,
        queryType: "name",
        limit: COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS,
      }
  }
}

/** Monta filtro OR do PostgREST (valores já escapados para ILIKE). */
export function buildIndicatorSearchOrFilter(
  filters: NormalizedSearchFilters
): string | null {
  const parts: string[] = []
  if (filters.namePattern) {
    parts.push(`full_name.ilike.${filters.namePattern}`)
  }
  if (filters.emailPattern) {
    parts.push(`email.ilike.${filters.emailPattern}`)
  }
  if (filters.phoneDigitsPattern) {
    parts.push(`phone.ilike.${filters.phoneDigitsPattern}`)
  }
  if (filters.cpfDigits) {
    parts.push(`cpf.eq.${filters.cpfDigits}`)
  }
  return parts.length > 0 ? parts.join(",") : null
}

export async function runCommercialIndicatorSearch(
  deps: IndicatorSearchDeps,
  rawQuery: string | null | undefined
): Promise<IndicatorSearchServiceResult> {
  const user = await deps.getUser()
  if (!user) {
    return {
      ok: false,
      status: 401,
      message: "Sessão não encontrada. Faça login novamente.",
    }
  }

  const profile = await deps.getActorProfile(user.id)
  const auth = authorizeCommercialIndicatorSearch({
    userId: user.id,
    profile,
  })
  if (!auth.ok) {
    return { ok: false, status: auth.status, message: auth.message }
  }

  const normalized = normalizeIndicatorSearchQuery(rawQuery)
  if (!normalized.ok) {
    return {
      ok: false,
      status: 400,
      message:
        normalized.reason === "empty"
          ? "Informe um termo de busca."
          : "Informe ao menos 3 caracteres para buscar.",
    }
  }

  const filters = buildSearchFilters(normalized)
  if (!buildIndicatorSearchOrFilter(filters)) {
    return {
      ok: false,
      status: 400,
      message: "Informe um termo de busca válido.",
    }
  }

  const rows = await deps.searchIndicatorRows(filters)
  const results = rows
    .map(mapIndicatorSearchResult)
    .filter((row): row is IndicatorSearchResultItem => row != null)
    .slice(0, COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS)

  const metadata = buildIndicatorSearchAuditMetadata({
    queryType: normalized.queryType,
    resultsCount: results.length,
  })

  try {
    await deps.insertSearchAudit({
      actorProfileId: auth.profileId,
      metadata: {
        ...metadata,
        event: COMMERCIAL_INDICATOR_SEARCH_AUDIT_EVENT,
      },
    })
  } catch {
    // Busca não deve falhar se o audit falhar.
  }

  return {
    ok: true,
    results,
    query_type: normalized.queryType,
  }
}

export { COMMERCIAL_INDICATOR_SEARCH_AUDIT_ENTITY }
