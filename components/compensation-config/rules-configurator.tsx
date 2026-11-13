"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, History, Loader2, Plus, GitCompare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  CONFIGURABLE_ROLES,
  DISABLED_ROLES,
  COMMISSION_METHODS,
  FIRST_INVOICE_NOT_ACTIVATABLE,
  FIXED_AMOUNT_ACTIVATABLE_COPY,
  METHOD_LABEL,
  METHOD_TRIGGER,
  PERCENTAGE_BASE_UNPROVEN,
  ROLE_LABEL,
  TRIGGER_LABEL,
  UI_SUGGESTION,
  diffVersions,
  fractionToPercentLabel,
  newIdempotencyKey,
  parseMoneyInput,
  percentToFraction,
  type CommissionMethod,
  type CommissionRole,
  type RuleFamily,
  type RuleView,
} from "@/lib/compensation-config/contract"
import { WRITE_ENDPOINT, postDraft } from "@/lib/compensation-config/client"
import { J6_ENDPOINT, postCommission } from "@/lib/commission-activation/client"
import { isMethodActivatable, methodBlockReason } from "@/lib/commission-activation/evidence"
import { formatDate, formatMoney } from "@/lib/employee-portal/format"
import { ActivateDisabled, VersionPill, Warning, selectClass } from "@/components/compensation-config/ui"

type FormValues = {
  name: string
  attributionRole: string
  method: string
  fixedAmount: string
  percent: string
  effectiveFrom: string
  effectiveUntil: string
  description: string
  reason: string
}
/** Formulário SEMPRE começa vazio (sem defaults). Sugestões só por clique. */
export const EMPTY_RULE_FORM: FormValues = {
  name: "", attributionRole: "", method: "", fixedAmount: "", percent: "", effectiveFrom: "", effectiveUntil: "", description: "", reason: "",
}

function toInputMoney(v: string | null): string {
  return v ? v.replace(".", ",") : ""
}
function fractionToPercentInput(v: string | null): string {
  const l = fractionToPercentLabel(v)
  return l === "—" ? "" : l.replace("%", "")
}
export function ruleValueLabel(r: Pick<RuleView, "method" | "fixedAmount" | "percentageRate">): string {
  if (r.method === "fixed_amount") return formatMoney(r.fixedAmount)
  if (r.method === "percentage") return fractionToPercentLabel(r.percentageRate)
  return "Valor da primeira fatura paga"
}
const period = (from: string, until: string | null) => `${formatDate(`${from}T12:00:00Z`)} — ${until ? formatDate(`${until}T12:00:00Z`) : "sem data final"}`

const COMPARE_KEYS = ["name", "method", "fixedAmount", "percentageRate", "effectiveFrom", "effectiveUntil", "description"] as const
const COMPARE_LABEL: Record<(typeof COMPARE_KEYS)[number], string> = {
  name: "Nome", method: "Tipo", fixedAmount: "Valor fixo", percentageRate: "Percentual", effectiveFrom: "Vigência inicial", effectiveUntil: "Vigência final", description: "Descrição",
}
function compareCell(r: RuleView, k: (typeof COMPARE_KEYS)[number]): string {
  if (k === "method") return METHOD_LABEL[r.method]
  if (k === "fixedAmount") return r.fixedAmount ? formatMoney(r.fixedAmount) : "—"
  if (k === "percentageRate") return r.percentageRate ? fractionToPercentLabel(r.percentageRate) : "—"
  if (k === "effectiveFrom") return formatDate(`${r.effectiveFrom}T12:00:00Z`)
  if (k === "effectiveUntil") return r.effectiveUntil ? formatDate(`${r.effectiveUntil}T12:00:00Z`) : "sem data final"
  return (r[k] as string | null) ?? "—"
}

