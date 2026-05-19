"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  createRealtimeToastPayload,
  loadRecentNotifications,
  loadUnreadNotificationsCount,
  mapRealtimePayloadToNotificationItem,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  NOTIFICATION_RECENT_LIMIT,
} from "@/lib/services/notification.service"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { NotificationItem } from "@/types/notification"
import type { UserRole } from "@/types/user"
import type { RealtimeChannel } from "@supabase/supabase-js"

const LOG_ERROR = "[notification:error]"
const LOG_SUBSCRIBE = "[notifications:subscribe]"
const LOG_UNSUBSCRIBE = "[notifications:unsubscribe]"
const LOG_EVENT = "[notifications:event]"
const LOG_CHANNEL_STATUS = "[notifications:channel-status]"
const LOG_TOAST_SHOW = "[toast:show]"
const LOG_TOAST_SKIP = "[toast:skip]"
const LOG_TOAST_DUPLICATE = "[toast:duplicate]"
const LOG_TOAST_ROLE = "[toast:role]"
const LOG_TOAST_CREATED = "[toast:created-at]"
const LOG_TOAST_PROFILE = "[toast:profile-match]"

/** Tolerância de relógio servidor × cliente (ms). */
const CREATED_AT_SKEW_MS = 5_000

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function devLog(prefix: string, ...args: unknown[]): void {
  if (!isDev()) return
  console.log(prefix, ...args)
}

function devLogError(...args: unknown[]): void {
  if (!isDev()) return
  console.warn(LOG_ERROR, ...args)
}

function createdAtMs(item: NotificationItem): number {
  return new Date(item.createdAt).getTime()
}

export type UseNotificationsOptions = {
  enabled?: boolean
  /** Exibir toast sonner em INSERT unread após mount. */
  showToasts?: boolean
}

export type UseNotificationsResult = {
  items: NotificationItem[]
  unreadCount: number
  loading: boolean
  refresh: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}

