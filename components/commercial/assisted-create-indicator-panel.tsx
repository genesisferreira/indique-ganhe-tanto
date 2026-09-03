"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  formatCPF,
  formatPhoneBR,
} from "@/lib/client/formatters"
import {
  ASSISTED_INDICATOR_PIX_TYPE_OPTIONS,
  buildAssistedIndicatorAccessClipboardText,
  canContinueAfterAssistedIndicatorCreate,
  mapAssistedIndicatorCreateApiError,
  shouldWarnBeforeLeavingAssistedIndicatorSuccess,
  toSearchResultFromCreatedIndicator,
  validateAssistedCreateIndicatorForm,
  type AssistedCreateIndicatorFieldErrors,
  type AssistedIndicatorCreateSuccessView,
} from "@/lib/commercial-assisted/create-indicator-ui"
import { ArrowLeft, CheckCircle2, Copy, Eye, EyeOff, Loader2, UserPlus } from "lucide-react"

export type CreatedIndicatorSelection = {
  id: string
  full_name: string
  phone_masked: string | null
  email_masked: string | null
  document_masked: string | null
  is_active: boolean
}

type Props = {
  onBackToSearch: () => void
  onContinueWithIndicator: (indicator: CreatedIndicatorSelection) => void
}

export function AssistedCreateIndicatorPanel({
  onBackToSearch,
  onContinueWithIndicator,
}: Props) {
  const [fullName, setFullName] = useState("")
  const [cpf, setCpf] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [pixKeyType, setPixKeyType] = useState("")
  const [pixKeyValue, setPixKeyValue] = useState("")
  const [fieldErrors, setFieldErrors] =
    useState<AssistedCreateIndicatorFieldErrors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const idempotencyKeyRef = useRef<string | null>(null)

  const [created, setCreated] =
    useState<AssistedIndicatorCreateSuccessView | null>(null)
  const [accessDeliveredConfirmed, setAccessDeliveredConfirmed] =
    useState(false)
  const [showTempPassword, setShowTempPassword] = useState(true)
  const [leaveWarning, setLeaveWarning] = useState("")

  function ensureIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID()
    }
    return idempotencyKeyRef.current
  }

  function tryLeaveToSearch() {
    if (
      created &&
      shouldWarnBeforeLeavingAssistedIndicatorSuccess({
        created: true,
        accessDeliveredConfirmed,
        temporaryPassword: created.temporaryPassword,
      })
    ) {
      setLeaveWarning(
        "Os dados de acesso temporários não poderão ser exibidos novamente. Confirme que foram copiados antes de continuar."
      )
      return
    }
    // limpa senha da memória ao sair
    setCreated(null)
    idempotencyKeyRef.current = null
    onBackToSearch()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return

    const validation = validateAssistedCreateIndicatorForm({
      fullName,
      cpf,
      phone,
      email,
      pixKeyType,
      pixKeyValue,
    })
    if (!validation.ok) {
      setFieldErrors(validation.errors)
      setFormError("Revise os campos destacados.")
      return
    }
    setFieldErrors({})
    setFormError("")
    submittingRef.current = true
    setSubmitting(true)

    const idempotencyKey = ensureIdempotencyKey()
    try {
      const res = await fetch("/api/comercial/assisted-indicators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          fullName: fullName.trim(),
          cpf,
          phone,
          email: email.trim().toLowerCase(),
          pixKeyType,
          pixKeyValue,
        }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        message?: string
        replayed?: boolean
        temporaryPassword?: string | null
        passwordAlreadyIssued?: boolean
        login?: string
        indicator?: {
          id: string
          fullName: string
          email: string
          phoneMasked: string | null
          documentMasked: string | null
        }
      }

      if (!res.ok || !json.ok || !json.indicator) {
        const mapped = mapAssistedIndicatorCreateApiError(res.status, json.message)
        setFormError(mapped.message)
        return
      }

      setCreated({
        id: json.indicator.id,
        fullName: json.indicator.fullName,
        email: json.login || json.indicator.email,
        phoneMasked: json.indicator.phoneMasked,
        documentMasked: json.indicator.documentMasked,
        temporaryPassword: json.temporaryPassword ?? null,
        replayed: json.replayed === true,
        passwordAlreadyIssued: json.passwordAlreadyIssued === true,
      })
      setAccessDeliveredConfirmed(json.replayed === true)
      setLeaveWarning("")
      toast.success(
        json.replayed
          ? "Indicador já criado nesta tentativa."
          : "Indicador criado com sucesso."
      )
    } catch {
      setFormError("Erro temporário. Tente novamente.")
    } finally {
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  async function handleCopyAccess() {
    if (!created?.temporaryPassword) return
    const text = buildAssistedIndicatorAccessClipboardText({
      email: created.email,
      temporaryPassword: created.temporaryPassword,
    })
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Dados de acesso copiados.")
      setAccessDeliveredConfirmed(true)
      setLeaveWarning("")
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.")
    }
  }

  function handleContinue() {
    if (!created) return
    if (
      !canContinueAfterAssistedIndicatorCreate({
        accessDeliveredConfirmed,
        replayed: created.replayed,
        hasTemporaryPassword: Boolean(created.temporaryPassword),
      })
    ) {
      setLeaveWarning(
        "Confirme que copiou ou entregou os dados de acesso ao indicador."
      )
      return
    }

    const selection = toSearchResultFromCreatedIndicator({
      id: created.id,
      fullName: created.fullName,
      email: created.email,
      phoneMasked: created.phoneMasked,
      documentMasked: created.documentMasked,
    })

    // Limpa senha da memória antes de avançar.
    setCreated(null)
    idempotencyKeyRef.current = null
    onContinueWithIndicator(selection)
  }

  if (created) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-4 max-w-2xl">
        <div className="flex items-center gap-3 text-primary">
          <CheckCircle2 className="h-6 w-6 shrink-0" />
          <h2 className="font-semibold text-foreground text-lg">
            Indicador criado com sucesso
          </h2>
        </div>

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Nome</dt>
            <dd className="font-medium text-foreground">{created.fullName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Login</dt>
            <dd className="font-medium text-foreground break-all">
              {created.email}
            </dd>
          </div>
          {created.temporaryPassword ? (
            <div>
              <dt className="text-muted-foreground">Senha temporária</dt>
              <dd className="font-medium text-foreground flex items-center gap-2">
                <span className="font-mono tracking-wide">
                  {showTempPassword
                    ? created.temporaryPassword
                    : "••••••••••••••••"}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={
                    showTempPassword ? "Ocultar senha" : "Mostrar senha"
                  }
                  onClick={() => setShowTempPassword((v) => !v)}
                >
                  {showTempPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </dd>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-1">
              <p className="font-medium">
                Este indicador já foi criado nesta tentativa.
              </p>
              <p>
                A senha temporária já foi emitida e não pode ser exibida
                novamente.
              </p>
              <p className="text-xs opacity-90">
                Se o cliente não recebeu a senha, será necessário redefinir o
                acesso posteriormente.
              </p>
            </div>
          )}
        </dl>

        {created.temporaryPassword ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Esta senha é temporária.</p>
            <p>
              No primeiro acesso, o indicador deverá criar uma nova senha.
            </p>
            <p>
              Por segurança, esta senha será exibida somente agora. Depois de
              sair desta etapa, ela não poderá ser recuperada.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          {created.temporaryPassword ? (
            <Button type="button" variant="outline" onClick={() => void handleCopyAccess()}>
              <Copy className="h-4 w-4 mr-2" />
              Copiar login e senha
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={tryLeaveToSearch}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar para busca
          </Button>
        </div>

        {created.temporaryPassword ? (
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <Checkbox
              checked={accessDeliveredConfirmed}
              onCheckedChange={(v) => {
                setAccessDeliveredConfirmed(v === true)
                if (v === true) setLeaveWarning("")
              }}
              aria-required
            />
            <span>
              Confirmei que copiei ou entreguei os dados de acesso ao indicador.
            </span>
          </label>
        ) : null}

        {leaveWarning ? (
          <p className="text-sm text-destructive" role="alert">
            {leaveWarning}
          </p>
        ) : null}

        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={
            !canContinueAfterAssistedIndicatorCreate({
              accessDeliveredConfirmed,
              replayed: created.replayed,
              hasTemporaryPassword: Boolean(created.temporaryPassword),
            })
          }
          onClick={handleContinue}
        >
          {created.replayed && !created.temporaryPassword
            ? "Continuar com este indicador"
            : "Continuar para indicação"}
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-5 max-w-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Cadastrar novo indicador
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            A senha temporária será gerada automaticamente pelo sistema.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={tryLeaveToSearch}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Busca
        </Button>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Dados do indicador
        </legend>
        <div className="space-y-2">
          <Label htmlFor="new-ind-name">Nome completo *</Label>
          <Input
            id="new-ind-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            aria-invalid={Boolean(fieldErrors.fullName)}
          />
          {fieldErrors.fullName ? (
            <p className="text-xs text-destructive" role="alert">
              {fieldErrors.fullName}
            </p>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="new-ind-cpf">CPF *</Label>
            <Input
              id="new-ind-cpf"
              value={cpf}
              onChange={(e) => setCpf(formatCPF(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={Boolean(fieldErrors.cpf)}
            />
            {fieldErrors.cpf ? (
              <p className="text-xs text-destructive" role="alert">
                {fieldErrors.cpf}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-ind-phone">Telefone *</Label>
            <Input
              id="new-ind-phone"
              value={phone}
              onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(fieldErrors.phone)}
            />
            {fieldErrors.phone ? (
              <p className="text-xs text-destructive" role="alert">
                {fieldErrors.phone}
              </p>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-ind-email">E-mail *</Label>
          <Input
            id="new-ind-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email ? (
            <p className="text-xs text-destructive" role="alert">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Chave Pix
        </legend>
        <div className="space-y-2">
          <Label htmlFor="new-ind-pix-type">Tipo *</Label>
          <Select value={pixKeyType} onValueChange={setPixKeyType}>
            <SelectTrigger id="new-ind-pix-type" aria-invalid={Boolean(fieldErrors.pixKeyType)}>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {ASSISTED_INDICATOR_PIX_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.pixKeyType ? (
            <p className="text-xs text-destructive" role="alert">
              {fieldErrors.pixKeyType}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-ind-pix-value">Chave Pix *</Label>
          <Input
            id="new-ind-pix-value"
            value={pixKeyValue}
            onChange={(e) => setPixKeyValue(e.target.value)}
            autoComplete="off"
            aria-invalid={Boolean(fieldErrors.pixKeyValue)}
          />
          {fieldErrors.pixKeyValue ? (
            <p className="text-xs text-destructive" role="alert">
              {fieldErrors.pixKeyValue}
            </p>
          ) : null}
        </div>
      </fieldset>

      {formError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={tryLeaveToSearch}>
            Voltar para busca
          </Button>
        </div>
      ) : null}

      <Button type="submit" className="w-full sm:w-auto" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Criando…
          </>
        ) : (
          "Criar indicador"
        )}
      </Button>
    </form>
  )
}
