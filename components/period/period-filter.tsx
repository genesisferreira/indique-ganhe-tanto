"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { currentMonthKey, previousMonthKey, type PeriodSelection } from "@/lib/period/range"

export function PeriodFilter({ label = "Período" }: { label?: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const month = params.get("month")
  const value = params.get("period") === "all" ? "all" : params.get("from") ? "range" : month || currentMonthKey()

  function apply(selection: PeriodSelection) {
    const next = new URLSearchParams(params.toString())
    next.delete("month")
    next.delete("from")
    next.delete("to")
    next.delete("period")
    next.delete("page")
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
          else apply({ kind: "month", month: next })
        }}
      >
        <SelectTrigger id="period-filter" className="w-full sm:w-[220px]" aria-label={label}>
          <SelectValue placeholder="Mês atual" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="current">Mês atual</SelectItem>
          <SelectItem value="previous">Mês anterior</SelectItem>
          <SelectItem value={currentMonthKey()}>{currentMonthKey()}</SelectItem>
          <SelectItem value={previousMonthKey()}>{previousMonthKey()}</SelectItem>
          <SelectItem value="all">Todo o período</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
