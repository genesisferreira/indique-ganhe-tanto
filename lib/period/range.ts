/** Período de calendário em America/Sao_Paulo. O saldo contábil atual não usa este intervalo. */
export const PERIOD_TIMEZONE = "America/Sao_Paulo"
export const DEFAULT_PAGE_SIZE = 20
export const PAGE_SIZES = [20, 50, 100] as const

export type PageSize = (typeof PAGE_SIZES)[number]
export type PeriodSelection =
  | { kind: "month"; month: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "all" }

const MONTH = /^(\d{4})-(\d{2})$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export function saoPauloParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PERIOD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: read("year"), month: read("month"), day: read("day") }
}

/** 00:00 em São Paulo, expresso em UTC. O fuso civil é UTC−3 o ano inteiro. */
export function saoPauloMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0))
}

export function currentMonthKey(now = new Date()): string {
  const { year, month } = saoPauloParts(now)
  return `${year}-${String(month).padStart(2, "0")}`
}

export function previousMonthKey(now = new Date()): string {
  const { year, month } = saoPauloParts(now)
  const date = new Date(Date.UTC(year, month - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

export function monthBounds(month: string): { from: Date; to: Date } | null {
  const match = MONTH.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const mon = Number(match[2])
  if (mon < 1 || mon > 12 || year < 2000 || year > 2100) return null
  const from = saoPauloMidnightUtc(year, mon, 1)
  const to = saoPauloMidnightUtc(mon === 12 ? year + 1 : year, mon === 12 ? 1 : mon + 1, 1)
  return { from, to }
}

export function dayBounds(fromDay: string, toDay: string): { from: Date; to: Date } | null {
  const start = DAY.exec(fromDay)
  const end = DAY.exec(toDay)
  if (!start || !end) return null
  const from = saoPauloMidnightUtc(Number(start[1]), Number(start[2]), Number(start[3]))
  const inclusive = saoPauloMidnightUtc(Number(end[1]), Number(end[2]), Number(end[3]))
  const to = new Date(inclusive.getTime() + 24 * 60 * 60 * 1000)
  if (!(from.getTime() < to.getTime())) return null
  return { from, to }
}

export function parsePeriod(params: URLSearchParams, now = new Date()): { selection: PeriodSelection; from: Date | null; to: Date | null; label: string } {
  if (params.get("period") === "all") {
    return { selection: { kind: "all" }, from: null, to: null, label: "Todo o período" }
  }
  const fromDay = params.get("from")
  const toDay = params.get("to")
  if (fromDay && toDay) {
    const bounds = dayBounds(fromDay, toDay)
    if (bounds) return { selection: { kind: "range", from: fromDay, to: toDay }, ...bounds, label: `${fromDay} a ${toDay}` }
  }
  const requested = params.get("month")
  const month = requested && monthBounds(requested) ? requested : currentMonthKey(now)
  const bounds = monthBounds(month)!
  return { selection: { kind: "month", month }, ...bounds, label: month }
}

export function parsePageSize(value: string | null): PageSize {
  const size = Number(value)
  return PAGE_SIZES.includes(size as PageSize) ? size as PageSize : DEFAULT_PAGE_SIZE
}

export function parsePage(value: string | null): number {
  const page = Number(value)
  if (!Number.isInteger(page) || page < 1 || page > 100000) return 1
  return page
}

export function periodSearch(selection: PeriodSelection): URLSearchParams {
  const params = new URLSearchParams()
  if (selection.kind === "all") params.set("period", "all")
  else if (selection.kind === "range") {
    params.set("from", selection.from)
    params.set("to", selection.to)
  } else params.set("month", selection.month)
  return params
}
