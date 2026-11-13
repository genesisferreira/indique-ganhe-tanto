"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { selectClass } from "@/components/compensation-config/ui"
import { EMPLOYEE_STATUS_LABEL, type EmployeeListItem } from "@/lib/compensation-config/contract"
import { newIdempotencyKey, type WorkedDaysView } from "@/lib/payroll-competence/contract"
import { PAYROLL_ENDPOINT, postPayroll } from "@/lib/payroll-competence/client"

function daysInMonth(monthStart: string): string[] {
  const [y, m] = monthStart.split("-").map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${monthStart.slice(0, 8)}${String(i + 1).padStart(2, "0")}`)
}

export function WorkedDaysBoard({
  employees,
  view,
  employeeId,
  month,
}: {
  employees: EmployeeListItem[]
  view: WorkedDaysView | null
  employeeId: string | null
  month: string
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    for (const d of view?.days ?? []) o[d.date] = d.present
    return o
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const calendar = useMemo(() => daysInMonth(month), [month])
  const worked = calendar.filter((d) => selected[d]).length

  function go(emp: string, m: string) {
    const q = new URLSearchParams()
    if (emp) q.set("funcionario", emp)
    if (m) q.set("competencia", m)
    router.push(`/admin/remuneracao/dias-trabalhados?${q.toString()}`)
  }

  async function save() {
    if (!employeeId) return
    setError(null)
    setSubmitting(true)
    const days = calendar
      .filter((d) => selected[d] || (view?.days.some((x) => x.date === d) ?? false))
      .map((d) => ({ date: d, present: selected[d] === true }))
    const r = await postPayroll(PAYROLL_ENDPOINT.days, {
      idempotencyKey: newIdempotencyKey(),
      employeeId,
      competenceMonth: month,
      days,
    })
    setSubmitting(false)
    if (!r.ok) return setError(r.message)
    setNotice(`Dias salvos. Total trabalhado: ${worked}. Nenhuma comissão nem pagamento foi gerado.`)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wd-emp">Funcionário</Label>
          <select id="wd-emp" className={selectClass} value={employeeId ?? ""} onChange={(e) => go(e.target.value, month)}>
            <option value="">Selecione</option>
            {employees.map((e) => (
              <option key={e.employeeId} value={e.employeeId}>
                {e.name} — {EMPLOYEE_STATUS_LABEL[e.status] ?? e.status}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wd-month">Competência</Label>
          <input
            id="wd-month"
            type="month"
            className={selectClass}
            value={month.slice(0, 7)}
            onChange={(e) => go(employeeId ?? "", e.target.value ? `${e.target.value}-01` : month)}
          />
        </div>
      </div>
      {notice ? <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p> : null}
      {!employeeId ? (
        <p className="text-sm text-muted-foreground">Selecione um funcionário para registrar os dias trabalhados.</p>
      ) : !view ? (
        <p className="text-sm text-muted-foreground">Não foi possível carregar os dias.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {view.periodStart} a {view.periodEnd} (America/Sao_Paulo). Datas futuras, fora do mês, antes do vínculo ou após o desligamento ficam bloqueadas.
            {view.locked ? " Competência em revisão/fechada: somente consulta." : ""}
          </p>
          <div className="grid grid-cols-7 gap-1 text-center text-xs sm:text-sm">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((h, i) => (
              <div key={i} className="py-1 text-muted-foreground">{h}</div>
            ))}
            {Array.from({ length: new Date(`${month}T12:00:00Z`).getUTCDay() }).map((_, i) => <div key={`e${i}`} />)}
            {calendar.map((d) => {
              const day = Number(d.slice(8))
              const hired = view.employee.hiredOn
              const dismissed = view.employee.dismissedOn
              const blocked =
                view.locked ||
                d > view.today ||
                (hired != null && d < hired) ||
                (dismissed != null && d > dismissed)
              const on = selected[d] === true
              return (
                <button
                  key={d}
                  type="button"
                  disabled={blocked || submitting}
                  aria-pressed={on}
                  onClick={() => setSelected((s) => ({ ...s, [d]: !s[d] }))}
                  className={`min-h-10 rounded-md border px-1 py-2 tabular-nums focus-visible:outline-2 focus-visible:outline-primary ${
                    on ? "border-primary bg-primary/15 font-medium" : "border-border/60 bg-card/40"
                  } ${blocked ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {day}
                </button>
              )
            })}
          </div>
          <p className="text-sm">Total de dias trabalhados: <span className="font-semibold tabular-nums">{worked}</span></p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="button" onClick={save} disabled={submitting || view.locked} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Salvar dias
          </Button>
        </>
      )}
    </div>
  )
}
