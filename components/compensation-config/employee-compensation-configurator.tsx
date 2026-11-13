"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, GitCompare, History, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  BENEFIT_METHODS,
  BENEFIT_METHOD_LABEL,
  EMPLOYEE_STATUS_LABEL,
  ROLE_LABEL,
  UI_SUGGESTION,
  diffVersions,
  newIdempotencyKey,
  parseMoneyInput,
  type EmployeeDetail,
  type EmployeeListItem,
  type ProfileVersion,
} from "@/lib/compensation-config/contract"
import { WRITE_ENDPOINT, postDraft } from "@/lib/compensation-config/client"
import { PAYROLL_ENDPOINT, postPayroll } from "@/lib/payroll-competence/client"
import { newIdempotencyKey as newPayrollKey } from "@/lib/payroll-competence/contract"
import { formatDate, formatMoney } from "@/lib/employee-portal/format"
import { ActivateDisabled, VersionPill, checkboxClass, selectClass } from "@/components/compensation-config/ui"

type Component = "salary" | "meal" | "transport" | "fuel"
type FormValues = {
  salary: string
  meal: string
  transport: string
  transportMethod: string
  fuel: string
  fuelMethod: string
  showSalary: boolean
  showMeal: boolean
  showTransport: boolean
  showFuel: boolean
  validFrom: string
  validUntil: string
  notes: string
  reason: string
}
/** Formulário vazio: nenhum componente configurado, nada visível, sem valores sugeridos. */
export const EMPTY_PROFILE_FORM: FormValues = {
  salary: "", meal: "", transport: "", transportMethod: "", fuel: "", fuelMethod: "",
  showSalary: false, showMeal: false, showTransport: false, showFuel: false,
  validFrom: "", validUntil: "", notes: "", reason: "",
}
const COMPONENT_LABEL: Record<Component, string> = {
  salary: "Salário fixo",
  meal: "Vale-refeição (por dia trabalhado)",
  transport: "Passagem / transporte",
  fuel: "Gasolina / combustível",
}
const SHOW_KEY = { salary: "showSalary", meal: "showMeal", transport: "showTransport", fuel: "showFuel" } as const
const im = (v: string | null) => (v ? v.replace(".", ",") : "")

function fromVersion(v: ProfileVersion, today: string): FormValues {
  return {
    salary: im(v.salaryAmount), meal: im(v.mealDailyAmount), transport: im(v.transportAmount), transportMethod: v.transportMethod ?? "",
    fuel: im(v.fuelAmount), fuelMethod: v.fuelMethod ?? "",
    showSalary: v.showSalary, showMeal: v.showMeal, showTransport: v.showTransport, showFuel: v.showFuel,
    validFrom: v.validFrom < today ? today : v.validFrom, validUntil: v.validUntil ?? "", notes: v.notes ?? "", reason: "",
  }
}

export function componentSummary(v: ProfileVersion, c: Component): string | null {
  if (c === "salary") return v.salaryAmount ? formatMoney(v.salaryAmount) : null
  if (c === "meal") return v.mealDailyAmount ? `${formatMoney(v.mealDailyAmount)} por dia trabalhado` : null
  if (c === "transport") return v.transportAmount ? `${formatMoney(v.transportAmount)} ${v.transportMethod ? BENEFIT_METHOD_LABEL[v.transportMethod] : ""}`.trim() : null
  return v.fuelAmount ? `${formatMoney(v.fuelAmount)} ${v.fuelMethod ? BENEFIT_METHOD_LABEL[v.fuelMethod] : ""}`.trim() : null
}
const visibleOf = (v: ProfileVersion, c: Component) => v[SHOW_KEY[c]]
const COMPONENTS: Component[] = ["salary", "meal", "transport", "fuel"]
const COMPARE_KEYS = ["salaryAmount", "mealDailyAmount", "transportAmount", "transportMethod", "fuelAmount", "fuelMethod", "showSalary", "showMeal", "showTransport", "showFuel", "validFrom", "validUntil", "notes"] as const

