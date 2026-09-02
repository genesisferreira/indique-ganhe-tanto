"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { PageHeader } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
  CONTROLLR_INVOICE_DUE_DAYS,
  isValidControllrInvoiceDueDay,
  validateControllrBirthDate,
} from "@/lib/brbyte/normalize-controllr-text"
import {
  COMMERCIAL_ASSISTED_CADASTRO_URL,
  COMMERCIAL_INDICATOR_SEARCH_MIN_QUERY_LENGTH,
} from "@/lib/commercial-assisted/constants"
import { maskDocumentForDisplay } from "@/lib/commercial-assisted/mask"
import {
  formatCommercialOfferSelectLabel,
  listOffersForModality,
  type CommercialOfferModality,
} from "@/lib/commercial-offers/catalog"
import {
  getReferralContractTypeLabel,
  REFERRAL_CONTRACT_TYPE_OPTIONS,
} from "@/lib/referral-contract-type"
import type { IndicadoPersonType, ReferralContractType } from "@/types/referral"
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  Search,
  UserRound,
} from "lucide-react"

type Step = 1 | 2 | 3 | 4 | "success"

type SearchResult = {
  id: string
  full_name: string
  phone_masked: string | null
  email_masked: string | null
  document_masked: string | null
  is_active: boolean
}

type SuccessState = {
  referralId: string
  indicatorName: string
  referredName: string
  responsibleName: string
  leadUrl: string
  controllrMessage?: string
}

