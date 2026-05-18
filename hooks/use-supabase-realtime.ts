"use client"

import { useCallback, useEffect, useRef } from "react"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"

export type SupabaseRealtimeTable =
  | "referrals"
  | "referral_history"
  | "rewards"
  | "wallet_transactions"
  | "payments"
  | "notifications"

export type SupabaseRealtimeFilter = {
  column: string
  value: string
}

export const REALTIME_TABLES_INDICADOR: SupabaseRealtimeTable[] = [
  "rewards",
  "wallet_transactions",
  "payments",
  "notifications",
]

export const REALTIME_TABLES_COMERCIAL: SupabaseRealtimeTable[] = [
  "referrals",
  "referral_history",
]

export const REALTIME_TABLES_ADMIN: SupabaseRealtimeTable[] = [
  "referrals",
  "rewards",
  "wallet_transactions",
  "payments",
  "notifications",
]

type UseSupabaseRealtimeOptions = {
  table: SupabaseRealtimeTable
  filter?: SupabaseRealtimeFilter
  onChange: () => void
  enabled?: boolean
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function devLogRealtime(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[realtime:debug]", ...args)
}

function tablesKey(tables: SupabaseRealtimeTable[]): string {
  return [...tables].sort().join(",")
}

/**
 * Escuta INSERT/UPDATE/DELETE em uma tabela public via Supabase Realtime.
 * Falhas de conexão são ignoradas (apenas log em dev).
 */
export function useSupabaseRealtime({
  table,
  filter,
  onChange,
  enabled = true,
}: UseSupabaseRealtimeOptions): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!enabled) return

    let channel: RealtimeChannel | null = null
    let disposed = false

    const subscribe = () => {
      try {
        const supabase = getSupabaseClient()
        const filterSuffix = filter ? `${filter.column}=${filter.value}` : "all"
        const channelName = `realtime:${table}:${filterSuffix}`

        const config: {
          event: "*"
          schema: "public"
          table: SupabaseRealtimeTable
          filter?: string
        } = {
          event: "*",
          schema: "public",
          table,
        }
        if (filter) {
          config.filter = `${filter.column}=eq.${filter.value}`
        }

        channel = supabase
          .channel(channelName)
          .on("postgres_changes", config, (payload) => {
            devLogRealtime("evento", {
              table,
              event: payload.eventType,
              filter: filter ?? null,
            })
            onChangeRef.current()
          })
          .subscribe((status, err) => {
            if (disposed) return
            devLogRealtime("status", {
              table,
              status,
              error: err?.message ?? null,
            })
          })
      } catch (e) {
        devLogRealtime("falha ao subscrever (ignorado)", {
          table,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    subscribe()

    return () => {
      disposed = true
      if (!channel) return
      try {
        const supabase = getSupabaseClient()
        void supabase.removeChannel(channel)
        devLogRealtime("unsubscribe", { table })
      } catch {
        // cleanup silencioso
      }
    }
  }, [table, filter?.column, filter?.value, enabled])
}

/**
 * Várias tabelas no mesmo channel (menos conexões).
 */
export function useSupabaseRealtimeTables(
  tables: SupabaseRealtimeTable[],
  onChange: () => void,
  options?: { enabled?: boolean; filter?: SupabaseRealtimeFilter }
): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const enabled = options?.enabled ?? true
  const filter = options?.filter
  const key = tablesKey(tables)

  useEffect(() => {
    if (!enabled || tables.length === 0) return

    let channel: RealtimeChannel | null = null
    let disposed = false

    const subscribe = () => {
      try {
        const supabase = getSupabaseClient()
        const filterSuffix = filter ? `${filter.column}=${filter.value}` : "all"
        const channelName = `realtime:multi:${key}:${filterSuffix}`

        let ch = supabase.channel(channelName)

        for (const table of tables) {
          const config: {
            event: "*"
            schema: "public"
            table: SupabaseRealtimeTable
            filter?: string
          } = {
            event: "*",
            schema: "public",
            table,
          }
          if (filter) {
            config.filter = `${filter.column}=eq.${filter.value}`
          }
          ch = ch.on("postgres_changes", config, (payload) => {
            devLogRealtime("evento", {
              table,
              event: payload.eventType,
              filter: filter ?? null,
            })
            onChangeRef.current()
          })
        }

        channel = ch.subscribe((status, err) => {
          if (disposed) return
          devLogRealtime("status multi", {
            tables: key,
            status,
            error: err?.message ?? null,
          })
        })
      } catch (e) {
        devLogRealtime("falha ao subscrever multi (ignorado)", {
          tables: key,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    subscribe()

    return () => {
      disposed = true
      if (!channel) return
      try {
        const supabase = getSupabaseClient()
        void supabase.removeChannel(channel)
        devLogRealtime("unsubscribe multi", { tables: key })
      } catch {
        // cleanup silencioso
      }
    }
  }, [key, enabled, filter?.column, filter?.value, tables])
}

/**
 * Debounce + evita reloads simultâneos; agenda um reload pendente após o atual.
 */
export function useDebouncedRealtimeReload(
  reload: () => void | Promise<void>,
  debounceMs = 300
): () => void {
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  const runReload = useCallback(async () => {
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    inFlightRef.current = true
    try {
      await Promise.resolve(reloadRef.current())
    } catch (e) {
      devLogRealtime("reload falhou (ignorado)", {
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      inFlightRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void runReload()
      }
    }
  }, [])

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void runReload()
    }, debounceMs)
  }, [debounceMs, runReload])
}

/**
 * Atalho: várias tabelas + debounce 300ms + guard de concorrência.
 */
export function useRealtimeReload(
  reload: () => void | Promise<void>,
  tables: SupabaseRealtimeTable[],
  options?: { enabled?: boolean; debounceMs?: number }
): void {
  const enabled = options?.enabled ?? true
  const debounced = useDebouncedRealtimeReload(reload, options?.debounceMs ?? 300)
  useSupabaseRealtimeTables(tables, debounced, { enabled })
}