export function EmployeeCompensationConfigurator({ employees, detail, today }: { employees: EmployeeListItem[]; detail: EmployeeDetail | null; today: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState<FormValues>(EMPTY_PROFILE_FORM)
  const [idemKey, setIdemKey] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [compare, setCompare] = useState<[string, string] | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState("")
  const [archiveKey, setArchiveKey] = useState("")
  const [approveOpen, setApproveOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState("")

  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    setValues((s) => {
      const next: FormValues = { ...s, [k]: v }
      // componente sem valor nunca fica visível
      for (const c of COMPONENTS) if (!String(next[c]).trim()) next[SHOW_KEY[c]] = false
      return next
    })
    setIdemKey("")
  }
  const current = detail?.current ?? null
  const draft = detail?.versions.find((v) => v.status === "draft") ?? null
  const approved = detail?.versions.find((v) => v.status === "approved") ?? null
  const dismissed = detail?.employee.status === "dismissed"

  function startEdit() {
    setValues(current ? fromVersion(current, today) : EMPTY_PROFILE_FORM)
    setEditing(true)
    setIdemKey("")
    setError(null)
    setNotice(null)
  }

  async function submit() {
    if (!detail) return
    setError(null)
    const payload: Record<string, unknown> = {
      employeeId: detail.employee.employeeId,
      validFrom: values.validFrom,
      reason: values.reason.trim(),
      showSalary: values.showSalary, showMeal: values.showMeal, showTransport: values.showTransport, showFuel: values.showFuel,
    }
    if (current) payload.previousProfileId = current.profileId
    const money: [Component, string][] = [["salary", "salaryAmount"], ["meal", "mealDailyAmount"], ["transport", "transportAmount"], ["fuel", "fuelAmount"]]
    for (const [c, key] of money) {
      if (!values[c].trim()) continue
      const m = parseMoneyInput(values[c])
      if (!m) return setError(`${COMPONENT_LABEL[c]}: informe um valor positivo (até 2 casas decimais).`)
      payload[key] = m
    }
    if (payload.transportAmount) {
      if (!values.transportMethod) return setError("Passagem: selecione a forma (mensal fixo ou por dia trabalhado).")
      payload.transportMethod = values.transportMethod
    }
    if (payload.fuelAmount) {
      if (!values.fuelMethod) return setError("Combustível: selecione a forma (mensal fixo ou por dia trabalhado).")
      payload.fuelMethod = values.fuelMethod
    }
    if (values.validUntil) payload.validUntil = values.validUntil
    if (values.notes.trim()) payload.notes = values.notes.trim()
    const key = idemKey || newIdempotencyKey()
    setIdemKey(key)
    setSubmitting(true)
    const r = await postDraft(WRITE_ENDPOINT.profile_save, { idempotencyKey: key, ...payload })
    setSubmitting(false)
    if (!r.ok) return setError(r.message)
    setNotice(`Rascunho salvo (versão ${String(r.body.version ?? "")}). Nada foi ativado nem calculado.`)
    setEditing(false)
    setValues(EMPTY_PROFILE_FORM)
    setIdemKey("")
    router.refresh()
  }

  async function archive() {
    if (!current) return
    setError(null)
    const key = archiveKey || newIdempotencyKey()
    setArchiveKey(key)
    setSubmitting(true)
    const r = await postDraft(WRITE_ENDPOINT.profile_archive, { idempotencyKey: key, profileId: current.profileId, reason: archiveReason.trim() })
    setSubmitting(false)
    if (!r.ok) return setError(r.message)
    setArchiveOpen(false)
    setNotice("Configuração desativada. O histórico foi mantido.")
    router.refresh()
  }

  async function approve() {
    if (!draft) return
    setError(null)
    setSubmitting(true)
    const payload: Record<string, unknown> = { idempotencyKey: newPayrollKey(), profileId: draft.profileId }
    if (overrideReason.trim()) payload.overrideReason = overrideReason.trim()
    const r = await postPayroll(PAYROLL_ENDPOINT.approve, payload)
    setSubmitting(false)
    if (!r.ok) return setError(r.message)
    setApproveOpen(false)
    setOverrideReason("")
    setNotice("Versão aprovada. Nenhuma regra de comissão foi ativada.")
    router.refresh()
  }

  const a = compare && detail ? detail.versions.find((v) => v.profileId === compare[0]) : undefined
  const b = compare && detail ? detail.versions.find((v) => v.profileId === compare[1]) : undefined

  return (
    <div className="space-y-6">
      <div className="max-w-xl space-y-2">
        <Label htmlFor="cc-employee">Funcionário</Label>
        <select
          id="cc-employee"
          className={selectClass}
          value={detail?.employee.employeeId ?? ""}
          onChange={(e) => router.push(e.target.value ? `/admin/remuneracao/funcionarios?funcionario=${e.target.value}` : "/admin/remuneracao/funcionarios")}
        >
          <option value="">Selecione um funcionário</option>
          {employees.map((e) => (
            <option key={e.employeeId} value={e.employeeId}>
              {e.name} — {EMPLOYEE_STATUS_LABEL[e.status] ?? e.status}{e.currentProfile ? ` · rascunho v${e.currentProfile.version}` : ""}
            </option>
          ))}
        </select>
        {employees.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum funcionário cadastrado.</p> : null}
      </div>

      {notice ? (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden /> {notice}
        </p>
      ) : null}

      {!detail ? (
        <div role="status" className="rounded-xl border border-dashed border-border/60 bg-card/30 p-6 text-center">
          <p className="font-medium">Selecione um funcionário</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">A remuneração individual é opcional e salva sempre como nova versão em rascunho.</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="cc-emp-title" className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 id="cc-emp-title" className="break-words text-lg font-semibold">{detail.employee.name}</h2>
              {current ? <VersionPill status={current.status} version={current.version} /> : <span className="text-xs text-muted-foreground">Sem configuração vigente</span>}
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Setor</dt><dd>{detail.employee.sectors.map((s) => s.name).join(", ") || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Função</dt><dd>{detail.employee.roles.map((r) => ROLE_LABEL[r]).join(", ") || "Sem função comissionada"}</dd></div>
              <div><dt className="text-muted-foreground">Status</dt><dd>{EMPLOYEE_STATUS_LABEL[detail.employee.status] ?? detail.employee.status}</dd></div>
            </dl>
            {current ? (
              <>
                <ul className="grid gap-2 text-sm sm:grid-cols-2">
                  {COMPONENTS.map((c) => {
                    const s = componentSummary(current, c)
                    return (
                      <li key={c} className="rounded-lg border border-border/40 px-3 py-2">
                        <span className="block text-muted-foreground">{COMPONENT_LABEL[c]}</span>
                        <span className="font-medium tabular-nums">{s ?? "Não configurado"}</span>
                        {s ? <span className="block text-xs text-muted-foreground">{visibleOf(current, c) ? "Visível ao funcionário" : "Oculto do funcionário"}</span> : null}
                      </li>
                    )
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">Vigência: {formatDate(`${current.validFrom}T12:00:00Z`)} — {current.validUntil ? formatDate(`${current.validUntil}T12:00:00Z`) : "sem data final"}</p>
              </>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {!editing && !dismissed ? (
                <Button type="button" size="sm" onClick={startEdit}>{current ? "Editar (nova versão)" : "Configurar remuneração"}</Button>
              ) : null}
              {detail.versions.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" className="gap-1" aria-expanded={showHistory} onClick={() => setShowHistory((s) => !s)}>
                  <History className="h-4 w-4" aria-hidden /> Histórico ({detail.versions.length})
                </Button>
              ) : null}
              {detail.versions.length > 1 ? (
                <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setCompare(compare ? null : [detail.versions[1].profileId, detail.versions[0].profileId])}>
                  <GitCompare className="h-4 w-4" aria-hidden /> Comparar versões
                </Button>
              ) : null}
              {draft ? <Button type="button" size="sm" onClick={() => setApproveOpen((s) => !s)}>Aprovar versão</Button> : null}
              {current ? <Button type="button" size="sm" variant="ghost" onClick={() => setArchiveOpen((s) => !s)}>Desativar configuração</Button> : null}
              <ActivateDisabled id="profile" />
            </div>
            {dismissed ? <p className="text-xs text-muted-foreground">Funcionário desligado: somente consulta do histórico.</p> : null}
            {approveOpen && draft ? (
              <div className="space-y-2 rounded-lg border border-border/60 p-3">
                <p className="text-sm">Aprovar v{draft.version} para uso nas competências. Quem criou não aprova se houver outro administrador; o Master pode informar um override (mín. 20 caracteres).</p>
                {approved ? <p className="text-xs text-muted-foreground">A versão aprovada atual (v{approved.version}) passará a arquivada.</p> : null}
                <Label htmlFor="cc-override">Motivo do override (se você criou este rascunho)</Label>
                <Textarea id="cc-override" rows={2} maxLength={500} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={submitting} onClick={approve}>Confirmar aprovação</Button>
                  <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => setApproveOpen(false)}>Cancelar</Button>
                </div>
              </div>
            ) : null}
            {archiveOpen ? (
              <div className="space-y-2 rounded-lg border border-border/60 p-3">
                <Label htmlFor="cc-arch">Motivo da desativação *</Label>
                <Textarea id="cc-arch" rows={2} maxLength={500} value={archiveReason} onChange={(e) => { setArchiveReason(e.target.value); setArchiveKey("") }} />
                <p className="text-xs text-muted-foreground">Desativar não apaga: todas as versões permanecem no histórico.</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="destructive" disabled={submitting} onClick={archive}>Confirmar desativação</Button>
                  <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => setArchiveOpen(false)}>Cancelar</Button>
                </div>
              </div>
            ) : null}
            {error && !editing ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </section>

          {editing ? (
            <section aria-labelledby="cc-form-title" className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
              <h2 id="cc-form-title" className="text-lg font-semibold">{current ? `Nova versão (v${current.version + 1})` : "Nova configuração (rascunho)"}</h2>
              <p className="text-sm text-muted-foreground">Todos os componentes são opcionais. Componente sem valor não aparece ao funcionário (nunca como zero) e não entra no total.</p>
              <fieldset disabled={submitting} className="grid min-w-0 gap-4 sm:grid-cols-2">
                {COMPONENTS.map((c) => (
                  <div key={c} className="min-w-0 space-y-2 rounded-lg border border-border/40 p-3">
                    <Label htmlFor={`cc-${c}`}>{COMPONENT_LABEL[c]} (R$)</Label>
                    <Input id={`cc-${c}`} inputMode="decimal" autoComplete="off" placeholder="Não configurado" value={values[c]} onChange={(e) => set(c, e.target.value)} />
                    {c === "meal" ? (
                      <p className="text-xs text-muted-foreground">
                        Sugestão (não salva): {formatMoney(UI_SUGGESTION.mealDaily)} por dia{" "}
                        <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => set("meal", UI_SUGGESTION.mealDaily.replace(".", ","))}>Usar sugestão</button>
                      </p>
                    ) : null}
                    {c === "transport" || c === "fuel" ? (
                      <>
                        <Label htmlFor={`cc-${c}-method`} className="text-xs">Forma</Label>
                        <select id={`cc-${c}-method`} className={selectClass} value={c === "transport" ? values.transportMethod : values.fuelMethod} onChange={(e) => set(c === "transport" ? "transportMethod" : "fuelMethod", e.target.value)}>
                          <option value="">Selecione</option>
                          {BENEFIT_METHODS.map((m) => <option key={m} value={m}>{BENEFIT_METHOD_LABEL[m]}</option>)}
                        </select>
                      </>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <input id={`cc-${c}-show`} type="checkbox" className={checkboxClass} checked={values[SHOW_KEY[c]]} disabled={!values[c].trim()} onChange={(e) => set(SHOW_KEY[c], e.target.checked)} />
                      <label htmlFor={`cc-${c}-show`} className="text-sm">Exibir ao funcionário</label>
                    </div>
                  </div>
                ))}
                <div className="space-y-2">
                  <Label htmlFor="cc-from">Início de vigência *</Label>
                  <Input id="cc-from" type="date" min={today} value={values.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cc-until">Final de vigência (opcional)</Label>
                  <Input id="cc-until" type="date" min={values.validFrom || today} value={values.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="cc-notes">Observação (opcional)</Label>
                  <Textarea id="cc-notes" rows={2} maxLength={500} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="cc-reason">Motivo da alteração *</Label>
                  <Textarea id="cc-reason" rows={2} maxLength={500} value={values.reason} onChange={(e) => set("reason", e.target.value)} />
                </div>
              </fieldset>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={submit} disabled={submitting} className="gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Salvar nova versão
                </Button>
                <Button type="button" variant="outline" disabled={submitting} onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </section>
          ) : null}

          {compare && a && b ? (
            <section aria-label="Comparação de versões" className="space-y-2">
              <div className="flex flex-wrap gap-2 text-sm">
                <label className="flex items-center gap-2">De
                  <select className={selectClass + " h-8 w-auto"} value={compare[0]} onChange={(e) => setCompare([e.target.value, compare[1]])}>
                    {detail.versions.map((v) => <option key={v.profileId} value={v.profileId}>v{v.version}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2">Para
                  <select className={selectClass + " h-8 w-auto"} value={compare[1]} onChange={(e) => setCompare([compare[0], e.target.value])}>
                    {detail.versions.map((v) => <option key={v.profileId} value={v.profileId}>v{v.version}</option>)}
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-sm">
                  <caption className="sr-only">Comparação entre versões</caption>
                  <thead><tr className="text-left text-muted-foreground"><th scope="col" className="py-1 pr-2">Componente</th><th scope="col" className="py-1 pr-2">v{a.version}</th><th scope="col" className="py-1">v{b.version}</th></tr></thead>
                  <tbody>
                    {(() => {
                      const changed = diffVersions(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, COMPARE_KEYS as unknown as string[])
                      const rows: [string, (v: ProfileVersion) => string, boolean][] = [
                        ...COMPONENTS.map((c) => [COMPONENT_LABEL[c], (v: ProfileVersion) => `${componentSummary(v, c) ?? "Não configurado"}${componentSummary(v, c) ? (visibleOf(v, c) ? " · visível" : " · oculto") : ""}`, changed.some((k) => k.toLowerCase().includes(c === "meal" ? "meal" : c))] as [string, (v: ProfileVersion) => string, boolean]),
                        ["Vigência", (v: ProfileVersion) => `${formatDate(`${v.validFrom}T12:00:00Z`)} — ${v.validUntil ? formatDate(`${v.validUntil}T12:00:00Z`) : "sem data final"}`, changed.includes("validFrom") || changed.includes("validUntil")],
                        ["Observação", (v: ProfileVersion) => v.notes ?? "—", changed.includes("notes")],
                      ]
                      return rows.map(([label, fn, diff]) => (
                        <tr key={label} className={diff ? "bg-amber-500/10" : ""}>
                          <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground">{label}</th>
                          <td className="break-words py-1 pr-2">{fn(a)}</td>
                          <td className="break-words py-1">{fn(b)}</td>
                        </tr>
                      ))
                    })()}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {showHistory ? (
            <ol aria-label="Histórico de versões" className="space-y-2 border-l border-border/60 pl-4 text-sm">
              {detail.versions.map((v) => (
                <li key={v.profileId} className="space-y-0.5">
                  <VersionPill status={v.status} version={v.version} />
                  <p className="text-xs text-muted-foreground">Criada por {v.createdBy} em {formatDate(v.createdAt)}{v.reason ? ` — Motivo: ${v.reason}` : ""}</p>
                  {v.archivedAt ? <p className="text-xs text-muted-foreground">Desativada por {v.archivedBy ?? "Administrador"} em {formatDate(v.archivedAt)}{v.archiveReason ? ` — ${v.archiveReason}` : ""}</p> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </div>
  )
}
