"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { currentMonthKey, previousMonthKey, recentMonthsRange, type PeriodSelection } from "@/lib/period/range"

export function PeriodFilter({ label = "Período", resetKeys = ["page"] }: { label?: string; resetKeys?: string[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const month = params.get("month")
  const from = params.get("from")
  const to = params.get("to")
  const last3 = recentMonthsRange(3)
  const last6 = recentMonthsRange(6)
  const value = params.get("period") === "all"
    ? "all"
    : from === last3.from && to === last3.to
      ? "last3"
      : from === last6.from && to === last6.to
        ? "last6"
        : from
          ? "range"
          : month || currentMonthKey()

  function apply(selection: PeriodSelection) {
    const next = new URLSearchParams(params.toString())
    next.delete("month")
    next.delete("from")
    next.delete("to")
    next.delete("period")
    for (const key of resetKeys) next.delete(key)
    if (selection.kind === "all") next.set("period", "all")
    else if (selection.kind === "range") {
      next.set("from", selection.from)
      next.set("to", selection.to)
    } else next.set("month", selection.month)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="grid gap-1">
      <Label htmlFor="period-filter">{label}</Label>
      <Select
        value={value === "range" ? "range" : value}
        onValueChange={(next) => {
          if (next === "all") apply({ kind: "all" })
          else if (next === "previous") apply({ kind: "month", month: previousMonthKey() })
          else if (next === "current") apply({ kind: "month", month: currentMonthKey() })
          else if (next === "last3") apply({ kind: "range", ...recentMonthsRange(3) })
          else if (next === "last6") apply({ kind: "range", ...recentMonthsRange(6) })
          else if (next !== "range") apply({ kind: "month", month: next })
        }}
      >
        <SelectTrigger id="period-filter" className="w-full sm:w-[220px]" aria-label={label}>
          <SelectValue placeholder="Mês atual" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="current">Mês atual</SelectItem>
          <SelectItem value="previous">Mês anterior</SelectItem>
          <SelectItem value="last3">Últimos 3 meses</SelectItem>
          <SelectItem value="last6">Últimos 6 meses</SelectItem>
          <SelectItem value={currentMonthKey()}>{currentMonthKey()}</SelectItem>
          <SelectItem value={previousMonthKey()}>{previousMonthKey()}</SelectItem>
          {value === "range" ? <SelectItem value="range">Intervalo personalizado</SelectItem> : null}
          <SelectItem value="all">Todo o período</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Início do intervalo" className="h-9 rounded-md border bg-background px-2 text-sm" type="date" onChange={(event) => {
          const from = event.target.value
          const to = params.get("to") || from
          if (from) apply({ kind: "range", from, to })
        }} />
        <input aria-label="Fim do intervalo" className="h-9 rounded-md border bg-background px-2 text-sm" type="date" onChange={(event) => {
          const to = event.target.value
          const from = params.get("from") || to
          if (to) apply({ kind: "range", from, to })
        }} />
      </div>
    </div>
  )
}
