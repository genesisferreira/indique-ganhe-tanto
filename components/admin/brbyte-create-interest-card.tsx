"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BrbyteReferralTimeline } from "@/components/admin/brbyte-referral-timeline"
import { isUnconfirmedBrbyteCreateError } from "@/lib/brbyte/create-interest-messages"
import {
  buildBrbyteTimeline,
  formatBrbyteFriendlyMessage,
  isBrbyteFlowFinalized,
} from "@/lib/brbyte/observability"
import { getBrbyteSyncStatusLabel } from "@/lib/brbyte/sync-status-labels"
import { CheckCircle2, ChevronDown, Loader2, PlugZap } from "lucide-react"
import type { BrbyteSyncStatus, Indicacao } from "@/types/referral"
import { normalizeBrbyteSyncStatus } from "@/types/referral"

type BrbyteMeta = {
  enabled: boolean
  configured: boolean
  brbyteIdInteressado: string | null
  brbyteInteressadoStatus: string | null
  brbyteInteressadoCreatedAt: string | null
  brbyteInteressadoLastSyncAt: string | null
  brbyteSyncStatus: BrbyteSyncStatus
  brbyteSyncError: string | null
  brbyteSyncErrorRaw: string | null
  brbyteSyncAttempts: number
  brbyteLastErrorAt: string | null
  brbyteLastHttpStatus: number | null
  brbyteLastEndpoint: string | null
  brbyteLastSyncAt: string | null
  brbyteClientPk: string | null
  brbyteClientSyncedAt: string | null
  brbyteContractPk: string | null
  brbyteFirstInvoicePk: string | null
  brbyteFirstInvoicePaidAt: string | null
  brbyteFirstInvoicePayload: Record<string, unknown> | null
  invoiceMsg: string | null
  invoiceDateCredit: string | null
  firstInvoicePaid: boolean
  creditReleased: boolean
  rewardReserved: boolean
  rewardId: string | null
  walletTransactionId: string | null
}

type BrbyteCreateInterestCardProps = {
  referralId: string
  indicacao: Indicacao
  canMutate: boolean
  isAdminMaster?: boolean
  onCreated?: () => void
}

function formatApiMessage(
  message: string | undefined,
  fallback: string
): string {
  return formatBrbyteFriendlyMessage(message) ?? fallback
}

