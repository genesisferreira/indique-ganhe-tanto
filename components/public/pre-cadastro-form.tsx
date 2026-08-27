"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
  formatCNPJ,
  formatCPF,
  formatPhoneBR,
  isValidCEP,
  isValidCNPJ,
  isValidCPF,
  isValidPhoneBR,
  onlyDigits,
} from "@/lib/client/formatters"
import { fetchAddressByCEP } from "@/lib/client/viacep"
import {
  formatCommercialOfferSelectLabel,
  listNeutralNetworkOffers,
  listOffersForModality,
} from "@/lib/commercial-offers/catalog"
import { REFERRAL_CONTRACT_TYPE_OPTIONS } from "@/lib/referral-contract-type"
import type {
  IndicadoPersonType,
  PreferredContactPeriod,
  PreferredInstallationPeriod,
  ReferralContractType,
} from "@/types/referral"
import { CheckCircle2, Loader2 } from "lucide-react"
import { TantoBrand } from "@/components/branding/tanto-brand"

type FormState = "form" | "submitting" | "success"

export type PreCadastroFormVariant = "standard" | "neutral_network"

type PreCadastroFormProps = {
  variant?: PreCadastroFormVariant
}

const INSTALL_PERIOD_OPTIONS: {
  value: PreferredInstallationPeriod
  label: string
}[] = [
  { value: "morning", label: "Manhã" },
  { value: "afternoon", label: "Tarde" },
  { value: "no_preference", label: "Sem preferência" },
]

const CONTACT_PERIOD_OPTIONS: {
  value: Exclude<PreferredContactPeriod, "evening">
  label: string
}[] = [
  { value: "morning", label: "Manhã" },
  { value: "afternoon", label: "Tarde" },
  { value: "no_preference", label: "Sem preferência" },
]

const INVOICE_DUE_DAY_OPTIONS = [5, 10, 15, 20, 25, 30] as const

