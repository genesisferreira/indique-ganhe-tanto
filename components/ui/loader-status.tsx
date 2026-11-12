"use client"

import type { ReactNode } from "react"
import { AlertCircle, Clock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  LOADER_TIMEOUT_MESSAGE,
  loaderErrorMessage,
  type LoaderState,
} from "@/lib/client/guarded-loader"

/**
 * 3.1F-K1: apresentação acessível dos estados de um loader.
 * loading/empty => role="status" (aria-live polite); error/timeout => role="alert" + "Tentar novamente".
 * Sucesso e vazio real delegam a `children(data)`/`emptyMessage`; erro nunca é exibido como vazio.
 */
export function LoaderStatus<T>({
  state,
  onRetry,
  retryDisabled,
  loadingLabel = "Carregando…",
  emptyMessage,
  children,
}: {
  state: LoaderState<T>
  onRetry: () => void
  retryDisabled?: boolean
  loadingLabel?: string
  emptyMessage: ReactNode
  children: (data: T) => ReactNode
}) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-loader-state="loading"
        className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span>{loadingLabel}</span>
      </div>
    )
  }
  if (state.status === "error" || state.status === "timeout") {
    const isTimeout = state.status === "timeout"
    const Icon = isTimeout ? Clock : AlertCircle
    return (
      <div
        role="alert"
        data-loader-state={state.status}
        className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{isTimeout ? LOADER_TIMEOUT_MESSAGE : loaderErrorMessage(state.errorClass)}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retryDisabled}>
          Tentar novamente
        </Button>
      </div>
    )
  }
  if (state.status === "empty") {
    return (
      <div role="status" aria-live="polite" data-loader-state="empty" className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }
  return <div data-loader-state="success">{children(state.data)}</div>
}
