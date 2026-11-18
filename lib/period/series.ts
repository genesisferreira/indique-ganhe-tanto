import { currentMonthKey, saoPauloParts, type PeriodSelection } from "@/lib/period/range"

export type SeriesGrain = "month" | "day"

export function seriesGranularity(selection: PeriodSelection, from: Date | null, to: Date | null): SeriesGrain {
  if (selection.kind === "all" || !from || !to) return "month"
  const days = (to.getTime() - from.getTime()) / 86_400_000
  return days <= 62 ? "day" : "month"
}

export function monthKeysBetween(start: string, end: string): string[] {
  const keys: string[] = []
  let year = Number(start.slice(0, 4))
  let month = Number(start.slice(5, 7))
  const endYear = Number(end.slice(0, 4))
  const endMonth = Number(end.slice(5, 7))
  if (!year || !month || !endYear || !endMonth) return []
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`)
    month += 1
    if (month === 13) {
      month = 1
      year += 1
    }
    if (keys.length > 240) break
  }
  return keys
}

export function dayKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = []
  for (let time = from.getTime(); time < to.getTime() && keys.length < 62; time += 86_400_000) {
    const parts = saoPauloParts(new Date(time + 12 * 60 * 60 * 1000))
    keys.push(`${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`)
  }
  return keys
}

export function bucketKeys(
  grain: SeriesGrain,
  selection: PeriodSelection,
  from: Date | null,
  to: Date | null,
  observed: string[],
  now = new Date()
): string[] {
  const sorted = [...new Set(observed.filter((bucket) => /^\d{4}-\d{2}(-\d{2})?$/.test(bucket)))].sort()
  if (grain === "day" && from && to) return dayKeysBetween(from, to)
  if (selection.kind === "month") return [selection.month]
  if (selection.kind === "range" && from && to) {
    const start = `${saoPauloParts(from).year}-${String(saoPauloParts(from).month).padStart(2, "0")}`
    const endParts = saoPauloParts(new Date(to.getTime() - 1000))
    const end = `${endParts.year}-${String(endParts.month).padStart(2, "0")}`
    return monthKeysBetween(start, end)
  }
  if (sorted.length === 0) return []
  const end = sorted[sorted.length - 1]! > currentMonthKey(now) ? sorted[sorted.length - 1]! : currentMonthKey(now)
  return monthKeysBetween(sorted[0]!, end)
}

export function fillBuckets<T extends Record<string, number>>(
  raw: Array<{ bucket: string } & T>,
  keys: string[],
  zero: T
): Array<{ bucket: string } & T> {
  const byBucket = new Map(raw.map((row) => [row.bucket, row]))
  return keys.map((bucket) => {
    const row = byBucket.get(bucket)
    return { ...zero, ...row, bucket }
  })
}

export function finiteNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}
