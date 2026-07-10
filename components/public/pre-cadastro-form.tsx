"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  formatCEP,
  formatCPF,
  formatPhoneBR,
  isValidCEP,
  isValidCPF,
  isValidPhoneBR,
  onlyDigits,
} from "@/lib/client/formatters"
import { fetchAddressByCEP } from "@/lib/client/viacep"
import type {
  PreferredInstallationPeriod,
  PreferredContactPeriod,
} from "@/types/referral"
import { CheckCircle2, Loader2, Zap } from "lucide-react"

type PlanOption = { id: string; name: string; speedLabel: string | null }

type FormState = "form" | "submitting" | "success"

const INSTALL_PERIOD_OPTIONS: {
  value: PreferredInstallationPeriod
  label: string
}[] = [
  { value: "morning", label: "Manhã" },
  { value: "afternoon", label: "Tarde" },
  { value: "no_preference", label: "Sem preferência" },
]

const CONTACT_PERIOD_OPTIONS: {
  value: PreferredContactPeriod
  label: string
}[] = [
  { value: "morning", label: "Manhã" },
  { value: "afternoon", label: "Tarde" },
  { value: "evening", label: "Noite" },
  { value: "no_preference", label: "Sem preferência" },
]

export function PreCadastroForm() {
  const searchParams = useSearchParams()
  const numeroRef = useRef<HTMLInputElement>(null)

  const [formState, setFormState] = useState<FormState>("form")
  const [successMessage, setSuccessMessage] = useState("")
  const [planos, setPlanos] = useState<PlanOption[]>([])
  const [plansLoading, setPlansLoading] = useState(true)

  const [nome, setNome] = useState("")
  const [telefone, setTelefone] = useState("")
  const [email, setEmail] = useState("")
  const [cpf, setCpf] = useState("")
  const [rg, setRg] = useState("")
  const [observacao, setObservacao] = useState("")
  const [cep, setCep] = useState("")
  const [estado, setEstado] = useState("")
  const [cidade, setCidade] = useState("")
  const [bairro, setBairro] = useState("")
  const [endereco, setEndereco] = useState("")
  const [numero, setNumero] = useState("")
  const [complemento, setComplemento] = useState("")
  const [selectedPlano, setSelectedPlano] = useState("")
  const [periodo, setPeriodo] = useState<PreferredInstallationPeriod | "">("")
  const [periodoContato, setPeriodoContato] = useState<
    PreferredContactPeriod | ""
  >("")
  const [possuiWhatsapp, setPossuiWhatsapp] = useState<"true" | "false" | "">(
    ""
  )
  const [lgpd, setLgpd] = useState(false)
  const [honeypot, setHoneypot] = useState("")

  const [cepLoading, setCepLoading] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)
  const [viacepLocked, setViacepLocked] = useState({
    estado: false,
    cidade: false,
  })

  const [utm, setUtm] = useState<Record<string, string | null>>({})
  const [validationError, setValidationError] = useState<string | null>(null)

  const resetForm = () => {
    setNome("")
    setTelefone("")
    setEmail("")
    setCpf("")
    setRg("")
    setObservacao("")
    setCep("")
    setEstado("")
    setCidade("")
    setBairro("")
    setEndereco("")
    setNumero("")
    setComplemento("")
    setSelectedPlano("")
    setPeriodo("")
    setPeriodoContato("")
    setPossuiWhatsapp("")
    setLgpd(false)
    setHoneypot("")
    setValidationError(null)
    setViacepLocked({ estado: false, cidade: false })
  }

  useEffect(() => {
    setUtm({
      utm_source: searchParams.get("utm_source"),
      utm_medium: searchParams.get("utm_medium"),
      utm_campaign: searchParams.get("utm_campaign"),
      utm_content: searchParams.get("utm_content"),
      utm_term: searchParams.get("utm_term"),
      gclid: searchParams.get("gclid"),
      fbclid: searchParams.get("fbclid"),
      ref: searchParams.get("ref"),
    })
  }, [searchParams])

  useEffect(() => {
    void (async () => {
      setPlansLoading(true)
      try {
        const res = await fetch("/api/public/pre-registration/plans", {
          cache: "no-store",
        })
        if (!res.ok) {
          setPlanos([])
          return
        }
        const data = (await res.json()) as {
          plans?: PlanOption[]
        }
        setPlanos(data.plans ?? [])
      } finally {
        setPlansLoading(false)
      }
    })()
  }, [])

  const cepDigits = onlyDigits(cep)

  useEffect(() => {
    if (cepDigits.length !== 8) return

    const timer = setTimeout(() => {
      void (async () => {
        setCepLoading(true)
        setCepError(null)
        try {
          const result = await fetchAddressByCEP(cepDigits)
          if (!result.ok) {
            setCepError(result.message)
            return
          }

          const { address } = result

          if (!viacepLocked.estado && address.estado) {
            setEstado(address.estado)
            setViacepLocked((v) => ({ ...v, estado: true }))
          }
          if (!viacepLocked.cidade && address.cidade) {
            setCidade(address.cidade)
            setViacepLocked((v) => ({ ...v, cidade: true }))
          }
          if (address.bairro && !bairro.trim()) {
            setBairro(address.bairro)
          }
          if (address.endereco && !endereco.trim()) {
            setEndereco(address.endereco)
          }
          numeroRef.current?.focus()
        } finally {
          setCepLoading(false)
        }
      })()
    }, 450)

    return () => clearTimeout(timer)
  }, [cepDigits, viacepLocked, bairro, endereco])

  const validateClient = (): string | null => {
    if (!nome.trim() || nome.trim().length < 3) return "Informe o nome completo."
    if (!isValidCPF(cpf)) return "CPF inválido."
    if (!isValidPhoneBR(telefone)) return "Telefone inválido."
    if (!isValidCEP(cep)) return "CEP inválido."
    if (!estado.trim() || estado.trim().length !== 2) return "Informe o estado."
    if (!cidade.trim()) return "Informe a cidade."
    if (!bairro.trim()) return "Informe o bairro."
    if (!endereco.trim()) return "Informe o endereço."
    if (!numero.trim()) return "Informe o número."
    if (!selectedPlano) return "Selecione um plano."
    if (!periodo) return "Selecione o melhor período para instalação."
    if (!possuiWhatsapp) {
      return "Informe se o número possui WhatsApp."
    }
    if (!lgpd) return "Aceite a política de privacidade para continuar."
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return "E-mail inválido."
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setValidationError(null)

    const err = validateClient()
    if (err) {
      setValidationError(err)
      toast.error(err)
      return
    }

    setFormState("submitting")
    try {
      const res = await fetch("/api/public/pre-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: nome.trim(),
          cpf,
          phone: telefone,
          email: email.trim() || null,
          rg: rg.trim() || null,
          cep,
          state: estado.trim().toUpperCase(),
          city: cidade.trim(),
          neighborhood: bairro.trim(),
          street: endereco.trim(),
          number: numero.trim(),
          complement: complemento.trim() || null,
          planId: selectedPlano,
          preferredInstallationPeriod: periodo,
          preferredContactPeriod: periodoContato || null,
          phoneHasWhatsapp: possuiWhatsapp === "true",
          clientObservation: observacao.trim() || null,
          lgpdAccepted: lgpd,
          honeypot,
          ...utm,
        }),
      })

      let data: { ok?: boolean; message?: string } = {}
      try {
        data = (await res.json()) as { ok?: boolean; message?: string }
      } catch {
        data = {}
      }

      if (!res.ok || !data.ok) {
        const message =
          data.message ?? "Não foi possível enviar o pré-cadastro."
        setValidationError(message)
        toast.error(message)
        setFormState("form")
        return
      }

      const message =
        data.message ??
        "Pré-cadastro recebido com sucesso! Nossa equipe entrará em contato em breve."

      toast.success(message)
      resetForm()
      setSuccessMessage(message)
      setFormState("success")
    } catch {
      const message = "Erro de conexão. Tente novamente em instantes."
      setValidationError(message)
      toast.error(message)
      setFormState("form")
    }
  }

  if (formState === "success") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-lg text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
            <h1 className="text-xl font-semibold">Obrigado!</h1>
            <p className="text-muted-foreground">{successMessage}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary">
            <Zap className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Tanto Telecom</h1>
            <p className="text-sm text-muted-foreground">Pré-cadastro</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold">Faça seu pré-cadastro</h2>
          <p className="text-muted-foreground mt-2">
            Preencha seus dados para que nossa equipe verifique a disponibilidade
            e entre em contato.
          </p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          className="space-y-6"
        >
          <input
            type="text"
            name="website"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            className="hidden"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados pessoais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome completo *</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cpf">CPF *</Label>
                  <Input
                    id="cpf"
                    value={cpf}
                    onChange={(e) => setCpf(formatCPF(e.target.value))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rg">RG</Label>
                  <Input id="rg" value={rg} onChange={(e) => setRg(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="telefone">Telefone / WhatsApp *</Label>
                  <Input
                    id="telefone"
                    value={telefone}
                    onChange={(e) => setTelefone(formatPhoneBR(e.target.value))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Este número possui WhatsApp? *</Label>
                  <Select
                    value={possuiWhatsapp}
                    onValueChange={(v) =>
                      setPossuiWhatsapp(v as "true" | "false")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Sim</SelectItem>
                      <SelectItem value="false">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Endereço de instalação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cep">CEP *</Label>
                <div className="relative">
                  <Input
                    id="cep"
                    value={cep}
                    onChange={(e) => setCep(formatCEP(e.target.value))}
                    required
                  />
                  {cepLoading ? (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
                {cepError ? (
                  <p className="text-sm text-destructive">{cepError}</p>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="estado">Estado *</Label>
                  <Input
                    id="estado"
                    value={estado}
                    readOnly={viacepLocked.estado}
                    onChange={(e) => setEstado(e.target.value.toUpperCase())}
                    maxLength={2}
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="cidade">Cidade *</Label>
                  <Input
                    id="cidade"
                    value={cidade}
                    readOnly={viacepLocked.cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bairro">Bairro *</Label>
                <Input
                  id="bairro"
                  value={bairro}
                  onChange={(e) => setBairro(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endereco">Endereço *</Label>
                <Input
                  id="endereco"
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="numero">Número *</Label>
                  <Input
                    id="numero"
                    ref={numeroRef}
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="complemento">Complemento</Label>
                  <Input
                    id="complemento"
                    value={complemento}
                    onChange={(e) => setComplemento(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plano e preferências</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Plano *</Label>
                <Select
                  value={selectedPlano}
                  onValueChange={setSelectedPlano}
                  disabled={plansLoading || planos.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        plansLoading
                          ? "Carregando planos…"
                          : planos.length === 0
                            ? "Planos indisponíveis"
                            : "Selecione o plano"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {planos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Melhor período para instalação *</Label>
                <Select
                  value={periodo}
                  onValueChange={(v) =>
                    setPeriodo(v as PreferredInstallationPeriod)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o período" />
                  </SelectTrigger>
                  <SelectContent>
                    {INSTALL_PERIOD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Essa preferência não confirma o agendamento. Nossa equipe
                  entrará em contato para combinar a instalação.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Melhor horário para contato</Label>
                <Select
                  value={periodoContato}
                  onValueChange={(v) =>
                    setPeriodoContato(v as PreferredContactPeriod)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_PERIOD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Este horário é apenas uma preferência para contato da nossa
                  equipe.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="observacao">Observação do cliente</Label>
                <Textarea
                  id="observacao"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-3 rounded-lg border border-border p-4">
            <Checkbox
              id="lgpd"
              checked={lgpd}
              onCheckedChange={(v) => setLgpd(v === true)}
            />
            <Label htmlFor="lgpd" className="text-sm leading-relaxed font-normal">
              Li e concordo com o tratamento dos meus dados conforme a política de
              privacidade (LGPD). *
            </Label>
          </div>

          {validationError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {validationError}
            </div>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={formState === "submitting"}
          >
            {formState === "submitting" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando…
              </>
            ) : (
              "Enviar pré-cadastro"
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