export function RulesConfigurator({ families, today }: { families: RuleFamily[]; today: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState<{ mode: "new" } | { mode: "version"; base: RuleView } | null>(null)
  const [values, setValues] = useState<FormValues>(EMPTY_RULE_FORM)
  const [idemKey, setIdemKey] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const set = (k: keyof FormValues, v: string) => {
    setValues((s) => ({ ...s, [k]: v }))
    setIdemKey("") // payload mudou => nova operação
  }
  const openNew = () => {
    setEditing({ mode: "new" })
    setValues(EMPTY_RULE_FORM)
    setIdemKey("")
    setError(null)
    setNotice(null)
  }
  const openVersion = (base: RuleView) => {
    setEditing({ mode: "version", base })
    setValues({
      name: base.name,
      attributionRole: base.attributionRole,
      method: base.method,
      fixedAmount: toInputMoney(base.fixedAmount),
      percent: fractionToPercentInput(base.percentageRate),
      effectiveFrom: base.effectiveFrom < today ? today : base.effectiveFrom,
      effectiveUntil: base.effectiveUntil ?? "",
      description: base.description ?? "",
      reason: "",
    })
    setIdemKey("")
    setError(null)
    setNotice(null)
  }

  const role = values.attributionRole as CommissionRole
  const method = values.method as CommissionMethod
  const suggestion = role === "technician_originator" || role === "external_sales_originator" ? UI_SUGGESTION[role] : null

  async function submit() {
    setError(null)
    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      method: values.method,
      effectiveFrom: values.effectiveFrom,
      reason: values.reason.trim(),
    }
    if (editing?.mode === "version") payload.previousRuleId = editing.base.id
    else payload.attributionRole = values.attributionRole
    if (values.method === "fixed_amount") {
      const m = parseMoneyInput(values.fixedAmount)
      if (!m) return setError("Informe um valor fixo positivo (até 2 casas decimais).")
      payload.fixedAmount = m
    }
    if (values.method === "percentage") {
      const f = percentToFraction(values.percent)
      if (!f) return setError("Percentual inválido: maior que 0, até 100% e no máximo 4 casas decimais.")
      payload.percentageRate = f
    }
    if (values.effectiveUntil) payload.effectiveUntil = values.effectiveUntil
    if (values.description.trim()) payload.description = values.description.trim()
    const key = idemKey || newIdempotencyKey()
    setIdemKey(key)
    setSubmitting(true)
    const r = await postDraft(WRITE_ENDPOINT.rule_save, { idempotencyKey: key, ...payload })
    setSubmitting(false)
    if (!r.ok) return setError(r.message)
    setNotice(`Rascunho salvo (versão ${String(r.body.version ?? "")}). Nenhuma regra foi ativada.`)
    setEditing(null)
    setValues(EMPTY_RULE_FORM)
    setIdemKey("")
    router.refresh()
  }

  const grouped = useMemo(() => {
    const m = new Map<CommissionRole, RuleFamily[]>()
    for (const f of families) m.set(f.attributionRole, [...(m.get(f.attributionRole) ?? []), f])
    return m
  }, [families])

  return (
    <div className="space-y-6">
      {notice ? (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden /> {notice}
        </p>
      ) : null}

      {!editing ? (
        <Button type="button" onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" aria-hidden /> Nova regra em rascunho
        </Button>
      ) : (
        <section aria-labelledby="rule-form-title" className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
          <h2 id="rule-form-title" className="text-lg font-semibold">
            {editing.mode === "new" ? "Nova regra (rascunho)" : `Nova versão de “${editing.base.name}” (v${editing.base.version + 1})`}
          </h2>
          <fieldset disabled={submitting} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cr-name">Nome *</Label>
              <Input id="cr-name" maxLength={120} autoComplete="off" value={values.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-role">Papel elegível *</Label>
              <select id="cr-role" className={selectClass} value={values.attributionRole} disabled={editing.mode === "version"} onChange={(e) => set("attributionRole", e.target.value)}>
                <option value="">Selecione</option>
                {CONFIGURABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                {DISABLED_ROLES.map((r) => <option key={r} value={r} disabled>{ROLE_LABEL[r]} (desabilitado nesta etapa)</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-method">Tipo *</Label>
              <select id="cr-method" className={selectClass} value={values.method} onChange={(e) => set("method", e.target.value)}>
                <option value="">Selecione</option>
                {COMMISSION_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <p className="text-sm font-medium">Gatilho</p>
              <p className="text-sm text-muted-foreground" aria-live="polite">{method ? TRIGGER_LABEL[METHOD_TRIGGER[method]] : "Definido pelo tipo"}</p>
            </div>
            {method === "fixed_amount" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cr-fixed">Valor fixo (R$) *</Label>
                <Input id="cr-fixed" inputMode="decimal" autoComplete="off" placeholder="0,00" value={values.fixedAmount} onChange={(e) => set("fixedAmount", e.target.value)} />
                {suggestion ? (
                  <p className="text-xs text-muted-foreground">
                    Sugestão (não salva): {formatMoney(suggestion.amount)}{" "}
                    <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => set("fixedAmount", suggestion.amount.replace(".", ","))}>Usar sugestão</button>
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">{FIXED_AMOUNT_ACTIVATABLE_COPY}</p>
              </div>
            ) : null}
            {method === "percentage" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cr-percent">Percentual (%) *</Label>
                  <Input id="cr-percent" inputMode="decimal" autoComplete="off" placeholder="0,0000" value={values.percent} onChange={(e) => set("percent", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cr-base">Base percentual *</Label>
                  <select id="cr-base" className={selectClass} disabled value="">
                    <option value="">Nenhuma base comprovada no sistema</option>
                  </select>
                </div>
                <div className="sm:col-span-2"><Warning>{PERCENTAGE_BASE_UNPROVEN}</Warning></div>
              </>
            ) : null}
            {method === "first_invoice_value" ? (
              <div className="sm:col-span-2"><Warning>{FIRST_INVOICE_NOT_ACTIVATABLE}</Warning></div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="cr-from">Vigência inicial *</Label>
              <Input id="cr-from" type="date" min={today} value={values.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-until">Vigência final (opcional)</Label>
              <Input id="cr-until" type="date" min={values.effectiveFrom || today} value={values.effectiveUntil} onChange={(e) => set("effectiveUntil", e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cr-desc">Descrição (opcional)</Label>
              <Textarea id="cr-desc" maxLength={500} rows={2} value={values.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cr-reason">Motivo da alteração *</Label>
              <Textarea id="cr-reason" maxLength={500} rows={2} value={values.reason} onChange={(e) => set("reason", e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">Ativa: não · Retroativa: não · Sem cálculo de comissão nesta etapa.</p>
          </fieldset>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={submit} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Salvar rascunho
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={submitting}>Cancelar</Button>
          </div>
        </section>
      )}

      {families.length === 0 ? (
        <div role="status" className="rounded-xl border border-dashed border-border/60 bg-card/30 p-6 text-center">
          <p className="font-medium">Nenhuma regra configurada</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">Crie um rascunho para Técnico de Rua ou Vendedor Externo. Nada é salvo automaticamente.</p>
        </div>
      ) : (
        [...CONFIGURABLE_ROLES, ...DISABLED_ROLES].filter((r) => grouped.has(r)).map((r) => (
          <section key={r} aria-labelledby={`role-${r}`} className="space-y-3">
            <h2 id={`role-${r}`} className="text-lg font-semibold">{ROLE_LABEL[r]}</h2>
            <ul className="space-y-3">
              {(grouped.get(r) ?? []).map((f) => (
                <li key={f.familyId}>
                  <RuleCard family={f} onVersion={openVersion} onArchived={(msg) => { setNotice(msg); router.refresh() }} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function RuleCard({ family, onVersion, onArchived }: { family: RuleFamily; onVersion: (r: RuleView) => void; onArchived: (msg: string) => void }) {
  const cur = family.current
  const [showHistory, setShowHistory] = useState(false)
  const [compare, setCompare] = useState<[string, string] | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState("")
  const [archiveKey, setArchiveKey] = useState("")
  const [overrideReason, setOverrideReason] = useState("")
  const [activateReason, setActivateReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isDraft = cur.status === "draft"
  const canActivate = isMethodActivatable(cur.method)

  async function archive() {
    setError(null)
    const key = archiveKey || newIdempotencyKey()
    setArchiveKey(key)
    setBusy(true)
    const r = await postDraft(WRITE_ENDPOINT.rule_archive, { idempotencyKey: key, ruleId: cur.id, reason: archiveReason.trim() })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    setArchiveOpen(false)
    onArchived(`Rascunho “${cur.name}” arquivado. O histórico foi mantido.`)
  }

  const a = compare ? family.versions.find((v) => v.id === compare[0]) : undefined
  const b = compare ? family.versions.find((v) => v.id === compare[1]) : undefined

  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-medium">{cur.name}</h3>
          <p className="text-sm text-muted-foreground">{METHOD_LABEL[cur.method]} · {TRIGGER_LABEL[cur.triggerKind]}</p>
        </div>
        <VersionPill status={cur.status} version={cur.version} />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Valor</dt><dd className="font-medium tabular-nums">{ruleValueLabel(cur)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">Vigência</dt><dd>{period(cur.effectiveFrom, cur.effectiveUntil)}</dd></div>
      </dl>
      {cur.description ? <p className="break-words text-sm text-muted-foreground">{cur.description}</p> : null}
      {cur.method === "fixed_amount" ? <p className="text-xs text-muted-foreground">{FIXED_AMOUNT_ACTIVATABLE_COPY}</p> : null}
      {cur.method === "percentage" && cur.incomplete ? <Warning>{PERCENTAGE_BASE_UNPROVEN}</Warning> : null}
      {cur.method === "first_invoice_value" ? <Warning>{FIRST_INVOICE_NOT_ACTIVATABLE}</Warning> : null}
      {cur.status === "archived" ? (
        <p className="text-xs text-muted-foreground">Arquivada por {cur.archivedBy ?? "Administrador"} em {formatDate(cur.archivedAt)}{cur.archiveReason ? ` — ${cur.archiveReason}` : ""}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {isDraft ? <Button type="button" size="sm" variant="outline" onClick={() => onVersion(cur)}>Editar (nova versão)</Button> : null}
        <Button type="button" size="sm" variant="ghost" className="gap-1" aria-expanded={showHistory} onClick={() => setShowHistory((s) => !s)}>
          <History className="h-4 w-4" aria-hidden /> Histórico ({family.versions.length})
        </Button>
        {family.versions.length > 1 ? (
          <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setCompare(compare ? null : [family.versions[1].id, family.versions[0].id])}>
            <GitCompare className="h-4 w-4" aria-hidden /> Comparar versões
          </Button>
        ) : null}
        {isDraft ? <Button type="button" size="sm" variant="ghost" onClick={() => { setArchiveOpen((s) => !s); setError(null) }}>Arquivar rascunho</Button> : null}
        {isDraft ? (
          <Button type="button" size="sm" disabled={busy} onClick={async () => {
            setError(null); setBusy(true)
            const r = await postCommission(J6_ENDPOINT.rule_approve, { idempotencyKey: newIdempotencyKey(), ruleId: cur.id, ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}) })
            setBusy(false)
            if (!r.ok) return setError(r.message)
            onArchived(`Regra “${cur.name}” aprovada. Ativação só com prova financeira.`)
          }}>Aprovar</Button>
        ) : null}
        {cur.status === "approved" && canActivate ? (
          <div className="flex w-full flex-wrap items-end gap-2">
            <Textarea rows={2} maxLength={500} placeholder="Motivo da ativação (mín. 20)" value={activateReason} onChange={(e) => setActivateReason(e.target.value)} />
            <Button type="button" size="sm" disabled={busy} onClick={async () => {
              setError(null); setBusy(true)
              const r = await postCommission(J6_ENDPOINT.rule_activate, { idempotencyKey: newIdempotencyKey(), ruleId: cur.id, reason: activateReason.trim() })
              setBusy(false)
              if (!r.ok) return setError(r.message)
              onArchived(`Regra “${cur.name}” ativada.`)
            }}>Ativar</Button>
          </div>
        ) : (
          <ActivateDisabled id={`rule-${cur.id}`} />
        )}
      </div>
      {isDraft ? (
        <div className="space-y-1">
          <Label htmlFor={`ov-${cur.id}`}>Override do Master (se você criou o rascunho)</Label>
          <Textarea id={`ov-${cur.id}`} rows={2} maxLength={500} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        </div>
      ) : null}
      {!canActivate ? <p className="text-xs text-muted-foreground">{methodBlockReason(cur.method)}</p> : null}
      {archiveOpen ? (
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <Label htmlFor={`arch-${cur.id}`}>Motivo do arquivamento *</Label>
          <Textarea id={`arch-${cur.id}`} rows={2} maxLength={500} value={archiveReason} onChange={(e) => { setArchiveReason(e.target.value); setArchiveKey("") }} />
          <p className="text-xs text-muted-foreground">Arquivar não apaga: a regra e o histórico permanecem registrados.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={archive}>Confirmar arquivamento</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setArchiveOpen(false)}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {compare && a && b ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-sm">
            <label className="flex items-center gap-2">De
              <select className={selectClass + " h-8 w-auto"} value={compare[0]} onChange={(e) => setCompare([e.target.value, compare[1]])}>
                {family.versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">Para
              <select className={selectClass + " h-8 w-auto"} value={compare[1]} onChange={(e) => setCompare([compare[0], e.target.value])}>
                {family.versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <caption className="sr-only">Comparação entre versões</caption>
              <thead><tr className="text-left text-muted-foreground"><th scope="col" className="py-1 pr-2">Campo</th><th scope="col" className="py-1 pr-2">v{a.version}</th><th scope="col" className="py-1">v{b.version}</th></tr></thead>
              <tbody>
                {(() => {
                  const changed = diffVersions(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, COMPARE_KEYS as unknown as string[])
                  return COMPARE_KEYS.map((k) => (
                    <tr key={k} className={changed.includes(k) ? "bg-amber-500/10" : ""}>
                      <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground">{COMPARE_LABEL[k]}</th>
                      <td className="break-words py-1 pr-2">{compareCell(a, k)}</td>
                      <td className="break-words py-1">{compareCell(b, k)}</td>
                    </tr>
                  ))
                })()}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {showHistory ? (
        <ol className="space-y-2 border-l border-border/60 pl-4 text-sm">
          {family.versions.map((v) => (
            <li key={v.id} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2"><VersionPill status={v.status} version={v.version} /><span className="tabular-nums">{ruleValueLabel(v)}</span></div>
              <p className="text-xs text-muted-foreground">Criada por {v.createdBy} em {formatDate(v.createdAt)}{v.reason ? ` — Motivo: ${v.reason}` : ""}</p>
              {v.archivedAt ? <p className="text-xs text-muted-foreground">Arquivada por {v.archivedBy ?? "Administrador"} em {formatDate(v.archivedAt)}{v.archiveReason ? ` — ${v.archiveReason}` : ""}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  )
}