export function BrbyteCreateInterestCard({
  referralId,
  indicacao,
  canMutate,
  isAdminMaster = false,
  onCreated,
}: BrbyteCreateInterestCardProps) {
  const [meta, setMeta] = useState<BrbyteMeta | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [creating, setCreating] = useState(false)
  const [checkingConversion, setCheckingConversion] = useState(false)
  const [checkingFirstInvoice, setCheckingFirstInvoice] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [techOpen, setTechOpen] = useState(false)

  const loadMeta = useCallback(async () => {
    if (!canMutate) return
    setLoadingMeta(true)
    try {
      const res = await fetch(
        `/api/admin/brbyte/create-interest?referralId=${encodeURIComponent(referralId)}`,
        { cache: "no-store" }
      )
      if (!res.ok) return

      const data = (await res.json()) as {
        enabled?: boolean
        configured?: boolean
        brbyteIdInteressado?: string | null
        brbyteInteressadoStatus?: string | null
        brbyteInteressadoCreatedAt?: string | null
        brbyteInteressadoLastSyncAt?: string | null
        brbyteSyncStatus?: string | null
        brbyteSyncError?: string | null
        brbyteSyncErrorRaw?: string | null
        brbyteSyncAttempts?: number
        brbyteLastErrorAt?: string | null
        brbyteLastHttpStatus?: number | null
        brbyteLastEndpoint?: string | null
        brbyteLastSyncAt?: string | null
        brbyteClientPk?: string | null
        brbyteClientSyncedAt?: string | null
        brbyteContractPk?: string | null
        brbyteFirstInvoicePk?: string | null
        brbyteFirstInvoicePaidAt?: string | null
        brbyteFirstInvoicePayload?: Record<string, unknown> | null
        invoiceMsg?: string | null
        invoiceDateCredit?: string | null
        firstInvoicePaid?: boolean
        creditReleased?: boolean
        rewardReserved?: boolean
        rewardId?: string | null
        walletTransactionId?: string | null
      }

      setMeta({
        enabled: Boolean(data.enabled),
        configured: Boolean(data.configured),
        brbyteIdInteressado: data.brbyteIdInteressado ?? null,
        brbyteInteressadoStatus: data.brbyteInteressadoStatus ?? null,
        brbyteInteressadoCreatedAt: data.brbyteInteressadoCreatedAt ?? null,
        brbyteInteressadoLastSyncAt: data.brbyteInteressadoLastSyncAt ?? null,
        brbyteSyncStatus: normalizeBrbyteSyncStatus(data.brbyteSyncStatus),
        brbyteSyncError: data.brbyteSyncError ?? null,
        brbyteSyncErrorRaw: data.brbyteSyncErrorRaw ?? null,
        brbyteSyncAttempts:
          typeof data.brbyteSyncAttempts === "number" ? data.brbyteSyncAttempts : 0,
        brbyteLastErrorAt: data.brbyteLastErrorAt ?? null,
        brbyteLastHttpStatus:
          typeof data.brbyteLastHttpStatus === "number"
            ? data.brbyteLastHttpStatus
            : null,
        brbyteLastEndpoint: data.brbyteLastEndpoint ?? null,
        brbyteLastSyncAt: data.brbyteLastSyncAt ?? null,
        brbyteClientPk: data.brbyteClientPk ?? null,
        brbyteClientSyncedAt: data.brbyteClientSyncedAt ?? null,
        brbyteContractPk: data.brbyteContractPk ?? null,
        brbyteFirstInvoicePk: data.brbyteFirstInvoicePk ?? null,
        brbyteFirstInvoicePaidAt: data.brbyteFirstInvoicePaidAt ?? null,
        brbyteFirstInvoicePayload: data.brbyteFirstInvoicePayload ?? null,
        invoiceMsg: data.invoiceMsg ?? null,
        invoiceDateCredit: data.invoiceDateCredit ?? null,
        firstInvoicePaid: Boolean(data.firstInvoicePaid),
        creditReleased: Boolean(data.creditReleased),
        rewardReserved: Boolean(data.rewardReserved),
        rewardId: data.rewardId ?? null,
        walletTransactionId: data.walletTransactionId ?? null,
      })
    } finally {
      setLoadingMeta(false)
    }
  }, [canMutate, referralId])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  const syncStatus =
    meta?.brbyteSyncStatus ?? indicacao.brbyteSyncStatus ?? normalizeBrbyteSyncStatus(null)
  const syncAttempts = meta?.brbyteSyncAttempts ?? indicacao.brbyteSyncAttempts ?? 0
  const syncError = meta?.brbyteSyncError ?? indicacao.brbyteSyncError ?? null
  const firstInvoicePaid =
    meta?.firstInvoicePaid ??
    indicacao.primeiraFaturaPaga ??
    Boolean(indicacao.brbyteFirstInvoicePaidAt)
  const creditReleased = Boolean(
    meta?.creditReleased ?? meta?.walletTransactionId
  )
  const rewardReserved = Boolean(
    meta?.rewardReserved ?? (meta?.rewardId && !creditReleased)
  )
  const flowFinalized = isBrbyteFlowFinalized({
    firstInvoicePaid,
    brbyteSyncStatus: syncStatus,
  })

  const timelineSteps = useMemo(
    () =>
      buildBrbyteTimeline({
        brbyteSyncStatus: syncStatus,
        brbyteSyncError: syncError,
        brbyteIdInteressado:
          meta?.brbyteIdInteressado ?? indicacao.brbyteIdInteressado ?? null,
        brbyteInteressadoCreatedAt:
          meta?.brbyteInteressadoCreatedAt ??
          indicacao.brbyteInteressadoCreatedAt?.toISOString() ??
          null,
        brbyteClientPk: meta?.brbyteClientPk ?? indicacao.brbyteClientPk ?? null,
        brbyteClientSyncedAt:
          meta?.brbyteClientSyncedAt ??
          indicacao.brbyteClientSyncedAt?.toISOString() ??
          null,
        brbyteContractPk: meta?.brbyteContractPk ?? indicacao.brbyteContractPk ?? null,
        brbyteFirstInvoicePk: meta?.brbyteFirstInvoicePk ?? null,
        brbyteFirstInvoicePaidAt:
          meta?.brbyteFirstInvoicePaidAt ??
          indicacao.brbyteFirstInvoicePaidAt?.toISOString() ??
          null,
        brbyteFirstInvoicePayload: meta?.brbyteFirstInvoicePayload ?? null,
        brbyteLastSyncAt:
          meta?.brbyteLastSyncAt ??
          meta?.brbyteInteressadoLastSyncAt ??
          indicacao.brbyteInteressadoLastSyncAt?.toISOString() ??
          null,
        firstInvoicePaid,
        creditReleased,
        rewardReserved,
        rewardId: meta?.rewardId ?? null,
        walletTransactionId: meta?.walletTransactionId ?? null,
      }),
    [meta, indicacao, syncStatus, syncError, firstInvoicePaid, creditReleased, rewardReserved]
  )

  if (!canMutate) return null

  if (
    !loadingMeta &&
    meta &&
    !meta.enabled &&
    !meta.brbyteIdInteressado &&
    syncStatus === "pending"
  ) {
    return null
  }

  const retryLimitReached = syncStatus === "error" && syncAttempts >= 3
  const unconfirmedCreate = isUnconfirmedBrbyteCreateError(
    meta?.brbyteSyncErrorRaw ?? syncError
  )

  const canCreate =
    !flowFinalized &&
    Boolean(meta?.enabled && meta?.configured) &&
    (syncStatus === "pending" || (syncStatus === "error" && !retryLimitReached)) &&
    !unconfirmedCreate

  const canCheckConversion =
    !flowFinalized &&
    Boolean(meta?.enabled && meta?.configured) &&
    syncStatus === "created"

  const canCheckFirstInvoice =
    !flowFinalized &&
    Boolean(meta?.enabled && meta?.configured) &&
    (syncStatus === "converted" ||
      syncStatus === "waiting_invoice" ||
      syncStatus === "waiting_contract")

  const canResetBrbyte =
    isAdminMaster &&
    !firstInvoicePaid &&
    syncStatus !== "paid_confirmed" &&
    syncStatus !== "completed"

  const handleCheckConversion = async () => {
    setCheckingConversion(true)
    try {
      const res = await fetch("/api/admin/brbyte/check-conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralId }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        converted?: boolean
        message?: string
      }
      if (!res.ok || data.ok === false) {
        toast.error(
          formatApiMessage(
            data.message,
            "Não foi possível verificar o status do Interessado no Controllr."
          )
        )
        await loadMeta()
        onCreated?.()
        return
      }
      toast[data.converted ? "success" : "message"](
        formatApiMessage(
          data.message,
          data.converted
            ? "Interessado convertido em cliente no Controllr."
            : "Interessado criado no ERP. Aguardando conversão manual pelo comercial."
        )
      )
      await loadMeta()
      onCreated?.()
    } catch {
      toast.error("Erro inesperado ao verificar status no Controllr.")
    } finally {
      setCheckingConversion(false)
    }
  }

  const handleCheckFirstInvoice = async () => {
    setCheckingFirstInvoice(true)
    try {
      const res = await fetch("/api/admin/brbyte/check-first-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralId }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        paid?: boolean
        idempotent?: boolean
        message?: string
      }
      if (!res.ok || data.ok === false) {
        toast.error(
          formatApiMessage(
            data.message,
            "Não foi possível verificar a primeira mensalidade no Controllr."
          )
        )
        await loadMeta()
        onCreated?.()
        return
      }
      if (data.paid) {
        toast.success(
          formatApiMessage(
            data.message,
            data.idempotent
              ? "Crédito já havia sido liberado anteriormente."
              : "Primeira mensalidade paga confirmada no ERP."
          )
        )
      } else {
        toast.message(
          formatApiMessage(
            data.message,
            "Primeira mensalidade encontrada, aguardando baixa/pagamento no ERP."
          )
        )
      }
      await loadMeta()
      onCreated?.()
    } catch {
      toast.error("Erro inesperado ao verificar primeira mensalidade.")
    } finally {
      setCheckingFirstInvoice(false)
    }
  }

  const handleResetBrbyte = async () => {
    setResetting(true)
    try {
      const res = await fetch("/api/admin/brbyte/reset-referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralId }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string }
      if (!res.ok || data.ok === false) {
        toast.error(
          data.message ?? "Não foi possível resetar a integração BRByte."
        )
        return
      }
      toast.success(data.message ?? "Integração BRByte resetada com sucesso.")
      await loadMeta()
      onCreated?.()
    } catch {
      toast.error("Erro inesperado ao resetar integração BRByte.")
    } finally {
      setResetting(false)
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/admin/brbyte/create-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralId }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        message?: string
      }
      if (!res.ok || !data.ok) {
        toast.error(
          formatApiMessage(
            data.message,
            "Não foi possível criar Interessado no Controllr."
          )
        )
        await loadMeta()
        onCreated?.()
        return
      }
      toast.success(
        formatApiMessage(data.message, "Interessado criado no Controllr.")
      )
      await loadMeta()
      onCreated?.()
    } catch {
      toast.error("Erro inesperado ao comunicar com a integração BRByte.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PlugZap className="h-4 w-4" />
          Controllr / BRByte
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {loadingMeta ? (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando integração…
          </p>
        ) : null}

        {meta && !meta.enabled ? (
          <p className="text-muted-foreground">
            Criação manual de Interessado desabilitada neste ambiente.
          </p>
        ) : null}

        {meta && meta.enabled && !meta.configured ? (
          <p className="text-amber-600 dark:text-amber-500">
            Integração habilitada, mas variáveis BRByte incompletas no servidor.
          </p>
        ) : null}

        <div className="space-y-1">
          <p>
            <span className="text-muted-foreground">Status da integração:</span>{" "}
            {getBrbyteSyncStatusLabel(syncStatus)}
          </p>
          {syncError ? (
            <p className="text-destructive whitespace-pre-wrap">{syncError}</p>
          ) : null}
        </div>

        <BrbyteReferralTimeline steps={timelineSteps} />

        {flowFinalized ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                {creditReleased
                  ? "Crédito liberado ao indicador"
                  : rewardReserved
                    ? "Recompensa reservada"
                    : "Primeira mensalidade confirmada"}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Fluxo BRByte concluído para esta indicação. Não há mais ações
                manuais disponíveis.
              </p>
            </div>
          </div>
        ) : null}

        <Collapsible open={techOpen} onOpenChange={setTechOpen}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-between px-2 text-xs text-muted-foreground"
            >
              Detalhes técnicos
              <ChevronDown
                className={`h-4 w-4 transition-transform ${techOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 rounded-lg border border-border p-3 text-xs">
            <p>
              <span className="text-muted-foreground">Status BRByte:</span>{" "}
              {syncStatus}
            </p>
            <p>
              <span className="text-muted-foreground">Tentativas:</span>{" "}
              {syncAttempts}
            </p>
            <p>
              <span className="text-muted-foreground">Último endpoint:</span>{" "}
              <code>{meta?.brbyteLastEndpoint ?? "—"}</code>
            </p>
            <p>
              <span className="text-muted-foreground">Último HTTP:</span>{" "}
              {meta?.brbyteLastHttpStatus ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Último erro:</span>{" "}
              {meta?.brbyteSyncErrorRaw ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Interest PK:</span>{" "}
              {meta?.brbyteIdInteressado ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Client PK:</span>{" "}
              {meta?.brbyteClientPk ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Contract PK:</span>{" "}
              {meta?.brbyteContractPk ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Invoice PK:</span>{" "}
              {meta?.brbyteFirstInvoicePk ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Invoice msg:</span>{" "}
              {meta?.invoiceMsg ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Invoice date credit:</span>{" "}
              {meta?.invoiceDateCredit ?? "—"}
            </p>
            {meta?.rewardId ? (
              <p>
                <span className="text-muted-foreground">Reward ID:</span>{" "}
                {meta.rewardId}
              </p>
            ) : null}
            {meta?.walletTransactionId ? (
              <p>
                <span className="text-muted-foreground">Wallet transaction:</span>{" "}
                {meta.walletTransactionId}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Último sync:</span>{" "}
              {meta?.brbyteLastSyncAt
                ? new Date(meta.brbyteLastSyncAt).toLocaleString("pt-BR")
                : "—"}
            </p>
          </CollapsibleContent>
        </Collapsible>

        {retryLimitReached ? (
          <p className="text-amber-600 dark:text-amber-500 border-t border-border pt-3">
            Limite de tentativas atingido. Revise as credenciais, plano ou dados
            do indicado.
          </p>
        ) : null}

        {unconfirmedCreate ? (
          <p className="text-amber-600 dark:text-amber-500 border-t border-border pt-3">
            A criação pode ter ocorrido no Controllr, mas o CRM não confirmou o
            ID. Verifique manualmente no ERP antes de tentar novamente.
          </p>
        ) : null}

        {canCreate ? (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-muted-foreground">
              Envia os dados do indicado para o Controllr como Interessado (ação
              manual, sem automação).
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={creating}
              onClick={() => void handleCreate()}
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando no Controllr…
                </>
              ) : syncStatus === "error" ? (
                "Tentar novamente no Controllr"
              ) : (
                "Criar interessado no Controllr"
              )}
            </Button>
          </div>
        ) : null}

        {canCheckConversion ? (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-muted-foreground">
              Consulta no Controllr se o comercial já converteu o Interessado em
              cliente (ação manual no ERP).
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={checkingConversion}
              onClick={() => void handleCheckConversion()}
            >
              {checkingConversion ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verificando no Controllr…
                </>
              ) : (
                "Verificar status no Controllr"
              )}
            </Button>
          </div>
        ) : null}

        {canCheckFirstInvoice ? (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-muted-foreground">
              Consulta no Controllr se a primeira mensalidade do contrato está
              paga e libera a recompensa do indicador (sem converter no ERP).
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={checkingFirstInvoice}
              onClick={() => void handleCheckFirstInvoice()}
            >
              {checkingFirstInvoice ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verificando mensalidade…
                </>
              ) : (
                "Verificar primeira mensalidade"
              )}
            </Button>
          </div>
        ) : null}

        {canResetBrbyte ? (
          <div className="border-t border-border pt-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                  disabled={resetting}
                >
                  {resetting ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Resetando…
                    </>
                  ) : (
                    "Resetar integração BRByte"
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Resetar integração BRByte?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isso limpa os vínculos BRByte desta indicação (interessado,
                    cliente, contrato e faturas) para permitir um novo teste real.
                    A indicação e o histórico geral não serão apagados.
                    Recompensas já liberadas impedem este reset.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleResetBrbyte()}>
                    Confirmar reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
