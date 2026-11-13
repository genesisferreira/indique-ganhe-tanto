"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatCEP, formatCNPJ, formatCPF, formatPhoneBR, onlyDigits } from "@/lib/client/formatters"
import { fetchAddressByCEP } from "@/lib/client/viacep"
import {
  FIELD_MESSAGE,
  OPPORTUNITY_ROLE_LABEL,
  SUBMIT_ERROR_MESSAGE,
  newIdempotencyKey,
  parseOpportunityPayload,
  type FormContext,
  type OpportunityAttributionRole,
  type OpportunityField,
} from "@/lib/employee-opportunities/contract"

type Values = {
  name: string
  phone: string
  document: string
  zipcode: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  observation: string
  planId: string
  attributionRole: string
  consent: boolean
}

const FIELD_INPUT_ID: Record<OpportunityField, string> = {
  idempotencyKey: "eo-name", attributionRole: "eo-name", planId: "eo-plan", name: "eo-name", phone: "eo-phone",
  document: "eo-document", zipcode: "eo-zipcode", street: "eo-street", number: "eo-number", complement: "eo-complement",
  neighborhood: "eo-neighborhood", city: "eo-city", observation: "eo-observation", consent: "eo-consent",
}

const EMPTY: Values = {
  name: "", phone: "", document: "", zipcode: "", street: "", number: "", complement: "",
  neighborhood: "", city: "", observation: "", planId: "", attributionRole: "", consent: false,
}

const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"

function formatDocument(v: string): string {
  return onlyDigits(v).length > 11 ? formatCNPJ(v) : formatCPF(v)
}

type Success = { protocol: string; opportunityId: string; role: OpportunityAttributionRole; idempotent: boolean }

/**
 * 3.1F-J3 — formulário do funcionário. Sem localStorage; chave de idempotência por abertura
 * (renovada só após sucesso); botão bloqueado durante o envio; erro mantém os dados.
 */
