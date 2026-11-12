"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  createGuardedLoader,
  type GuardedLoader,
  type LoadOutcome,
  type LoaderRunOptions,
  type LoaderState,
} from "@/lib/client/guarded-loader"

/**
 * 3.1F-K1: hook fino sobre `createGuardedLoader`.
 * - Um controlador por montagem/conjunto de parâmetros (`key`); troca de `key` descarta o anterior.
 * - Início adiado para microtask: no StrictMode (montar → desmontar → montar) o primeiro
 *   controlador é descartado antes de chamar `load` (uma resolução de identidade por carregamento).
 * - Desmontagem aborta a requisição e bloqueia setState.
 */
export function useGuardedLoader<T>(
  load: (ctx: { signal: AbortSignal; attempt: number }) => Promise<LoadOutcome<T>>,
  key: string,
  options?: { timeoutMs?: number }
): { state: LoaderState<T>; reload: (opts?: LoaderRunOptions) => Promise<void> } {
  const [state, setState] = useState<LoaderState<T>>({ status: "idle" })
  const loadRef = useRef(load)
  loadRef.current = load
  const controllerRef = useRef<GuardedLoader | null>(null)
  const timeoutMs = options?.timeoutMs

  useEffect(() => {
    const controller = createGuardedLoader<T>({
      load: (ctx) => loadRef.current(ctx),
      onState: setState,
      timeoutMs,
    })
    controllerRef.current = controller
    controller.start()
    return () => {
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [key, timeoutMs])

  const reload = useCallback(async (opts?: LoaderRunOptions) => {
    await controllerRef.current?.run(opts)
  }, [])

  return { state, reload }
}
