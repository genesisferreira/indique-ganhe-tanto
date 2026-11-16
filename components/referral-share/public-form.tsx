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

type Plan = { id: string; name: string }

function newKey() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40)
}

export function ReferralSharePublicForm({ token }: { token: string }) {
  const keyRef = useRef(newKey())
  const submittingRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [headline, setHeadline] = useState("")
  const [plans, setPlans] = useState<Plan[]>([])
  const [planId, setPlanId] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [document, setDocument] = useState("")
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
        setPlans(Array.isArray(body.plans) ? body.plans : [])
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
            idempotencyKey: keyRef.current, planId, name, phone, document, zipcode, street, number,
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
            <Field id="share-document" label="Documento (opcional)"><Input id="share-document" value={document} onChange={(event) => setDocument(event.target.value)} className="w-full" /></Field>
            <Field id="share-zip" label="CEP"><Input id="share-zip" value={zipcode} onChange={(event) => void lookupCep(event.target.value)} required inputMode="numeric" autoComplete="postal-code" className="w-full" /></Field>
            <Field id="share-street" label="Endereço"><Input id="share-street" value={street} onChange={(event) => setStreet(event.target.value)} required autoComplete="address-line1" className="w-full" /></Field>
            <Field id="share-number" label="Número"><Input id="share-number" value={number} onChange={(event) => setNumber(event.target.value)} required className="w-full" /></Field>
            <Field id="share-complement" label="Complemento"><Input id="share-complement" value={complement} onChange={(event) => setComplement(event.target.value)} className="w-full" /></Field>
            <Field id="share-neighborhood" label="Bairro"><Input id="share-neighborhood" value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} required className="w-full" /></Field>
            <Field id="share-city" label="Cidade"><Input id="share-city" value={city} onChange={(event) => setCity(event.target.value)} required className="w-full" /></Field>
            <Field id="share-plan" label="Plano de interesse">
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger id="share-plan" className="w-full"><SelectValue placeholder="Escolha um plano" /></SelectTrigger>
                <SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="share-observation" label="Observação (opcional)"><Textarea id="share-observation" value={observation} onChange={(event) => setObservation(event.target.value)} className="w-full" /></Field>
            <label className="flex items-start gap-2 text-sm" htmlFor="share-consent">
              <Checkbox id="share-consent" checked={consent} onCheckedChange={(value) => setConsent(value === true)} />
              <span>Autorizo o contato da Tanto Telecom sobre este pré-cadastro.</span>
            </label>
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