export function EmployeeOpportunityForm({ context }: { context: FormContext }) {
  const singleRole = context.eligibleRoles.length === 1 ? context.eligibleRoles[0] : null
  const [values, setValues] = useState<Values>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<OpportunityField, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<Success | null>(null)
  const submittingRef = useRef(false)
  const keyRef = useRef<string | null>(null)

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((s) => ({ ...s, [k]: v }))
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }))
    if (needsConfirm && (k === "phone" || k === "document")) setNeedsConfirm(false)
  }

  async function onCepBlur() {
    if (onlyDigits(values.zipcode).length !== 8) return
    const r = await fetchAddressByCEP(values.zipcode).catch(() => null)
    if (!r || !r.ok) return
    setValues((s) => ({
      ...s,
      street: s.street || r.address.endereco,
      neighborhood: s.neighborhood || r.address.bairro,
      city: s.city || r.address.cidade,
    }))
  }

  async function submit(confirmRecentDuplicate: boolean) {
    if (submittingRef.current) return
    if (!keyRef.current) keyRef.current = newIdempotencyKey()
    const payload: Record<string, unknown> = {
      idempotencyKey: keyRef.current,
      planId: values.planId,
      name: values.name,
      phone: values.phone,
      zipcode: values.zipcode,
      street: values.street,
      number: values.number,
      neighborhood: values.neighborhood,
      city: values.city,
      consent: values.consent,
    }
    if (context.roleChoiceRequired) payload.attributionRole = values.attributionRole || null
    if (values.document.trim()) payload.document = values.document
    if (values.complement.trim()) payload.complement = values.complement
    if (values.observation.trim()) payload.observation = values.observation
    if (confirmRecentDuplicate) payload.confirmRecentDuplicate = true

    const local = parseOpportunityPayload(payload)
    if (!local.ok) {
      setErrors(local.field ? { [local.field]: local.message } : {})
      setFormError(local.field ? null : local.message)
      if (local.field) document.getElementById(FIELD_INPUT_ID[local.field])?.focus()
      return
    }
    if (context.roleChoiceRequired && !values.attributionRole) {
      setErrors({ attributionRole: FIELD_MESSAGE.attributionRole })
      setFormError(null)
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetch("/api/employee/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "same-origin",
      })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (body && body.ok === true && typeof body.protocol === "string") {
        setSuccess({
          protocol: body.protocol,
          opportunityId: String(body.opportunityId),
          role: body.attributionRole as OpportunityAttributionRole,
          idempotent: body.idempotent === true,
        })
        setValues(EMPTY)
        setErrors({})
        setNeedsConfirm(false)
        keyRef.current = newIdempotencyKey()
        return
      }
      const code = typeof body?.code === "string" ? body.code : "unavailable"
      const message = typeof body?.message === "string" ? body.message : SUBMIT_ERROR_MESSAGE.unavailable
      if (code === "duplicate_recent_closed" && body?.requiresConfirmation === true) {
        setNeedsConfirm(true)
        setFormError(null)
        return
      }
      if (code === "idempotency_conflict") keyRef.current = newIdempotencyKey()
      if (code === "invalid_payload" && typeof body?.field === "string") {
        setErrors({ [body.field as OpportunityField]: message })
        return
      }
      setFormError(message)
    } catch {
      setFormError(SUBMIT_ERROR_MESSAGE.unavailable)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const fieldError = (f: OpportunityField) =>
    errors[f] ? (
      <p id={`${f}-error`} className="text-xs text-destructive" role="alert">{errors[f]}</p>
    ) : null
  const aria = (f: OpportunityField) => ({ "aria-invalid": errors[f] ? true : undefined, "aria-describedby": errors[f] ? `${f}-error` : undefined })

  return (
    <div className="max-w-2xl space-y-6">
      {success ? (
        <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
            {success.idempotent ? "Oportunidade já registrada" : "Oportunidade registrada"}
          </div>
          <p className="text-sm text-muted-foreground">
            Protocolo <span className="font-mono font-semibold text-foreground">{success.protocol}</span> · {OPPORTUNITY_ROLE_LABEL[success.role]} · Etapa: Interessado
          </p>
          <p className="text-sm text-muted-foreground">O atendimento será feito pela equipe comercial. Comissão: aguardando regra financeira.</p>
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            <Link href={`/funcionario/vendas/${success.opportunityId}`} className="text-primary underline-offset-4 hover:underline">Acompanhar</Link>
            <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setSuccess(null)}>Registrar outra</button>
          </div>
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit(false)
        }}
        aria-busy={submitting}
        className="space-y-6"
      >
        <fieldset disabled={submitting} className="space-y-6">
          <div className="rounded-xl border bg-card p-4 sm:p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground">Dados do cliente</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="eo-name">Nome completo *</Label>
                <Input id="eo-name" autoComplete="off" maxLength={120} placeholder="Ex.: Maria da Silva" value={values.name} onChange={(e) => set("name", e.target.value)} {...aria("name")} />
                {fieldError("name")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="eo-phone">Telefone / WhatsApp *</Label>
                <Input id="eo-phone" type="tel" inputMode="numeric" autoComplete="off" placeholder="(31) 99999-9999" value={values.phone} onChange={(e) => set("phone", formatPhoneBR(e.target.value))} {...aria("phone")} />
                {fieldError("phone")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="eo-document">CPF ou CNPJ (opcional)</Label>
                <Input id="eo-document" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={values.document} onChange={(e) => set("document", formatDocument(e.target.value))} {...aria("document")} />
                {fieldError("document")}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="eo-plan">Plano de interesse *</Label>
                <select id="eo-plan" className={selectClass} value={values.planId} onChange={(e) => set("planId", e.target.value)} {...aria("planId")}>
                  <option value="">Selecione</option>
                  {context.plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {fieldError("planId")}
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 sm:p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground">Endereço de instalação</h2>
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="eo-zipcode">CEP *</Label>
                <Input id="eo-zipcode" inputMode="numeric" autoComplete="off" placeholder="00000-000" value={values.zipcode} onChange={(e) => set("zipcode", formatCEP(e.target.value))} onBlur={() => void onCepBlur()} {...aria("zipcode")} />
                {fieldError("zipcode")}
              </div>
              <div className="space-y-2 sm:col-span-4">
                <Label htmlFor="eo-street">Endereço *</Label>
                <Input id="eo-street" autoComplete="off" maxLength={160} placeholder="Rua, avenida…" value={values.street} onChange={(e) => set("street", e.target.value)} {...aria("street")} />
                {fieldError("street")}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="eo-number">Número *</Label>
                <Input id="eo-number" autoComplete="off" maxLength={20} value={values.number} onChange={(e) => set("number", e.target.value)} {...aria("number")} />
                {fieldError("number")}
              </div>
              <div className="space-y-2 sm:col-span-4">
                <Label htmlFor="eo-complement">Complemento (opcional)</Label>
                <Input id="eo-complement" autoComplete="off" maxLength={80} placeholder="Apto, bloco…" value={values.complement} onChange={(e) => set("complement", e.target.value)} {...aria("complement")} />
                {fieldError("complement")}
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="eo-neighborhood">Bairro *</Label>
                <Input id="eo-neighborhood" autoComplete="off" maxLength={100} value={values.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} {...aria("neighborhood")} />
                {fieldError("neighborhood")}
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="eo-city">Cidade *</Label>
                <Input id="eo-city" autoComplete="off" maxLength={100} value={values.city} onChange={(e) => set("city", e.target.value)} {...aria("city")} />
                {fieldError("city")}
              </div>
              <div className="space-y-2 sm:col-span-6">
                <Label htmlFor="eo-observation">Observação (opcional)</Label>
                <Textarea id="eo-observation" maxLength={500} rows={3} placeholder="Melhor horário para contato, referência…" value={values.observation} onChange={(e) => set("observation", e.target.value)} {...aria("observation")} />
                {fieldError("observation")}
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 sm:p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Registro</h2>
            {context.roleChoiceRequired ? (
              <div role="radiogroup" aria-labelledby="eo-role-label" aria-describedby={errors.attributionRole ? "attributionRole-error" : undefined} className="space-y-2">
                <p id="eo-role-label" className="text-sm font-medium">Você está registrando como *</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {context.eligibleRoles.map((r) => (
                    <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input type="radio" name="attributionRole" value={r} checked={values.attributionRole === r} onChange={() => set("attributionRole", r)} className="h-4 w-4 accent-[var(--primary)]" />
                      {OPPORTUNITY_ROLE_LABEL[r]}
                    </label>
                  ))}
                </div>
                {fieldError("attributionRole")}
              </div>
            ) : singleRole ? (
              <p className="text-sm text-muted-foreground">Registrando como <span className="font-medium text-foreground">{OPPORTUNITY_ROLE_LABEL[singleRole]}</span>.</p>
            ) : null}
            <div className="flex items-start gap-3">
              <input
                id="eo-consent"
                type="checkbox"
                checked={values.consent}
                onChange={(e) => set("consent", e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-[var(--primary)]"
                aria-describedby={errors.consent ? "consent-error" : undefined}
                aria-invalid={errors.consent ? true : undefined}
              />
              <Label htmlFor="eo-consent" className="cursor-pointer text-sm font-normal leading-relaxed">
                Confirmo que o cliente autorizou o contato da Tanto Telecom para oferta de serviços. *
              </Label>
            </div>
            {fieldError("consent")}
            <p className="text-xs text-muted-foreground">Comissão: aguardando regra financeira. Este cadastro não gera recompensa do Indique e Ganhe.</p>
          </div>
        </fieldset>

        {needsConfirm ? (
          <div role="alert" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              {SUBMIT_ERROR_MESSAGE.duplicate_recent_closed}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={submitting} onClick={() => void submit(true)}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Registrar mesmo assim
              </Button>
              <Button type="button" variant="outline" disabled={submitting} onClick={() => setNeedsConfirm(false)}>Revisar dados</Button>
            </div>
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <Button asChild type="button" variant="outline">
            <Link href="/funcionario">Cancelar</Link>
          </Button>
          <Button type="submit" disabled={submitting || needsConfirm} className="sm:min-w-56">
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Registrando…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
                Registrar oportunidade
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
