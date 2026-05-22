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
  | "commercial_lead_settings"

export type SupabaseRealtimeFilter = {
  column: string
  value: string
}

/**
 * Indicador: referrals (status), rewards, wallet, payments.
 * Notificações: canal dedicado em `useNotifications` (`notifications:{profileId}`).
 */
export const REALTIME_TABLES_INDICADOR: SupabaseRealtimeTable[] = [
  "referrals",
  "rewards",
  "wallet_transactions",
  "payments",
]

export const REALTIME_TABLES_COMERCIAL: SupabaseRealtimeTable[] = [
  "referrals",
  "referral_history",
  "commercial_lead_settings",
]

/** Notificações: apenas `useNotifications` (canal dedicado `notifications:{profileId}`). */
export const REALTIME_TABLES_ADMIN: SupabaseRealtimeTable[] = [
  "referrals",
  "rewards",
  "wallet_transactions",
  "payments",
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
  const channelRef = useRef<RealtimeChannel | null>(null)
  const channelKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    const filterSuffix = filter ? `${filter.column}=${filter.value}` : "all"
    const channelName = `realtime:${table}:${filterSuffix}`

    if (channelRef.current && channelKeyRef.current === channelName) {
      devLogRealtime("skip — canal já ativo", { channelName })
      return
    }

    let disposed = false

    const teardown = async () => {
      const ch = channelRef.current
      if (!ch) return
      channelRef.current = null
      channelKeyRef.current = null
      try {
        const supabase = getSupabaseClient()
        await supabase.removeChannel(ch)
        devLogRealtime("unsubscribe", { table, channelName })
      } catch {
        // cleanup silencioso
      }
    }

    const subscribe = async () => {
      await teardown()
      if (disposed) return

      try {
        const supabase = getSupabaseClient()

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

        const channel = supabase
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
              channelName,
              status,
              error: err?.message ?? null,
            })
          })

        channelRef.current = channel
        channelKeyRef.current = channelName
      } catch (e) {
        devLogRealtime("falha ao subscrever (ignorado)", {
          table,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    void subscribe()

    return () => {
      disposed = true
      void teardown()
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
  const channelRef = useRef<RealtimeChannel | null>(null)
  const channelKeyRef = useRef<string | null>(null)
  const enabled = options?.enabled ?? true
  const filter = options?.filter
  const key = tablesKey(tables)

  useEffect(() => {
    if (!enabled || tables.length === 0) return

    const filterSuffix = filter ? `${filter.column}=${filter.value}` : "all"
    const channelName = `realtime:multi:${key}:${filterSuffix}`

    if (channelRef.current && channelKeyRef.current === channelName) {
      devLogRealtime("skip multi — canal já ativo", { channelName })
      return
    }

    let disposed = false

    const teardown = async () => {
      const ch = channelRef.current
      if (!ch) return
      channelRef.current = null
      channelKeyRef.current = null
      try {
        const supabase = getSupabaseClient()
        await supabase.removeChannel(ch)
        devLogRealtime("unsubscribe multi", { tables: key, channelName })
      } catch {
        // cleanup silencioso
      }
    }

    const subscribe = async () => {
      await teardown()
      if (disposed) return

      try {
        const supabase = getSupabaseClient()

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

        const channel = ch.subscribe((status, err) => {
          if (disposed) return
          devLogRealtime("status multi", {
            tables: key,
            channelName,
            status,
            error: err?.message ?? null,
          })
        })

        channelRef.current = channel
        channelKeyRef.current = channelName
      } catch (e) {
        devLogRealtime("falha ao subscrever multi (ignorado)", {
          tables: key,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    void subscribe()

    return () => {
      disposed = true
      void teardown()
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
  options?: {
    enabled?: boolean
    debounceMs?: number
    filter?: SupabaseRealtimeFilter
    /** Prefixo de log em dev (ex.: `[indicador:realtime]`). */
    logPrefix?: string
  }
): void {
  const enabled = options?.enabled ?? true
  const logPrefix = options?.logPrefix

  const tableKey = tablesKey(tables)
  const reloadWithLog = useCallback(() => {
    if (logPrefix && isDev()) {
      console.log(logPrefix, "reload", { tables: tableKey })
    }
    return reload()
  }, [reload, logPrefix, tableKey])

  const debounced = useDebouncedRealtimeReload(reloadWithLog, options?.debounceMs ?? 300)
  useSupabaseRealtimeTables(tables, debounced, {
    enabled,
    filter: options?.filter,
  })
}
