import { DEFAULT_PAGE_SIZE, parsePage, parsePageSize, parsePeriod, type PageSize } from "@/lib/period/range"

export type ReferralPageQuery = {
  from: string | null
  to: string | null
  label: string
  page: number
  pageSize: PageSize
  status: string | null
  origin: string | null
  search: string | null
  indicatorId: string | null
  commercialId: string | null
  planId: string | null
}

const STATUS = new Set(["pendente", "em_atendimento", "em_negociacao", "em_andamento", "aprovada", "recusada", "paga"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function referralPageQuery(params: URLSearchParams, now = new Date()): ReferralPageQuery {
  const period = parsePeriod(params, now)
  const status = params.get("status")
  const origin = params.get("origin")
  const search = params.get("q")?.trim() ?? ""
  const indicatorId = params.get("indicator")
  const commercialId = params.get("commercial")
  const planId = params.get("plan")
  return {
    from: period.from?.toISOString() ?? null,
    to: period.to?.toISOString() ?? null,
    label: period.label,
    page: parsePage(params.get("page")),
    pageSize: parsePageSize(params.get("pageSize")),
    status: status && STATUS.has(status) ? status : null,
    origin: origin && origin.length <= 40 ? origin : null,
    search: search.length >= 2 && search.length <= 80 ? search : null,
    indicatorId: indicatorId && UUID.test(indicatorId) ? indicatorId : null,
    commercialId: commercialId && UUID.test(commercialId) ? commercialId : null,
    planId: planId && UUID.test(planId) ? planId : null,
  }
}

export function pageWindow(total: number, page: number, pageSize: number = DEFAULT_PAGE_SIZE): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pages)
  if (total === 0) return { from: 0, to: 0, pages }
  return { from: (current - 1) * pageSize + 1, to: Math.min(current * pageSize, total), pages }
}
