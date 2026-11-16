"use client"

import { useEffect, useRef, useState } from "react"
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
  const a = crypto.randomUUID().replace(/-/g, "")
  const b = crypto.randomUUID().replace(/-/g, "")
  return (a + b).slice(0, 40)
}

export function PublicPartnerForm({ token }: { token: string }) {
  const keyRef = useRef(newKey())
  const submittingRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [cnpj, setCnpj] = useState<string | null>(null)
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
      const response = await fetch("/api/public/parceiro/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const body = await response.json().catch(() => null)
      if (cancelled) return
      if (!response.ok || !body?.ok) {
        setUnavailable(true)
      } else {
        setDisplayName(String(body.publicDisplayName ?? ""))
        setCnpj(typeof body.cnpj === "string" ? body.cnpj : null)
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
      const response = await fetch("/api/public/parceiro/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          payload: {
            idempotencyKey: keyRef.current,
            planId,
            name,
            phone,
            document,
            zipcode,
            street,
            number,
            complement,
            neighborhood,
            city,
            observation,
            consent,
            confirmRecentDuplicate,
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

  if (loading) {
    return <div className="min-h-screen px-4 py-16 text-center text-muted-foreground">Carregando…</div>
  }
  if (unavailable) {
    return (
      <div className="min-h-screen px-4 py-16">
        <Card className="mx-auto w-full max-w-lg">
          <CardHeader>
            <CardTitle>Link indisponível</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Não foi possível usar este link.</CardContent>
        </Card>
      </div>
    )
  }
  if (protocol) {
    return (
      <div className="min-h-screen px-4 py-10">
        <Card className="mx-auto w-full max-w-lg">
          <CardHeader>
            <CardTitle>Indicação recebida</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Indicação enviada por: {displayName}</p>
            <p>Protocolo: <strong className="tracking-wide">{protocol}</strong></p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <form
        className="mx-auto w-full max-w-lg space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit(false)
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-xl sm:text-2xl">Indique um interessado</CardTitle>
            <p className="text-sm text-muted-foreground">Indicação enviada por: {displayName}</p>
            {cnpj ? <p className="text-xs text-muted-foreground">CNPJ {cnpj}</p> : null}
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Nome completo">
              <Input value={name} onChange={(event) => setName(event.target.value)} required className="w-full" autoComplete="name" />
            </Field>
            <Field label="Telefone / WhatsApp">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} required inputMode="tel" className="w-full" autoComplete="tel" />
            </Field>
            <Field label="Documento (opcional)">
              <Input value={document} onChange={(event) => setDocument(event.target.value)} className="w-full" />
            </Field>
            <Field label="CEP">
              <Input value={zipcode} onChange={(event) => void lookupCep(event.target.value)} required inputMode="numeric" className="w-full" />
            </Field>
            <Field label="Endereço">
              <Input value={street} onChange={(event) => setStreet(event.target.value)} required className="w-full" />
            </Field>
            <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
              <Field label="Número">
                <Input value={number} onChange={(event) => setNumber(event.target.value)} required className="w-full" />
              </Field>
              <Field label="Complemento (opcional)">
                <Input value={complement} onChange={(event) => setComplement(event.target.value)} className="w-full" />
              </Field>
            </div>
            <Field label="Bairro">
              <Input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} required className="w-full" />
            </Field>
            <Field label="Cidade">
              <Input value={city} onChange={(event) => setCity(event.target.value)} required className="w-full" />
            </Field>
            <Field label="Plano de interesse">
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Observação (opcional)">
              <Textarea value={observation} onChange={(event) => setObservation(event.target.value)} className="w-full" />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={consent} onCheckedChange={(value) => setConsent(value === true)} />
              <span>Autorizo o contato da Tanto sobre esta indicação.</span>
            </label>
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            {needsConfirm ? (
              <Button type="button" className="w-full" disabled={submitting} onClick={() => void submit(true)}>
                Confirmar nova indicação
              </Button>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting || !consent || !planId}>
              {submitting ? "Enviando…" : "Enviar indicação"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
