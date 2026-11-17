"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fetchAddressByCEP } from "@/lib/client/viacep"
import { onlyDigits } from "@/lib/client/formatters"
import { maskBirthDateInput, maskReferralDocument, REFERRAL_SHARE_DUE_DAY_LABEL, REFERRAL_SHARE_DUE_DAYS, REFERRAL_SHARE_PLANS, birthDateInputToIso, isReferralShareDueDay, referralDocumentDigits, referralShareBirthIssue } from "@/lib/referral-share/public-catalog"

function newKey() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40)
}

export function ReferralSharePublicForm({ token }: { token: string }) {
  const keyRef = useRef(newKey())
  const submittingRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [headline, setHeadline] = useState("")
  const [planCode, setPlanCode] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [document, setDocument] = useState("")
  const [birthDate, setBirthDate] = useState("")
  const [dueDay, setDueDay] = useState("")
  const [zipcode, setZipcode] = useState("")
  const [street, setStreet] = useState("")
  const [number, setNumber] = useState("")
  const [complement, setComplement] = useState("")
  const [neighborhood, setNeighborhood] = useState("")
  const [city, setCity] = useState("")
  const [observation, setObservation] = useState("")
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [protocol, setProtocol] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const response = await fetch("/api/public/indicacao/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const body = await response.json().catch(() => null)
      if (cancelled) return
      if (!response.ok || !body?.ok) setUnavailable(true)
      else {
        setHeadline(String(body.headline ?? ""))
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function lookupCep(value: string) {
    const digits = onlyDigits(value)
    setZipcode(digits)
    if (digits.length !== 8) return
    const found = await fetchAddressByCEP(digits)
    if (!found.ok) return
    setStreet(found.address.endereco || street)
    setNeighborhood(found.address.bairro || neighborhood)
    setCity(found.address.cidade || city)
  }

  async function submit(confirmRecentDuplicate = false) {
    if (submittingRef.current) return
    const documentDigits = referralDocumentDigits(document)
    if (!documentDigits) {
      setMessage("Informe um CPF ou CNPJ válido.")
      return
    }
    const company = documentDigits.length === 14
    const birthIssue = company ? "ok" : referralShareBirthIssue(birthDate)
    if (birthIssue === "future") {
      setMessage("A data de nascimento não pode estar no futuro.")
      return
    }
    if (birthIssue !== "ok") {
      setMessage("Informe a data de nascimento.")
      return
    }
    const due = Number(dueDay)
    if (!isReferralShareDueDay(due)) {
      setMessage("Escolha o melhor dia para vencimento da fatura.")
      return
    }
    if (!planCode) {
      setMessage("Escolha um plano de interesse.")
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setMessage(null)
    try {
      const response = await fetch("/api/public/indicacao/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          payload: {
            idempotencyKey: keyRef.current, planCode, name, phone, document: documentDigits,
            birthDate: company ? null : birthDateInputToIso(birthDate),
            preferredInvoiceDueDay: due,
            zipcode, street, number,
            complement, neighborhood, city, observation, consent, confirmRecentDuplicate,
          },
        }),
      })
      const body = await response.json().catch(() => null)
      if (body?.code === "duplicate_recent_closed") {
        setNeedsConfirm(true)
        setMessage(body.message)
        return
      }
      if (!response.ok || !body?.ok) {
        setMessage(body?.message ?? "Não foi possível enviar a indicação.")
        return
      }
      setProtocol(String(body.protocol ?? ""))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen px-4 py-16 text-center text-muted-foreground">Carregando…</div>
  if (unavailable) {
    return (
      <div className="min-h-screen px-4 py-16">
        <Card className="mx-auto w-full max-w-lg">
          <CardHeader><CardTitle>Link indisponível</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Não foi possível usar este link.</CardContent>
        </Card>
      </div>
    )
  }
  if (protocol) {
    return (
      <div className="min-h-screen px-4 py-10">
        <Card className="mx-auto w-full max-w-lg">
          <CardHeader><CardTitle>Indicação recebida</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{headline}</p>
            <p>Protocolo: <strong className="tracking-wide">{protocol}</strong></p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <form className="mx-auto w-full max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(false) }}>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl sm:text-2xl">Pré-cadastro Tanto Telecom</CardTitle>
            <p className="text-sm text-muted-foreground">{headline}</p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field id="share-name" label="Nome completo"><Input id="share-name" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" className="w-full" /></Field>
            <Field id="share-phone" label="Telefone / WhatsApp"><Input id="share-phone" value={phone} onChange={(event) => setPhone(event.target.value)} required inputMode="tel" autoComplete="tel" className="w-full" /></Field>
            <Field id="share-document" label="CPF ou CNPJ"><Input id="share-document" value={document} onChange={(event) => setDocument(maskReferralDocument(event.target.value))} placeholder="Digite o CPF ou CNPJ" required inputMode="numeric" autoComplete="off" className="w-full" /></Field>
            {referralDocumentDigits(document)?.length === 14 ? null : (
              <Field id="share-birth" label="Data de nascimento">
                <Input id="share-birth" value={birthDate} onChange={(event) => setBirthDate(maskBirthDateInput(event.target.value))} placeholder="DD/MM/AAAA" required inputMode="numeric" autoComplete="bday" className="w-full" />
              </Field>
            )}
            <Field id="share-zip" label="CEP"><Input id="share-zip" value={zipcode} onChange={(event) => void lookupCep(event.target.value)} required inputMode="numeric" autoComplete="postal-code" className="w-full" /></Field>
            <Field id="share-street" label="Endereço"><Input id="share-street" value={street} onChange={(event) => setStreet(event.target.value)} required autoComplete="address-line1" className="w-full" /></Field>
            <Field id="share-number" label="Número"><Input id="share-number" value={number} onChange={(event) => setNumber(event.target.value)} required className="w-full" /></Field>
            <Field id="share-complement" label="Complemento"><Input id="share-complement" value={complement} onChange={(event) => setComplement(event.target.value)} className="w-full" /></Field>
            <Field id="share-neighborhood" label="Bairro"><Input id="share-neighborhood" value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} required className="w-full" /></Field>
            <Field id="share-city" label="Cidade"><Input id="share-city" value={city} onChange={(event) => setCity(event.target.value)} required className="w-full" /></Field>
            <Field id="share-plan" label="Plano de interesse">
              <Select value={planCode} onValueChange={setPlanCode}>
                <SelectTrigger id="share-plan" className="h-auto min-h-9 w-full whitespace-normal text-left"><SelectValue placeholder="Escolha um plano" /></SelectTrigger>
                <SelectContent>{REFERRAL_SHARE_PLANS.map((plan) => <SelectItem key={plan.code} value={plan.code} className="whitespace-normal">{plan.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="share-due" label={REFERRAL_SHARE_DUE_DAY_LABEL}>
              <Select value={dueDay} onValueChange={setDueDay}>
                <SelectTrigger id="share-due" className="w-full"><SelectValue placeholder="Escolha o dia" /></SelectTrigger>
                <SelectContent>{REFERRAL_SHARE_DUE_DAYS.map((day) => <SelectItem key={day} value={String(day)}>{String(day).padStart(2, "0")}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="share-observation" label="Observação (opcional)"><Textarea id="share-observation" value={observation} onChange={(event) => setObservation(event.target.value)} className="w-full" /></Field>
            <label className="flex items-start gap-2 text-sm" htmlFor="share-consent">
              <Checkbox id="share-consent" checked={consent} onCheckedChange={(value) => setConsent(value === true)} />
              <span>Autorizo o contato da Tanto Telecom sobre este pré-cadastro.</span>
            </label>
            <p className="text-sm text-muted-foreground">Seus dados serão utilizados pela Tanto Telecom para consultar a disponibilidade e entrar em contato sobre os serviços selecionados.</p>
            {message ? <p className="text-sm text-destructive" role="status">{message}</p> : null}
            {needsConfirm ? <Button type="button" variant="outline" disabled={submitting} onClick={() => void submit(true)}>Confirmar mesmo assim</Button> : null}
            <Button type="submit" disabled={submitting || !consent} className="w-full">{submitting ? "Enviando…" : "Enviar indicação"}</Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