export function PreCadastroForm({
  variant = "standard",
}: PreCadastroFormProps) {
  const isNeutral = variant === "neutral_network"
  const apiPath = isNeutral
    ? "/api/public/neutral-network-pre-registration"
    : "/api/public/pre-registration"
  const title = isNeutral ? "Pré-cadastro Rede Neutra" : "Pré-cadastro"
  const subtitle = isNeutral
    ? "Preencha seus dados para o atendimento da Rede Neutra."
    : "Estamos quase lá! Preencha seus dados para prosseguirmos com o seu cadastro e agendar a sua instalação."

  const searchParams = useSearchParams()
  const numeroRef = useRef<HTMLInputElement>(null)

  const [formState, setFormState] = useState<FormState>("form")
  const [successMessage, setSuccessMessage] = useState("")

  const [personType, setPersonType] = useState<IndicadoPersonType>("pf")
  const [nome, setNome] = useState("")
  const [tradeName, setTradeName] = useState("")
  const [telefone, setTelefone] = useState("")
  const [email, setEmail] = useState("")
  const [document, setDocument] = useState("")
  const [rg, setRg] = useState("")
  const [birthDate, setBirthDate] = useState("")
  const [observacao, setObservacao] = useState("")
  const [cep, setCep] = useState("")
  const [estado, setEstado] = useState("")
  const [cidade, setCidade] = useState("")
  const [bairro, setBairro] = useState("")
  const [endereco, setEndereco] = useState("")
  const [numero, setNumero] = useState("")
  const [complemento, setComplemento] = useState("")
  const [contractType, setContractType] = useState<ReferralContractType | "">(
    ""
  )
  const [selectedOfferCode, setSelectedOfferCode] = useState("")
  const [periodo, setPeriodo] = useState<PreferredInstallationPeriod | "">("")
  const [periodoContato, setPeriodoContato] = useState<
    PreferredContactPeriod | ""
  >("")
  const [preferredInvoiceDueDay, setPreferredInvoiceDueDay] = useState("")
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

  const offerOptions = useMemo(() => {
    if (isNeutral) return listNeutralNetworkOffers()
    if (!contractType) return []
    return listOffersForModality(contractType, { channel: "pre_registration" })
  }, [isNeutral, contractType])

  useEffect(() => {
    if (!selectedOfferCode) return
    const stillValid = offerOptions.some((o) => o.code === selectedOfferCode)
    if (!stillValid) setSelectedOfferCode("")
  }, [offerOptions, selectedOfferCode])

  const resetForm = () => {
    setPersonType("pf")
    setNome("")
    setTradeName("")
    setTelefone("")
    setEmail("")
    setDocument("")
    setRg("")
    setBirthDate("")
    setObservacao("")
    setCep("")
    setEstado("")
    setCidade("")
    setBairro("")
    setEndereco("")
    setNumero("")
    setComplemento("")
    setContractType("")
    setSelectedOfferCode("")
    setPeriodo("")
    setPeriodoContato("")
    setPreferredInvoiceDueDay("")
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
    if (personType === "pj") {
      if (!nome.trim() || nome.trim().length < 3) return "Informe a razão social."
      if (!isValidCNPJ(document)) return "CNPJ inválido."
      if (!tradeName.trim() || tradeName.trim().length < 2) {
        return "Informe o nome fantasia."
      }
    } else {
      if (!nome.trim() || nome.trim().length < 3) return "Informe o nome completo."
      if (!isValidCPF(document)) return "CPF inválido."
      if (!birthDate) return "Informe a data de nascimento."
      const today = new Date()
      const todayIso = [
        today.getFullYear().toString().padStart(4, "0"),
        (today.getMonth() + 1).toString().padStart(2, "0"),
        today.getDate().toString().padStart(2, "0"),
      ].join("-")
      if (birthDate > todayIso) {
        return "A data de nascimento não pode estar no futuro."
      }
    }
    if (!isValidPhoneBR(telefone)) return "Telefone inválido."
    if (!isValidCEP(cep)) return "CEP inválido."
    if (!estado.trim() || estado.trim().length !== 2) return "Informe o estado."
    if (!cidade.trim()) return "Informe a cidade."
    if (!bairro.trim()) return "Informe o bairro."
    if (!endereco.trim()) return "Informe o endereço."
    if (!numero.trim()) return "Informe o número."
    if (!isNeutral && !contractType) {
      return "Selecione a modalidade (Tanto Livre ou Tanto Vantagens)."
    }
    if (!selectedOfferCode) {
      return "Selecione um plano ou serviço de interesse."
    }
    if (!periodo) return "Selecione o melhor período para instalação."
    if (!preferredInvoiceDueDay) return "Escolha um dia de vencimento."
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
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personType,
          fullName: nome.trim(),
          tradeName: personType === "pj" ? tradeName.trim() : null,
          document,
          phone: telefone,
          email: email.trim() || null,
          rg: personType === "pf" ? rg.trim() || null : null,
          birthDate: personType === "pf" ? birthDate : null,
          cep,
          state: estado.trim().toUpperCase(),
          city: cidade.trim(),
          neighborhood: bairro.trim(),
          street: endereco.trim(),
          number: numero.trim(),
          complement: complemento.trim() || null,
          contractType: isNeutral ? undefined : contractType,
          offerCode: selectedOfferCode,
          preferredInstallationPeriod: periodo,
          preferredContactPeriod: periodoContato || null,
          preferredInvoiceDueDay: Number(preferredInvoiceDueDay),
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
          <TantoBrand variant="symbol" size="md" className="w-10 h-10" priority />
          <div>
            <h1 className="text-xl font-bold">Tanto Telecom</h1>
            <p className="text-sm text-muted-foreground">{title}</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold">
            {isNeutral ? "Pré-cadastro Rede Neutra" : "Faça seu pré-cadastro"}
          </h2>
          <p className="text-muted-foreground mt-2">{subtitle}</p>
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
              <CardTitle className="text-base">
                {personType === "pj" ? "Dados da empresa" : "Dados pessoais"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Tipo de documento *</Label>
                <Select
                  value={personType}
                  onValueChange={(v) => {
                    const next = v as IndicadoPersonType
                    setPersonType(next)
                    setDocument("")
                    setTradeName("")
                    setRg("")
                    setBirthDate("")
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pf">CPF</SelectItem>
                    <SelectItem value="pj">CNPJ</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {personType === "pj" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="cnpj">CNPJ *</Label>
                    <Input
                      id="cnpj"
                      value={document}
                      onChange={(e) => setDocument(formatCNPJ(e.target.value))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="razao">Razão social *</Label>
                    <Input
                      id="razao"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="uppercase"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fantasia">Nome fantasia *</Label>
                    <Input
                      id="fantasia"
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      className="uppercase"
                      required
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="nome">Nome completo *</Label>
                    <Input
                      id="nome"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="uppercase"
                      required
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF *</Label>
                      <Input
                        id="cpf"
                        value={document}
                        onChange={(e) => setDocument(formatCPF(e.target.value))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rg">RG</Label>
                      <Input
                        id="rg"
                        value={rg}
                        onChange={(e) => setRg(e.target.value)}
                        className="uppercase"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="birthDate">Data de nascimento *</Label>
                    <Input
                      id="birthDate"
                      type="date"
                      value={birthDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setBirthDate(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

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
                    <SelectTrigger className="w-full">
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
                    className="uppercase"
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
                  className="uppercase"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endereco">Endereço *</Label>
                <Input
                  id="endereco"
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  className="uppercase"
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
                    className="uppercase"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="complemento">Complemento</Label>
                  <Input
                    id="complemento"
                    value={complemento}
                    onChange={(e) => setComplemento(e.target.value)}
                    className="uppercase"
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
              {!isNeutral ? (
                <div className="space-y-2">
                  <Label>Qual modalidade deseja? *</Label>
                  <Select
                    value={contractType}
                    onValueChange={(v) => {
                      setContractType(v as ReferralContractType)
                      setSelectedOfferCode("")
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {REFERRAL_CONTRACT_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Plano ou serviço de interesse *</Label>
                <Select
                  value={selectedOfferCode}
                  onValueChange={setSelectedOfferCode}
                  disabled={!isNeutral && !contractType}
                >
                  <SelectTrigger className="w-full h-auto min-h-9 py-2">
                    <SelectValue
                      placeholder={
                        !isNeutral && !contractType
                          ? "Selecione a modalidade primeiro"
                          : "Selecione uma opção"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
                    {offerOptions.map((offer) => (
                      <SelectItem
                        key={offer.code}
                        value={offer.code}
                        className="whitespace-normal py-2"
                      >
                        {formatCommercialOfferSelectLabel(offer)}
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
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {INSTALL_PERIOD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Horário preferido para contato</Label>
                <Select
                  value={periodoContato}
                  onValueChange={(v) =>
                    setPeriodoContato(v as PreferredContactPeriod)
                  }
                >
                  <SelectTrigger className="w-full">
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
              </div>

              <div className="space-y-2">
                <Label>Dia preferido de vencimento *</Label>
                <Select
                  value={preferredInvoiceDueDay}
                  onValueChange={setPreferredInvoiceDueDay}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_DUE_DAY_OPTIONS.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        Dia {String(day).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="obs">Observações</Label>
                <Textarea
                  id="obs"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  className="uppercase"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-3">
            <Checkbox
              id="lgpd"
              checked={lgpd}
              onCheckedChange={(v) => setLgpd(v === true)}
            />
            <Label htmlFor="lgpd" className="text-sm font-normal leading-snug">
              Autorizo o uso dos meus dados para contato comercial da Tanto
              Telecom, conforme a política de privacidade. *
            </Label>
          </div>

          {validationError ? (
            <p className="text-sm text-destructive">{validationError}</p>
          ) : null}

          <Button
            type="submit"
            className="w-full"
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
