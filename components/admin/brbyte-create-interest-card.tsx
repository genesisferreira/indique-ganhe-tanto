"use client"



import { useCallback, useEffect, useState } from "react"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { getBrbyteSyncStatusLabel } from "@/lib/brbyte/sync-status-labels"
import { isUnconfirmedBrbyteCreateError } from "@/lib/brbyte/create-interest-messages"

import { Loader2, PlugZap } from "lucide-react"

import type { BrbyteSyncStatus, Indicacao } from "@/types/referral"

import { normalizeBrbyteSyncStatus } from "@/types/referral"



type BrbyteMeta = {

  enabled: boolean

  configured: boolean

  brbyteIdInteressado: string | null

  brbyteInteressadoStatus: string | null

  brbyteInteressadoLastSyncAt: string | null

  brbyteSyncStatus: BrbyteSyncStatus

  brbyteSyncError: string | null

  brbyteSyncAttempts: number

  brbyteLastErrorAt: string | null

  brbyteLastHttpStatus: number | null

  brbyteLastEndpoint: string | null

  brbyteClientPk: string | null

  brbyteClientSyncedAt: string | null

}



type BrbyteCreateInterestCardProps = {

  referralId: string

  indicacao: Indicacao

  canMutate: boolean

  onCreated?: () => void

}