export function useNotifications(
  options: UseNotificationsOptions = {}
): UseNotificationsResult {
  const enabled = options.enabled ?? !isDataProviderMock()
  const showToasts = options.showToasts ?? true
  const router = useRouter()

  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<UserRole | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)

  const mountAtRef = useRef(Date.now())
  const toastedIdsRef = useRef(new Set<string>())
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const subscribedProfileRef = useRef<string | null>(null)

  const profileIdRef = useRef<string | null>(null)
  const roleRef = useRef<UserRole | null>(null)
  const showToastsRef = useRef(showToasts)
  const routerRef = useRef(router)

  profileIdRef.current = profileId
  roleRef.current = role
  showToastsRef.current = showToasts
  routerRef.current = router

  const showToastForRef = useRef<
    (item: NotificationItem, source?: "realtime" | "poll") => void
  >(() => {})

  showToastForRef.current = (item: NotificationItem, source: "realtime" | "poll" = "poll") => {
      const authProfileId = profileIdRef.current

      devLog(LOG_TOAST_ROLE, {
        role: roleRef.current,
        source,
        notificationId: item.id,
      })

      if (!showToastsRef.current) {
        devLog(LOG_TOAST_SKIP, { reason: "showToasts desligado", id: item.id })
        return
      }

      if (item.read) {
        devLog(LOG_TOAST_SKIP, { reason: "já lida", id: item.id })
        return
      }

      if (toastedIdsRef.current.has(item.id)) {
        devLog(LOG_TOAST_DUPLICATE, { id: item.id })
        return
      }

      if (authProfileId) {
        devLog(LOG_TOAST_PROFILE, {
          ok: true,
          authProfileId,
          source,
        })
      }

      const createdMs = createdAtMs(item)
      const mountAt = mountAtRef.current

      devLog(LOG_TOAST_CREATED, {
        id: item.id,
        source,
        createdMs,
        mountAt,
        deltaMs: createdMs - mountAt,
        valid: Number.isFinite(createdMs),
      })

      if (source === "poll") {
        if (!Number.isFinite(createdMs)) {
          devLog(LOG_TOAST_SKIP, { reason: "createdAt inválido", id: item.id })
          return
        }
        if (createdMs < mountAt - CREATED_AT_SKEW_MS) {
          devLog(LOG_TOAST_SKIP, {
            reason: "anterior ao mount (poll)",
            id: item.id,
            createdMs,
            mountAt,
          })
          return
        }
      }

      const payload = createRealtimeToastPayload(item)

      toast(payload.title, {
        id: `notification-${item.id}`,
        description: payload.message,
        duration: 6000,
        action: payload.actionUrl
          ? {
              label: "Abrir",
              onClick: () => routerRef.current.push(payload.actionUrl!),
            }
          : undefined,
      })

      toastedIdsRef.current.add(item.id)
      devLog(LOG_TOAST_SHOW, {
        id: item.id,
        title: payload.title,
        actionUrl: payload.actionUrl,
        source,
      })

      if (process.env.NODE_ENV === "development") {
        requestAnimationFrame(() => {
          const toastEl = document.querySelector(
            `[data-sonner-toast][data-id="notification-${item.id}"], [data-sonner-toast]`
          )
          console.log("[toast:dom]", {
            source,
            notificationId: item.id,
            toastInDom: Boolean(toastEl),
          })
        })
      }
  }

  const refreshInternal = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    inFlightRef.current = true
    try {
      const [recent, unread, basics] = await Promise.all([
        loadRecentNotifications(NOTIFICATION_RECENT_LIMIT),
        loadUnreadNotificationsCount(),
        getAuthProfileBasicsFromSupabase(),
      ])
      setItems(recent)
      setUnreadCount(unread)
      if (basics) {
        setRole(basics.role)
        setProfileId(basics.id)
        profileIdRef.current = basics.id
        roleRef.current = basics.role
      }
      devLog(LOG_EVENT, "refresh", { total: recent.length, unread })
    } catch (e) {
      devLogError("refresh falhou", e instanceof Error ? e.message : String(e))
    } finally {
      inFlightRef.current = false
      setLoading(false)
      if (pendingRef.current) {
        pendingRef.current = false
        void refreshInternal()
      }
    }
  }, [enabled])

  const refreshRef = useRef(refreshInternal)
  refreshRef.current = refreshInternal

  useEffect(() => {
    mountAtRef.current = Date.now()
    toastedIdsRef.current.clear()
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const basics = await getAuthProfileBasicsFromSupabase()
      if (cancelled || !basics) return
      setProfileId(basics.id)
      setRole(basics.role)
      profileIdRef.current = basics.id
      roleRef.current = basics.role
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    setLoading(true)
    void refreshInternal()
  }, [refreshInternal])

  useEffect(() => {
    if (!enabled || !profileId) return

    if (
      channelRef.current &&
      subscribedProfileRef.current === profileId
    ) {
      devLog(LOG_SUBSCRIBE, "skip — canal já ativo", { profileId })
      return
    }

    let disposed = false

    const teardownChannel = async () => {
      const ch = channelRef.current
      if (!ch) return
      channelRef.current = null
      subscribedProfileRef.current = null
      try {
        const supabase = getSupabaseClient()
        await supabase.removeChannel(ch)
        devLog(LOG_UNSUBSCRIBE, { profileId })
      } catch (e) {
        devLogError("removeChannel falhou", e instanceof Error ? e.message : String(e))
      }
    }

    const subscribe = async () => {
      await teardownChannel()
      if (disposed) return

      if (channelRef.current && subscribedProfileRef.current === profileId) {
        devLog(LOG_SUBSCRIBE, "skip pós-teardown — já inscrito", { profileId })
        return
      }

      try {
        const supabase = getSupabaseClient()
        const channelName = `notifications:${profileId}`

        devLog(LOG_SUBSCRIBE, { channelName, profileId })

        const channel = supabase
          .channel(channelName)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
              filter: `profile_id=eq.${profileId}`,
            },
            (payload) => {
              if (disposed) return
              const row = payload.new as Record<string, unknown>
              const rowProfileId =
                typeof row.profile_id === "string" ? row.profile_id : null
              const authProfileId = profileIdRef.current

              devLog(LOG_TOAST_PROFILE, {
                rowProfileId,
                authProfileId,
                match: rowProfileId === authProfileId,
              })

              if (!authProfileId || rowProfileId !== authProfileId) {
                devLog(LOG_EVENT, "INSERT ignorado — profile_id divergente", {
                  rowProfileId,
                  expected: authProfileId,
                })
                return
              }

              devLog(LOG_EVENT, "INSERT", {
                id: row.id,
                notification_type: row.notification_type,
                is_read: row.is_read,
              })

              const item = mapRealtimePayloadToNotificationItem(row)
              if (!item) {
                devLog(LOG_EVENT, "INSERT sem map — refresh")
                void refreshRef.current()
                return
              }

              setItems((prev) => {
                const without = prev.filter((n) => n.id !== item.id)
                return [item, ...without].slice(0, NOTIFICATION_RECENT_LIMIT)
              })

              if (!item.read) {
                setUnreadCount((c) => c + 1)
                showToastForRef.current(item, "realtime")
              }
            }
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "notifications",
              filter: `profile_id=eq.${profileId}`,
            },
            (payload) => {
              if (disposed) return
              const row = payload.new as Record<string, unknown>
              const rowProfileId =
                typeof row.profile_id === "string" ? row.profile_id : null

              if (rowProfileId !== profileIdRef.current) return

              devLog(LOG_EVENT, "UPDATE", { id: row.id, is_read: row.is_read })

              const item = mapRealtimePayloadToNotificationItem(row)
              if (!item) {
                void refreshRef.current()
                return
              }

              setItems((prev) => {
                const idx = prev.findIndex((n) => n.id === item.id)
                if (idx < 0) {
                  return [item, ...prev].slice(0, NOTIFICATION_RECENT_LIMIT)
                }
                const next = [...prev]
                const wasUnread = !prev[idx].read
                next[idx] = item
                if (wasUnread && item.read) {
                  setUnreadCount((c) => Math.max(0, c - 1))
                } else if (!wasUnread && !item.read) {
                  setUnreadCount((c) => c + 1)
                }
                return next
              })
            }
          )
          .subscribe((status, err) => {
            devLog(LOG_CHANNEL_STATUS, {
              profileId,
              status,
              error: err?.message ?? null,
            })
          })

        channelRef.current = channel
        subscribedProfileRef.current = profileId
      } catch (e) {
        devLogError("subscribe falhou", e instanceof Error ? e.message : String(e))
      }
    }

    void subscribe()

    return () => {
      disposed = true
      void teardownChannel()
    }
  }, [enabled, profileId])

  const markAsRead = useCallback(async (id: string) => {
    let wasUnread = false
    setItems((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n
        wasUnread = !n.read
        return { ...n, read: true, readAt: new Date() }
      })
    )
    if (wasUnread) {
      setUnreadCount((c) => Math.max(0, c - 1))
    }

    const result = await markNotificationAsRead(id)
    if (!result.ok) {
      toast.error(result.message)
      void refreshRef.current()
      return
    }
    devLog(LOG_EVENT, "markAsRead", { id })
  }, [])

  const markAllAsRead = useCallback(async () => {
    setItems((prev) =>
      prev.map((n) => ({ ...n, read: true, readAt: new Date() }))
    )
    setUnreadCount(0)

    const result = await markAllNotificationsAsRead()
    if (!result.ok) {
      toast.error(result.message)
      void refreshRef.current()
      return
    }
    devLog(LOG_EVENT, "markAllAsRead", { updated: result.updated })
  }, [])

  return {
    items,
    unreadCount,
    loading,
    refresh: refreshInternal,
    markAsRead,
    markAllAsRead,
  }
}