export default function ComercialNovaIndicacaoPage() {
  const [step, setStep] = useState<Step>(1)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)

  const [personType, setPersonType] = useState<IndicadoPersonType>("pf")
  const [nome, setNome] = useState("")
  const [tradeName, setTradeName] = useState("")
  const [document, setDocument] = useState("")
  const [rg, setRg] = useState("")
  const [birthDate, setBirthDate] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [cep, setCep] = useState("")
  const [estado, setEstado] = useState("")
  const [cidade, setCidade] = useState("")
  const [bairro, setBairro] = useState("")
  const [endereco, setEndereco] = useState("")
  const [numero, setNumero] = useState("")
  const [complemento, setComplemento] = useState("")
  const [observacao, setObservacao] = useState("")
  const [dueDay, setDueDay] = useState("")
  const [cepLoading, setCepLoading] = useState(false)
  const [viacepLocked, setViacepLocked] = useState({ estado: false, cidade: false })

  const [modality, setModality] =
    useState<ReferralContractType>("tanto_vantagens")
  const [offerCode, setOfferCode] = useState("")
  const [rewardType, setRewardType] = useState<"pix" | "desconto_fatura">("pix")
  const [installationFeeAwareness, setInstallationFeeAwareness] = useState(false)
  const [contractTypeAwareness, setContractTypeAwareness] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState("")
  const [success, setSuccess] = useState<SuccessState | null>(null)
  const submittingRef = useRef(false)
  const numeroRef = useRef<HTMLInputElement>(null)

  const offers = useMemo(
    () =>
      listOffersForModality(modality as CommercialOfferModality, {
        channel: "indicator",
      }),
    [modality]
  )

  const selectedOffer = offers.find((o) => o.code === offerCode) ?? null

  useEffect(() => {
    setOfferCode("")
  }, [modality])

  const cepDigits = onlyDigits(cep)
  useEffect(() => {
    if (cepDigits.length !== 8) return
    let cancelled = false
    void (async () => {
      setCepLoading(true)
      const result = await fetchAddressByCEP(cepDigits)
      setCepLoading(false)
      if (cancelled || !result.ok) return
      const { address: addr } = result
      setEstado(addr.estado)
      setCidade(addr.cidade)
      setBairro(addr.bairro)
      setEndereco(addr.endereco)
      setViacepLocked({
        estado: Boolean(addr.estado),
        cidade: Boolean(addr.cidade),
      })
      numeroRef.current?.focus()
    })()
    return () => {
      cancelled = true
    }
  }, [cepDigits])

  async function handleSearch() {
    const q = query.trim()
    if (q.length < COMMERCIAL_INDICATOR_SEARCH_MIN_QUERY_LENGTH) {
      setSearchError("Informe ao menos 3 caracteres para buscar.")
      return
    }
    setSearching(true)
    setSearchError("")
    setSearched(true)
    try {
      const res = await fetch(
        `/api/comercial/indicators/search?q=${encodeURIComponent(q)}`
      )
      const json = (await res.json()) as {
        ok?: boolean
        message?: string
        results?: SearchResult[]
      }
      if (!res.ok || !json.ok) {
        setResults([])
        setSearchError(json.message || "Não foi possível buscar indicadores.")
        return
      }
      setResults(json.results ?? [])
    } catch {
      setResults([])
      setSearchError("Erro temporário na busca. Tente novamente.")
    } finally {
      setSearching(false)
    }
  }

  function validateStep2(): string | null {
    if (!nome.trim()) {
      return personType === "pj"
        ? "Informe a razão social."
        : "Informe o nome completo."
    }
    if (personType === "pj" && !tradeName.trim()) {
      return "Informe o nome fantasia."
    }
    if (personType === "pf") {
      if (!isValidCPF(document)) return "Informe um CPF válido."
      const birth = validateControllrBirthDate(birthDate)
      if (!birth.ok) return "Informe uma data de nascimento válida."
    } else if (!isValidCNPJ(document)) {
      return "Informe um CNPJ válido."
    }
    if (!isValidPhoneBR(phone)) return "Informe um telefone válido com DDD."
    if (!isValidControllrInvoiceDueDay(Number(dueDay))) {
      return "Escolha o dia de vencimento."
    }
    if (cepDigits && !isValidCEP(cep)) return "CEP inválido."
    if (endereco.trim() && !numero.trim()) {
      return "Informe o número do endereço."
    }
    return null
  }

  function validateStep3(): string | null {
    if (!offerCode) return "Selecione um plano."
    if (!installationFeeAwareness) {
      return "Confirme a ciência sobre taxas de instalação."
    }
    if (!contractTypeAwareness) {
      return "Confirme que explicou a diferença entre as modalidades."
    }
    return null
  }

  async function handleConfirm() {
    if (!selected || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setFormError("")
    try {
      const res = await fetch("/api/comercial/assisted-referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indicator_profile_id: selected.id,
          referred_person_type: personType,
          referred_name: nome,
          referred_company_trade_name: personType === "pj" ? tradeName : null,
          referred_document: document,
          referred_rg: rg || null,
          referred_birth_date: birthDate || null,
          referred_phone: phone,
          referred_email: email || null,
          referred_zipcode: cep || null,
          referred_state: estado || null,
          referred_city: cidade || null,
          referred_neighborhood: bairro || null,
          referred_street: endereco || null,
          referred_number: numero || null,
          referred_complement: complemento || null,
          referred_observation: observacao || null,
          preferred_invoice_due_day: Number(dueDay),
          referral_contract_type: modality,
          public_offer_code: offerCode,
          reward_type: rewardType,
          installation_fee_awareness: installationFeeAwareness,
          contract_type_awareness: contractTypeAwareness,
        }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        message?: string
        referralId?: string
        indicatorName?: string
        referredName?: string
        responsibleName?: string
        leadUrl?: string
        controllr?: { ok?: boolean; message?: string; skipped?: boolean }
      }
      if (!res.ok || !json.ok || !json.referralId) {
        setFormError(json.message || "Não foi possível criar a indicação.")
        return
      }
      setSuccess({
        referralId: json.referralId,
        indicatorName: json.indicatorName || selected.full_name,
        referredName: json.referredName || nome,
        responsibleName: json.responsibleName || "Comercial",
        leadUrl: json.leadUrl || `/comercial/leads/${json.referralId}`,
        controllrMessage:
          json.controllr && !json.controllr.ok
            ? json.controllr.message ||
              "Indicação salva. Integração Controllr pendente."
            : undefined,
      })
      setStep("success")
      toast.success("Indicação cadastrada com sucesso.")
    } catch {
      setFormError("Erro temporário. Tente novamente.")
    } finally {
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  async function copyCadastroLink() {
    try {
      await navigator.clipboard.writeText(COMMERCIAL_ASSISTED_CADASTRO_URL)
      toast.success("Link de cadastro copiado.")
    } catch {
      toast.error("Não foi possível copiar o link.")
    }
  }

  function resetForNew() {
    setStep(1)
    setSelected(null)
    setResults([])
    setQuery("")
    setSearched(false)
    setSuccess(null)
    setFormError("")
    setNome("")
    setTradeName("")
    setDocument("")
    setBirthDate("")
    setPhone("")
    setEmail("")
    setOfferCode("")
    setInstallationFeeAwareness(false)
    setContractTypeAwareness(false)
  }

  if (step === "success" && success) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Indicação cadastrada"
          description="Cadastro assistido concluído com sucesso."
        />
        <div className="rounded-xl border border-border bg-card p-6 space-y-4 max-w-xl">
          <div className="flex items-center gap-3 text-primary">
            <CheckCircle2 className="h-6 w-6" />
            <p className="font-semibold">Indicação cadastrada com sucesso.</p>
          </div>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Indicador</dt>
              <dd className="font-medium">{success.indicatorName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Indicado</dt>
              <dd className="font-medium">{success.referredName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Responsável</dt>
              <dd className="font-medium">{success.responsibleName}</dd>
            </div>
          </dl>
          {success.controllrMessage ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {success.controllrMessage}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <Link href={success.leadUrl}>Ver lead</Link>
            </Button>
            <Button variant="outline" onClick={resetForNew}>
              Nova indicação
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nova indicação"
        description="Cadastre uma indicação em nome de um indicador já registrado."
      />

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className={step === 1 ? "text-foreground font-medium" : ""}>
          1. Indicador
        </span>
        <span>→</span>
        <span className={step === 2 ? "text-foreground font-medium" : ""}>
          2. Indicado
        </span>
        <span>→</span>
        <span className={step === 3 ? "text-foreground font-medium" : ""}>
          3. Oferta
        </span>
        <span>→</span>
        <span className={step === 4 ? "text-foreground font-medium" : ""}>
          4. Revisão
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-4 max-w-2xl">
          {selected ? (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Indicador selecionado
              </p>
              <div className="flex items-start gap-3">
                <UserRound className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">{selected.full_name}</p>
                  <p className="text-muted-foreground">
                    {selected.phone_masked ?? "Telefone não informado"}
                  </p>
                  <p className="text-muted-foreground">
                    {selected.email_masked ?? "E-mail não informado"}
                  </p>
                  {selected.document_masked ? (
                    <p className="text-muted-foreground">
                      Doc: {selected.document_masked}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelected(null)
                    setStep(1)
                  }}
                >
                  Trocar indicador
                </Button>
                <Button onClick={() => setStep(2)}>Continuar</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="buscar-indicador">Buscar indicador</Label>
                <div className="flex gap-2">
                  <Input
                    id="buscar-indicador"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nome, telefone, e-mail ou CPF"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void handleSearch()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSearch()}
                    disabled={searching}
                  >
                    {searching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Mínimo de {COMMERCIAL_INDICATOR_SEARCH_MIN_QUERY_LENGTH}{" "}
                  caracteres. Resultados limitados e mascarados.
                </p>
              </div>

              {searchError ? (
                <p className="text-sm text-destructive" role="alert">
                  {searchError}
                </p>
              ) : null}

              {searched && !searching && results.length === 0 && !searchError ? (
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm text-foreground font-medium">
                    Indicador não encontrado.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Para que o cliente receba a recompensa, ele precisa possuir
                    uma conta ativa no Indique e Ganhe.
                  </p>
                  <Button type="button" variant="outline" onClick={copyCadastroLink}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar link de cadastro
                  </Button>
                </div>
              ) : null}

              <div className="space-y-2">
                {results.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-3"
                  >
                    <div className="text-sm space-y-0.5">
                      <p className="font-medium">{item.full_name}</p>
                      <p className="text-muted-foreground">
                        {item.phone_masked ?? "—"} · {item.email_masked ?? "—"}
                      </p>
                      {item.document_masked ? (
                        <p className="text-muted-foreground">
                          {item.document_masked}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelected(item)
                        setFormError("")
                      }}
                    >
                      Selecionar
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === 2 && selected && (
        <div className="space-y-4 max-w-2xl">
          <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>

          <div className="space-y-2">
            <Label>Tipo de pessoa</Label>
            <RadioGroup
              value={personType}
              onValueChange={(v) => setPersonType(v as IndicadoPersonType)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pf" id="pf" />
                <Label htmlFor="pf">Pessoa física</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pj" id="pj" />
                <Label htmlFor="pj">Pessoa jurídica</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>{personType === "pj" ? "Razão social" : "Nome completo"}</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            {personType === "pj" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label>Nome fantasia</Label>
                <Input
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>{personType === "pj" ? "CNPJ" : "CPF"}</Label>
              <Input
                value={document}
                onChange={(e) =>
                  setDocument(
                    personType === "pj"
                      ? formatCNPJ(e.target.value)
                      : formatCPF(e.target.value)
                  )
                }
              />
            </div>
            {personType === "pf" ? (
              <>
                <div className="space-y-2">
                  <Label>RG (opcional)</Label>
                  <Input value={rg} onChange={(e) => setRg(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data de nascimento</Label>
                  <Input
                    type="date"
                    value={birthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setBirthDate(e.target.value)}
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>E-mail (opcional)</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Dia de vencimento</Label>
              <Select value={dueDay} onValueChange={setDueDay}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {CONTROLLR_INVOICE_DUE_DAYS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      Dia {String(d).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>CEP</Label>
              <Input
                value={cep}
                onChange={(e) => setCep(formatCEP(e.target.value))}
              />
              {cepLoading ? (
                <p className="text-xs text-muted-foreground">Buscando CEP…</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>UF</Label>
              <Input
                value={estado}
                disabled={viacepLocked.estado}
                onChange={(e) => setEstado(e.target.value.toUpperCase())}
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Cidade</Label>
              <Input
                value={cidade}
                disabled={viacepLocked.cidade}
                onChange={(e) => setCidade(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Bairro</Label>
              <Input value={bairro} onChange={(e) => setBairro(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Logradouro</Label>
              <Input
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Número</Label>
              <Input
                ref={numeroRef}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Complemento</Label>
              <Input
                value={complemento}
                onChange={(e) => setComplemento(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Observação</Label>
              <Textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>
          </div>

          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <Button
            onClick={() => {
              const err = validateStep2()
              if (err) {
                setFormError(err)
                return
              }
              setFormError("")
              setStep(3)
            }}
          >
            Continuar
          </Button>
        </div>
      )}

      {step === 3 && selected && (
        <div className="space-y-4 max-w-xl">
          <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>

          <div className="space-y-2">
            <Label>Modalidade</Label>
            <Select
              value={modality}
              onValueChange={(v) => setModality(v as ReferralContractType)}
            >
              <SelectTrigger>
                <SelectValue />
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

          <div className="space-y-2">
            <Label>Plano</Label>
            <Select value={offerCode} onValueChange={setOfferCode}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o plano" />
              </SelectTrigger>
              <SelectContent>
                {offers.map((offer) => (
                  <SelectItem key={offer.code} value={offer.code}>
                    {formatCommercialOfferSelectLabel(offer)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOffer ? (
              <p className="text-xs text-muted-foreground">
                Preço público informativo: R${" "}
                {selectedOffer.price.toFixed(2).replace(".", ",")}. A recompensa
                segue as regras do programa (1ª fatura), não este preço.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Tipo de recompensa do indicador</Label>
            <RadioGroup
              value={rewardType}
              onValueChange={(v) =>
                setRewardType(v as "pix" | "desconto_fatura")
              }
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pix" id="reward-pix" />
                <Label htmlFor="reward-pix">Pix</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="desconto_fatura" id="reward-desc" />
                <Label htmlFor="reward-desc">Desconto em fatura</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="ack-fee"
                checked={installationFeeAwareness}
                onCheckedChange={(v) => setInstallationFeeAwareness(v === true)}
              />
              <Label htmlFor="ack-fee" className="text-sm font-normal leading-snug">
                Confirmo que o indicado está ciente sobre possíveis taxas de
                instalação.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ack-contract"
                checked={contractTypeAwareness}
                onCheckedChange={(v) => setContractTypeAwareness(v === true)}
              />
              <Label
                htmlFor="ack-contract"
                className="text-sm font-normal leading-snug"
              >
                Confirmo que expliquei a diferença entre Tanto Livre e Tanto
                Vantagens.
              </Label>
            </div>
          </div>

          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <Button
            onClick={() => {
              const err = validateStep3()
              if (err) {
                setFormError(err)
                return
              }
              setFormError("")
              setStep(4)
            }}
          >
            Revisar
          </Button>
        </div>
      )}

      {step === 4 && selected && (
        <div className="space-y-4 max-w-xl">
          <Button variant="ghost" size="sm" onClick={() => setStep(3)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4 text-sm">
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Indicador
              </h3>
              <p className="font-medium">{selected.full_name}</p>
            </section>
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Cadastrado por / Responsável pelo atendimento
              </h3>
              <p className="font-medium">Você — Comercial</p>
            </section>
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Indicado
              </h3>
              <p className="font-medium">{nome}</p>
              {personType === "pj" && tradeName ? (
                <p className="text-muted-foreground">Fantasia: {tradeName}</p>
              ) : null}
              <p className="text-muted-foreground">
                {maskDocumentForDisplay(document, personType) ?? "—"}
              </p>
              <p className="text-muted-foreground">{phone}</p>
              {(endereco || cidade) && (
                <p className="text-muted-foreground">
                  {[endereco, numero, bairro, cidade, estado]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
            </section>
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Contratação
              </h3>
              <p className="font-medium">
                {getReferralContractTypeLabel(modality)}
              </p>
              <p className="text-muted-foreground">
                {selectedOffer
                  ? formatCommercialOfferSelectLabel(selectedOffer)
                  : offerCode}
              </p>
              {selectedOffer ? (
                <p className="text-muted-foreground">
                  Preço público: R${" "}
                  {selectedOffer.price.toFixed(2).replace(".", ",")}
                </p>
              ) : null}
            </section>
            <p className="text-xs text-muted-foreground border-t border-border pt-3">
              A recompensa, quando elegível, será destinada ao indicador
              selecionado e seguirá as regras do programa Indique e Ganhe.
            </p>
          </div>

          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <Button onClick={() => void handleConfirm()} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Confirmando…
              </>
            ) : (
              "Confirmar indicação"
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
