"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/ui/page-header"
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
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  getReferralContractTypeLabel,
  REFERRAL_CONTRACT_TYPE_OPTIONS,
} from "@/lib/referral-contract-type"
import {
  CONTROLLR_INVOICE_DUE_DAYS,
  isValidControllrInvoiceDueDay,
  validateControllrBirthDate,
} from "@/lib/brbyte/normalize-controllr-text"
import {
  normalizeReferralDocument,
  normalizeReferralPhone,
  normalizeReferralZipcode,
} from "@/lib/referral-field-normalize"
import {
  fetchIndicatorCommercialOffers,
  insertIndicadorReferral,
  type IndicatorCommercialOfferOption,
} from "@/lib/services/supabase-data.service"
import type { ReferralContractType } from "@/types/referral"
import { CheckCircle2, Wallet, Receipt, Info, Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"

export default function NovaIndicacaoPage() {
  const router = useRouter()
  const numeroRef = useRef<HTMLInputElement>(null)
  const [isLoading, setIsLoading] = useState(false)
  const submittingRef = useRef(false)
  const [offers, setOffers] = useState<IndicatorCommercialOfferOption[]>([])
  const [offersLoading, setOffersLoading] = useState(!isDataProviderMock())
  const [selectedOfferCode, setSelectedOfferCode] = useState<string>("")
  const [tipoContratacao, setTipoContratacao] =
    useState<ReferralContractType>("tanto_vantagens")
  const [tipoRecompensa, setTipoRecompensa] = useState<"pix" | "desconto">("pix")
  const [nome, setNome] = useState("")
  const [telefone, setTelefone] = useState("")
  const [email, setEmail] = useState("")
  const [cpf, setCpf] = useState("")
  const [dataNascimento, setDataNascimento] = useState("")
  const [diaVencimento, setDiaVencimento] = useState<string>("")
  const [rg, setRg] = useState("")
  const [observacao, setObservacao] = useState("")
  const [cep, setCep] = useState("")
  const [estado, setEstado] = useState("")
  const [cidade, setCidade] = useState("")
  const [bairro, setBairro] = useState("")
  const [endereco, setEndereco] = useState("")
  const [numero, setNumero] = useState("")
  const [complemento, setComplemento] = useState("")
  const [cepLoading, setCepLoading] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)
  const [installationFeeAwareness, setInstallationFeeAwareness] = useState(false)
  const [contractTypeAwareness, setContractTypeAwareness] = useState(false)
  const [viacepLocked, setViacepLocked] = useState({
    estado: false,
    cidade: false,
  })

  const cepDigits = onlyDigits(cep)

  useEffect(() => {
    if (isDataProviderMock()) {
      setOffersLoading(false)
      return
    }
    void (async () => {
      setOffersLoading(true)
      const remote = await fetchIndicatorCommercialOffers(tipoContratacao)
      setOffersLoading(false)
      if (remote !== null) {
        setOffers(remote)
        setSelectedOfferCode((prev) =>
          remote.some((o) => o.code === prev) ? prev : ""
        )
        if (process.env.NODE_ENV === "development") {
          console.log("[supabase-query:debug]", {
            query: "fetchIndicatorCommercialOffers",
            modality: tipoContratacao,
            count: remote.length,
          })
        }
        return
      }
      if (process.env.NODE_ENV === "development") {
        console.warn("[flow-check:debug]", {
          flow: "nova-indicacao-offers",
          ok: false,
          note: "Supabase retornou erro — lista de ofertas vazia",
        })
      }
    })()
  }, [tipoContratacao])

  useEffect(() => {
    if (cepDigits.length !== 8) {
      setCepError(null)
      setCepLoading(false)
      setViacepLocked({ estado: false, cidade: false })
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        setCepLoading(true)
        setCepError(null)

        const result = await fetchAddressByCEP(cepDigits)
        if (cancelled) return

        setCepLoading(false)

        if (!result.ok) {
          setCepError(result.message)
          return
        }

        const { address } = result
        let shouldFocusNumero = false

        setEstado((prev) => {
          if (!prev.trim() && address.estado) {
            setViacepLocked((lock) => ({ ...lock, estado: true }))
            return address.estado
          }
          return prev
        })

        setCidade((prev) => {
          if (!prev.trim() && address.cidade) {
            setViacepLocked((lock) => ({ ...lock, cidade: true }))
            return address.cidade
          }
          return prev
        })

        setBairro((prev) => (prev.trim() ? prev : address.bairro))
        setEndereco((prev) => {
          if (!prev.trim() && address.endereco) {
            shouldFocusNumero = true
            return address.endereco
          }
          return prev
        })

        if (shouldFocusNumero) {
          requestAnimationFrame(() => numeroRef.current?.focus())
        }
      })()
    }, 450)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cepDigits])

  const offerSelecionada = offers.find((o) => o.code === selectedOfferCode)

  const showResumo = Boolean(offerSelecionada && telefone.trim())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!offerSelecionada) return
    if (submittingRef.current || isLoading) return

    if (!isValidPhoneBR(telefone)) {
      toast.error("Informe um telefone válido com DDD (10 ou 11 dígitos).")
      return
    }

    const normalizedPhone = normalizeReferralPhone(telefone)
    if (!normalizedPhone) {
      toast.error("Informe um telefone válido com DDD.")
      return
    }

    if (!cpf.trim()) {
      toast.error("CPF do indicado é obrigatório.")
      return
    }

    if (!isValidCPF(cpf)) {
      toast.error("CPF inválido. Verifique os números informados.")
      return
    }

    const normalizedCpf = normalizeReferralDocument(cpf)
    if (!normalizedCpf || normalizedCpf.length !== 11) {
      toast.error("CPF deve ter 11 dígitos.")
      return
    }

    const birthValidation = validateControllrBirthDate(dataNascimento)
    if (!birthValidation.ok) {
      if (birthValidation.reason === "missing") {
        toast.error("Informe a data de nascimento.")
      } else if (birthValidation.reason === "future") {
        toast.error("A data de nascimento não pode estar no futuro.")
      } else {
        toast.error("Informe uma data de nascimento válida.")
      }
      return
    }

    const dueDayNumber = Number(diaVencimento)
    if (!isValidControllrInvoiceDueDay(dueDayNumber)) {
      toast.error("Escolha o dia de vencimento: 05, 10, 15, 20, 25 ou 30.")
      return
    }

    if (cep.trim()) {
      if (!isValidCEP(cep)) {
        toast.error("CEP inválido. Informe 8 dígitos.")
        return
      }
    }

    if (endereco.trim() && !numero.trim()) {
      toast.error("Informe o número do endereço.")
      return
    }

    if (!installationFeeAwareness) {
      toast.error(
        "Confirme que o indicado está ciente sobre possíveis taxas de instalação."
      )
      return
    }

    if (!contractTypeAwareness) {
      toast.error(
        "Confirme que explicou a diferença entre Tanto Livre e Tanto Vantagens."
      )
      return
    }

    const normalizedCep = cep.trim() ? normalizeReferralZipcode(cep) : null

    submittingRef.current = true
    setIsLoading(true)
    const rewardTypeDb =
      tipoRecompensa === "pix" ? "pix" : "desconto_fatura"

    try {
      const result = await insertIndicadorReferral({
        referred_name: nome,
        referred_phone: normalizedPhone,
        referred_email: email.trim() || null,
        referred_address: null,
        referred_document: normalizedCpf,
        referred_rg: rg.trim() || null,
        referred_person_type: "pf",
        referred_zipcode: normalizedCep,
        referred_state: estado.trim() || null,
        referred_city: cidade.trim() || null,
        referred_neighborhood: bairro.trim() || null,
        referred_street: endereco.trim() || null,
        referred_number: numero.trim() || null,
        referred_complement: complemento.trim() || null,
        referred_observation: observacao.trim() || null,
        referred_birth_date: birthValidation.value,
        preferred_invoice_due_day: dueDayNumber,
        referral_contract_type: tipoContratacao,
        installation_fee_awareness: true,
        contract_type_awareness: true,
        public_offer_code: offerSelecionada.code,
        reward_type: rewardTypeDb,
      })

      if (!result.ok) {
        toast.error(result.message)
        return
      }

      let friendlyMessage =
        "Indicação cadastrada com sucesso. Nossa equipe dará continuidade ao processamento."

      if (result.referralId) {
        try {
          const createRes = await fetch(
            `/api/indicador/referrals/${encodeURIComponent(result.referralId)}/create-interest`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            }
          )
          const createJson = (await createRes.json().catch(() => null)) as {
            ok?: boolean
            message?: string
            skipped?: boolean
            reason?: string
          } | null

          if (
            createJson?.message &&
            typeof createJson.message === "string" &&
            createJson.message.trim()
          ) {
            friendlyMessage = createJson.message.trim()
          } else if (createRes.ok && createJson?.ok) {
            friendlyMessage =
              "Indicação cadastrada com sucesso. Indicação recebida pela equipe comercial."
          }
        } catch {
          // Cadastro local já foi persistido; falha do ERP não desfaz a indicação.
        }
      }

      toast.success(friendlyMessage)
      router.push("/indicador/indicacoes")
    } finally {
      submittingRef.current = false
      setIsLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Nova Indicação"
        description="Cadastre uma nova indicação e ganhe recompensas"
      />

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <div className="rounded-xl border bg-card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-foreground">
            Dados do Indicado
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome completo *</Label>
              <Input
                id="nome"
                type="text"
                placeholder="Ex.: Maria da Silva"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone com DDD *</Label>
              <Input
                id="telefone"
                type="tel"
                inputMode="numeric"
                placeholder="(31) 99999-9999"
                autoComplete="tel"
                required
                value={telefone}
                onChange={(e) => setTelefone(formatPhoneBR(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cpf">CPF do indicado *</Label>
              <Input
                id="cpf"
                type="text"
                inputMode="numeric"
                placeholder="000.000.000-00"
                required
                value={cpf}
                onChange={(e) => setCpf(formatCPF(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Usado apenas para validação do cadastro.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="data-nascimento">Data de nascimento *</Label>
              <Input
                id="data-nascimento"
                type="date"
                required
                value={dataNascimento}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDataNascimento(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dia-vencimento">
                Dia de vencimento da fatura *
              </Label>
              <Select
                value={diaVencimento}
                onValueChange={setDiaVencimento}
                required
              >
                <SelectTrigger id="dia-vencimento">
                  <SelectValue placeholder="Selecione o dia" />
                </SelectTrigger>
                <SelectContent>
                  {CONTROLLR_INVOICE_DUE_DAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {String(day).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Essa escolha será considerada pela nossa equipe no momento da
                contratação.
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="indicado@email.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Opcional</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-6 mt-6">
          <h2 className="text-lg font-semibold text-foreground">
            Endereço para instalação
          </h2>
          <p className="text-sm text-muted-foreground -mt-2">
            Opcional. O endereço ajuda na análise de viabilidade da fibra.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cep">CEP</Label>
              <div className="relative">
                <Input
                  id="cep"
                  type="text"
                  inputMode="numeric"
                  placeholder="00000-000"
                  autoComplete="postal-code"
                  value={cep}
                  onChange={(e) => {
                    setCep(formatCEP(e.target.value))
                    setCepError(null)
                  }}
                  className={cepLoading ? "pr-9" : undefined}
                />
                {cepLoading ? (
                  <Loader2
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
              </div>
              {cepError ? (
                <p className="text-xs text-destructive">{cepError}</p>
              ) : cepLoading ? (
                <p className="text-xs text-muted-foreground">Buscando endereço…</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="estado">Estado (UF)</Label>
              <Input
                id="estado"
                type="text"
                placeholder="MG"
                maxLength={2}
                autoComplete="address-level1"
                readOnly={viacepLocked.estado}
                value={estado}
                onChange={(e) => setEstado(e.target.value.toUpperCase())}
                className={viacepLocked.estado ? "bg-muted" : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cidade">Cidade</Label>
              <Input
                id="cidade"
                type="text"
                placeholder="Ex.: Belo Horizonte"
                autoComplete="address-level2"
                readOnly={viacepLocked.cidade}
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                className={viacepLocked.cidade ? "bg-muted" : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bairro">Bairro</Label>
              <Input
                id="bairro"
                type="text"
                placeholder="Ex.: Centro"
                value={bairro}
                onChange={(e) => setBairro(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="endereco">Endereço (logradouro)</Label>
              <Input
                id="endereco"
                type="text"
                placeholder="Ex.: Rua das Flores"
                autoComplete="street-address"
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="numero">
                Número{endereco.trim() ? " *" : ""}
              </Label>
              <Input
                ref={numeroRef}
                id="numero"
                type="text"
                placeholder="Ex.: 120"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="complemento">Complemento</Label>
              <Input
                id="complemento"
                type="text"
                placeholder="Ex.: Apto 302, Bloco B"
                value={complemento}
                onChange={(e) => setComplemento(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-6 mt-6">
          <h2 className="text-lg font-semibold text-foreground">
            Dados complementares
          </h2>
          <p className="text-sm text-muted-foreground -mt-2">
            Opcional. RG e observações ajudam o comercial no atendimento.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rg">RG</Label>
              <Input
                id="rg"
                type="text"
                placeholder="Ex.: MG-12.345.678"
                value={rg}
                onChange={(e) => setRg(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="observacao">Observação</Label>
              <Textarea
                id="observacao"
                placeholder="Ex.: Cliente prefere contato após 18h, mora em condomínio..."
                rows={3}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-6 mt-6">
          <h2 className="text-lg font-semibold text-foreground">
            Plano de Interesse
          </h2>
          <p className="text-sm text-muted-foreground -mt-2">
            Escolha o plano que o indicado demonstrou interesse.
          </p>

          <div className="space-y-2">
            <Label htmlFor="plano">Selecione o plano *</Label>
            <Select
              value={selectedOfferCode}
              onValueChange={setSelectedOfferCode}
              required
              disabled={offersLoading || offers.length === 0}
            >
              <SelectTrigger className="w-full min-h-10">
                <SelectValue
                  placeholder={
                    offersLoading
                      ? "Carregando ofertas…"
                      : offers.length === 0
                        ? "Nenhuma oferta disponível"
                        : "Escolha um plano"
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {offers.map((offer) => (
                  <SelectItem
                    key={offer.code}
                    value={offer.code}
                    className="whitespace-normal"
                  >
                    {offer.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label>Tipo de contratação *</Label>
            <RadioGroup
              value={tipoContratacao}
              onValueChange={(v) =>
                setTipoContratacao(v as ReferralContractType)
              }
              className="grid gap-3 sm:grid-cols-2"
            >
              {REFERRAL_CONTRACT_TYPE_OPTIONS.map((option) => (
                <Label
                  key={option.value}
                  htmlFor={`contrato-${option.value}`}
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    tipoContratacao === option.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <RadioGroupItem
                    value={option.value}
                    id={`contrato-${option.value}`}
                  />
                  <span className="font-medium text-foreground">
                    {option.label}
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          {offerSelecionada && (
            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    Sua recompensa será o valor da primeira mensalidade
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Após o indicado pagar a primeira fatura no Controllr, você
                    recebe exatamente o valor baixado nessa fatura. O preço
                    comercial da oferta ({offerSelecionada.displayPrice}) não
                    define a recompensa.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-6 mt-6">
          <h2 className="text-lg font-semibold text-foreground">
            Tipo de Recompensa
          </h2>

          <RadioGroup
            value={tipoRecompensa}
            onValueChange={(v) => setTipoRecompensa(v as "pix" | "desconto")}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Label
              htmlFor="pix"
              className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                tipoRecompensa === "pix"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <RadioGroupItem value="pix" id="pix" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">Via Pix</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Receba o valor diretamente na sua chave Pix cadastrada. Saque
                  mínimo de R$ 100,00.
                </p>
              </div>
            </Label>

            <Label
              htmlFor="desconto"
              className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                tipoRecompensa === "desconto"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <RadioGroupItem value="desconto" id="desconto" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Receipt className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">
                    Desconto na Fatura
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  O valor será creditado como desconto na sua próxima fatura da
                  Tanto Telecom.
                </p>
              </div>
            </Label>
          </RadioGroup>
        </div>

        {showResumo ? (
          <div className="rounded-xl border bg-muted/30 p-5 space-y-3 mt-6">
            <h3 className="text-sm font-semibold text-foreground">Resumo</h3>
            <ul className="text-sm space-y-1.5">
              <li>
                <span className="text-muted-foreground">Plano: </span>
                <span className="text-foreground font-medium">
                  {offerSelecionada?.name}
                </span>
              </li>
              <li>
                <span className="text-muted-foreground">Tipo de contratação: </span>
                <span className="text-foreground font-medium">
                  {getReferralContractTypeLabel(tipoContratacao)}
                </span>
              </li>
              <li>
                <span className="text-muted-foreground">Telefone: </span>
                <span className="text-foreground font-medium">{telefone}</span>
              </li>
              {cidade.trim() || bairro.trim() ? (
                <li>
                  <span className="text-muted-foreground">Local: </span>
                  <span className="text-foreground font-medium">
                    {[cidade.trim(), bairro.trim()].filter(Boolean).join(" — ")}
                  </span>
                </li>
              ) : null}
              <li>
                <span className="text-muted-foreground">Tipo de recompensa: </span>
                <span className="text-foreground font-medium">
                  {tipoRecompensa === "pix" ? "Via Pix" : "Desconto na Fatura"}
                </span>
              </li>
            </ul>
          </div>
        ) : null}

        <div className="rounded-xl border bg-card p-6 space-y-4 mt-6">
          <h2 className="text-lg font-semibold text-foreground">
            Confirmações obrigatórias
          </h2>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="installation-fee-awareness"
                checked={installationFeeAwareness}
                onCheckedChange={(checked) =>
                  setInstallationFeeAwareness(checked === true)
                }
                className="mt-0.5"
              />
              <Label
                htmlFor="installation-fee-awareness"
                className="text-sm font-normal leading-relaxed cursor-pointer"
              >
                Declaro que o indicado está ciente de que podem existir taxas de
                instalação, habilitação, equipamentos ou outros custos conforme
                análise comercial e disponibilidade técnica.
              </Label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="contract-type-awareness"
                checked={contractTypeAwareness}
                onCheckedChange={(checked) =>
                  setContractTypeAwareness(checked === true)
                }
                className="mt-0.5"
              />
              <Label
                htmlFor="contract-type-awareness"
                className="text-sm font-normal leading-relaxed cursor-pointer"
              >
                Declaro que expliquei ao indicado a diferença entre Tanto Livre
                e Tanto Vantagens, conforme o tipo de contratação escolhido.
              </Label>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-8">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading || !selectedOfferCode}>
            {isLoading ? (
              "Cadastrando..."
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Cadastrar Indicação
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