export function BrbyteCreateInterestCard({

  referralId,

  indicacao,

  canMutate,

  onCreated,

}: BrbyteCreateInterestCardProps) {

  const [meta, setMeta] = useState<BrbyteMeta | null>(null)

  const [loadingMeta, setLoadingMeta] = useState(false)

  const [creating, setCreating] = useState(false)

  const [checkingConversion, setCheckingConversion] = useState(false)



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

        brbyteInteressadoLastSyncAt?: string | null

        brbyteSyncStatus?: string | null

        brbyteSyncError?: string | null

        brbyteSyncAttempts?: number

        brbyteLastErrorAt?: string | null

        brbyteLastHttpStatus?: number | null

        brbyteLastEndpoint?: string | null

        brbyteClientPk?: string | null

        brbyteClientSyncedAt?: string | null

      }

      setMeta({

        enabled: Boolean(data.enabled),

        configured: Boolean(data.configured),

        brbyteIdInteressado: data.brbyteIdInteressado ?? null,

        brbyteInteressadoStatus: data.brbyteInteressadoStatus ?? null,

        brbyteInteressadoLastSyncAt: data.brbyteInteressadoLastSyncAt ?? null,

        brbyteSyncStatus: normalizeBrbyteSyncStatus(data.brbyteSyncStatus),

        brbyteSyncError: data.brbyteSyncError ?? null,

        brbyteSyncAttempts:

          typeof data.brbyteSyncAttempts === "number" ? data.brbyteSyncAttempts : 0,

        brbyteLastErrorAt: data.brbyteLastErrorAt ?? null,

        brbyteLastHttpStatus:

          typeof data.brbyteLastHttpStatus === "number"

            ? data.brbyteLastHttpStatus

            : null,

        brbyteLastEndpoint: data.brbyteLastEndpoint ?? null,

        brbyteClientPk: data.brbyteClientPk ?? null,

        brbyteClientSyncedAt: data.brbyteClientSyncedAt ?? null,

      })

    } finally {

      setLoadingMeta(false)

    }

  }, [canMutate, referralId])



  useEffect(() => {

    void loadMeta()

  }, [loadMeta])



  const existingId =

    meta?.brbyteIdInteressado ?? indicacao.brbyteIdInteressado ?? null

  const existingStatus =

    meta?.brbyteInteressadoStatus ?? indicacao.brbyteInteressadoStatus ?? null

  const syncStatus =

    meta?.brbyteSyncStatus ??

    indicacao.brbyteSyncStatus ??

    normalizeBrbyteSyncStatus(null)

  const syncAttempts =

    meta?.brbyteSyncAttempts ?? indicacao.brbyteSyncAttempts ?? 0

  const syncError = meta?.brbyteSyncError ?? indicacao.brbyteSyncError ?? null

  const lastEndpoint =

    meta?.brbyteLastEndpoint ?? indicacao.brbyteLastEndpoint ?? null

  const lastHttpStatus =

    meta?.brbyteLastHttpStatus ?? indicacao.brbyteLastHttpStatus ?? null

  const lastSync =

    meta?.brbyteInteressadoLastSyncAt ??

    indicacao.brbyteInteressadoLastSyncAt?.toISOString() ??

    null

  const clientPk =

    meta?.brbyteClientPk ?? indicacao.brbyteClientPk ?? null

  const clientSyncedAt =

    meta?.brbyteClientSyncedAt ??

    indicacao.brbyteClientSyncedAt?.toISOString() ??

    null



  if (!canMutate) return null

  if (!loadingMeta && meta && !meta.enabled && !existingId && syncStatus === "pending") {

    return null

  }



  const canCreate =
    Boolean(meta?.enabled && meta?.configured) &&
    (!existingId || syncStatus === "error") &&
    !(syncStatus === "error" && syncAttempts >= 3) &&
    !isUnconfirmedBrbyteCreateError(syncError)

  const retryLimitReached = syncStatus === "error" && syncAttempts >= 3
  const unconfirmedCreate = isUnconfirmedBrbyteCreateError(syncError)

  const canCheckConversion =
    Boolean(meta?.enabled && meta?.configured) &&
    Boolean(existingId) &&
    syncStatus === "created" &&
    !clientPk

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
        brbyteClientPk?: string | null
      }

      if (!res.ok || data.ok === false) {
        toast.error(
          data.message ??
            "Não foi possível verificar o status do Interessado no Controllr."
        )
        await loadMeta()
        onCreated?.()
        return
      }

      if (data.converted) {
        toast.success(
          data.message ?? "Interessado convertido em cliente no Controllr."
        )
      } else {
        toast.message(
          data.message ?? "Ainda não convertido no Controllr."
        )
      }

      await loadMeta()
      onCreated?.()
    } catch {
      toast.error("Erro inesperado ao verificar status no Controllr.")
    } finally {
      setCheckingConversion(false)
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

        brbyteIdInteressado?: string | null

      }



      if (!res.ok || !data.ok) {

        toast.error(data.message ?? "Não foi possível criar Interessado no Controllr.")

        await loadMeta()

        onCreated?.()

        return

      }



      toast.success(data.message ?? "Interessado criado no Controllr.")

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

          {syncAttempts > 0 ? (

            <p>

              <span className="text-muted-foreground">Tentativas:</span>{" "}

              {syncAttempts}

            </p>

          ) : null}

          {lastEndpoint ? (

            <p>

              <span className="text-muted-foreground">Último endpoint:</span>{" "}

              <code className="text-xs">{lastEndpoint}</code>

            </p>

          ) : null}

          {lastHttpStatus !== null ? (

            <p>

              <span className="text-muted-foreground">Último HTTP:</span>{" "}

              {lastHttpStatus}

            </p>

          ) : null}

          {syncError ? (

            <p className="text-destructive whitespace-pre-wrap">{syncError}</p>

          ) : null}

          {lastSync ? (

            <p className="text-muted-foreground text-xs">

              Última sincronização:{" "}

              {new Date(lastSync).toLocaleString("pt-BR")}

            </p>

          ) : null}

        </div>



        {existingId ? (

          <div className="space-y-1 border-t border-border pt-3">

            <p>

              <span className="text-muted-foreground">ID Interessado:</span>{" "}

              {existingId}

            </p>

            {existingStatus ? (

              <p>

                <span className="text-muted-foreground">Status ERP:</span>{" "}

                {existingStatus}

              </p>

            ) : null}

            {clientPk ? (

              <p>

                <span className="text-muted-foreground">ID Cliente:</span>{" "}

                {clientPk}

              </p>

            ) : null}

            {clientSyncedAt ? (

              <p className="text-muted-foreground text-xs">

                Cliente sincronizado em:{" "}

                {new Date(clientSyncedAt).toLocaleString("pt-BR")}

              </p>

            ) : null}

          </div>

        ) : null}



        {retryLimitReached ? (
          <p className="text-amber-600 dark:text-amber-500 border-t border-border pt-3">
            Limite de tentativas atingido. Revise as credenciais, plano ou dados
            do indicado.
          </p>
        ) : null}

        {unconfirmedCreate ? (
          <p className="text-amber-600 dark:text-amber-500 border-t border-border pt-3">
            A criação pode ter ocorrido no Controllr, mas o CRM não confirmou o ID.
            Verifique manualmente no ERP antes de tentar novamente.
          </p>
        ) : null}

        {canCreate ? (

          <div className="space-y-3 border-t border-border pt-3">

            <p className="text-muted-foreground">

              Envia os dados do indicado para o Controllr como Interessado

              (ação manual, sem automação).

            </p>

            <Button

              type="button"

              variant="secondary"

              className="w-full"

              disabled={creating}

              onClick={() => {

                void handleCreate()

              }}

            >

              {creating ? (

                <>

                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />

                  Criando no Controllr…

                </>

              ) : syncStatus === "error" ? (

                "Tentar novamente no Controllr"

              ) : (

                "Criar Interessado no Controllr"

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

              onClick={() => {

                void handleCheckConversion()

              }}

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

      </CardContent>

    </Card>

  )

}


