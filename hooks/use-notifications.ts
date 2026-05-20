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
import { NOTIFICATIONS_SELECT } from "@/lib/notifications-db-map"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { AuthProfileBasics } from "@/types/auth-profile"
import type { NotificationItem } from "@/types/notification"
import type { UserRole } from "@/types/user"
import type { RealtimeChannel } from "@supabase/supabase-js"

const LOG_ERROR = "[notification:error]"
const LOG_SUBSCRIBE = "[notifications:subscribe]"
const LOG_UNSUBSCRIBE = "[notifications:unsubscribe]"
const LOG_EVENT = "[notifications:event]"
const LOG_PROFILE_CHECK = "[notifications:profile-check]"
const LOG_CHANNEL_STATUS = "[notifications:channel-status]"
const LOG_PAYMENTS_BRIDGE = "[notifications:payments-bridge]"
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
  /** Perfil do shell — subscribe imediato com id correto (profiles.id). */
  initialProfile?: AuthProfileBasics | null
}

function isAdminFinanceRole(role: UserRole | null): boolean {
  return role === "admin_financeiro" || role === "admin_master"
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
  const initialProfile = options.initialProfile ?? null
  const router = useRouter()

  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<UserRole | null>(initialProfile?.role ?? null)
  const [profileId, setProfileId] = useState<string | null>(initialProfile?.id ?? null)

  const mountAtRef = useRef(Date.now())
  const toastedIdsRef = useRef(new Set<string>())
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const paymentsBridgeRef = useRef<RealtimeChannel | null>(null)
  const subscribedProfileRef = useRef<string | null>(null)
  const processedNotificationIdsRef = useRef(new Set<string>())

  const profileIdRef = useRef<string | null>(initialProfile?.id ?? null)
  const authUserIdRef = useRef<string | null>(null)
  const roleRef = useRef<UserRole | null>(initialProfile?.role ?? null)
  const itemsRef = useRef<NotificationItem[]>([])
  const showToastsRef = useRef(showToasts)
  const routerRef = useRef(router)

  profileIdRef.current = profileId
  roleRef.current = role
  itemsRef.current = items
  showToastsRef.current = showToasts
  routerRef.current = router

  if (initialProfile?.id && profileIdRef.current !== initialProfile.id) {
    profileIdRef.current = initialProfile.id
    roleRef.current = initialProfile.role
  }

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
      const supabase = getSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        authUserIdRef.current = user.id
      }

      const basics = initialProfile ?? (await getAuthProfileBasicsFromSupabase())
      if (cancelled || !basics) return
      setProfileId(basics.id)
      setRole(basics.role)
      profileIdRef.current = basics.id
      roleRef.current = basics.role
      if (user) {
        devLog(LOG_PROFILE_CHECK, {
          currentProfileId: basics.id,
          authUserId: user.id,
          profilesMatchAuth: basics.id === user.id,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, initialProfile?.id, initialProfile?.role])

  useEffect(() => {
    setLoading(true)
    void refreshInternal()
  }, [refreshInternal])

  const processNotificationRowRef = useRef<
    (row: Record<string, unknown>, source: "realtime" | "payments-bridge") => void
  >(() => {})

  processNotificationRowRef.current = (
    row: Record<string, unknown>,
    source: "realtime" | "payments-bridge"
  ) => {
    const rowProfileId =
      typeof row.profile_id === "string" ? row.profile_id : null
    const currentProfileId = profileIdRef.current
    const authUserId = authUserIdRef.current
    const matches =
      Boolean(rowProfileId) &&
      Boolean(currentProfileId) &&
      (rowProfileId === currentProfileId ||
        (authUserId != null && rowProfileId === authUserId))

    devLog(LOG_PROFILE_CHECK, {
      source,
      payloadProfileId: rowProfileId,
      currentProfileId,
      authUserId,
      matches,
    })

    if (!matches) {
      devLog(LOG_EVENT, "INSERT ignorado — profile_id não é do usuário atual", {
        rowProfileId,
        currentProfileId,
        authUserId,
      })
      return
    }

    const notificationId = typeof row.id === "string" ? row.id : null
    if (notificationId && processedNotificationIdsRef.current.has(notificationId)) {
      devLog(LOG_EVENT, "INSERT ignorado — já processado", { notificationId, source })
      return
    }

    devLog(LOG_EVENT, "INSERT", {
      source,
      id: row.id,
      notification_type: row.notification_type,
      is_read: row.is_read,
    })

    const rowData =
      row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {}
    if (
      isDev() &&
      rowData.action === "pix_withdrawal_requested" &&
      isAdminFinanceRole(roleRef.current)
    ) {
      console.log("[notification:pix-admin]", {
        source,
        id: row.id,
        notification_type: row.notification_type,
        payment_id: rowData.payment_id ?? null,
        action_url: row.action_url ?? null,
      })
    }

    const item = mapRealtimePayloadToNotificationItem(row, roleRef.current)
    if (!item) {
      devLog(LOG_EVENT, "INSERT sem map — refresh", { source })
      void refreshRef.current()
      return
    }

    if (notificationId) {
      processedNotificationIdsRef.current.add(notificationId)
    }

    const alreadyInList = itemsRef.current.some((n) => n.id === item.id)
    setItems((prev) => {
      const without = prev.filter((n) => n.id !== item.id)
      return [item, ...without].slice(0, NOTIFICATION_RECENT_LIMIT)
    })

    if (!item.read) {
      if (!alreadyInList) {
        setUnreadCount((c) => c + 1)
      }
      showToastForRef.current(item, "realtime")
    }
  }

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
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          authUserIdRef.current = user.id
        }

        const channelName = `notifications:${profileId}`
        const useBroadSubscribe = isAdminFinanceRole(roleRef.current)

        devLog(LOG_SUBSCRIBE, {
          channelName,
          profileId,
          authUserId: authUserIdRef.current,
          useBroadSubscribe,
        })

        const insertConfig: {
          event: "INSERT"
          schema: "public"
          table: "notifications"
          filter?: string
        } = {
          event: "INSERT",
          schema: "public",
          table: "notifications",
        }
        if (!useBroadSubscribe) {
          insertConfig.filter = `profile_id=eq.${profileId}`
        }

        const channel = supabase
          .channel(channelName)
          .on(
            "postgres_changes",
            insertConfig,
            (payload) => {
              if (disposed) return
              processNotificationRowRef.current(
                payload.new as Record<string, unknown>,
                "realtime"
              )
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

              const item = mapRealtimePayloadToNotificationItem(row, roleRef.current)
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
  }, [enabled, profileId, role])

  /** Fallback: fila de pagamentos já tem realtime; notifications pode não estar na publication. */
  useEffect(() => {
    if (!enabled || !profileId || !isAdminFinanceRole(role)) return

    let disposed = false

    const teardown = async () => {
      const ch = paymentsBridgeRef.current
      if (!ch) return
      paymentsBridgeRef.current = null
      try {
        const supabase = getSupabaseClient()
        await supabase.removeChannel(ch)
        devLog(LOG_PAYMENTS_BRIDGE, "unsubscribe", { profileId })
      } catch {
        // ignore
      }
    }

    const subscribe = async () => {
      await teardown()
      if (disposed) return

      try {
        const supabase = getSupabaseClient()
        const channelName = `notifications:bridge:payments:${profileId}`
        devLog(LOG_PAYMENTS_BRIDGE, "subscribe", { channelName })

        const channel = supabase
          .channel(channelName)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "payments",
            },
            (payload) => {
              if (disposed) return
              const row = payload.new as Record<string, unknown>
              if (row.payment_kind !== "pix_withdrawal") return
              if (row.status !== "pendente") return

              devLog(LOG_PAYMENTS_BRIDGE, "payment INSERT pix_withdrawal", {
                paymentId: row.id,
              })

              void (async () => {
                const pid = profileIdRef.current
                if (!pid) return
                const { data, error } = await supabase
                  .from("notifications")
                  .select(NOTIFICATIONS_SELECT)
                  .eq("profile_id", pid)
                  .eq("notification_type", "pagamento")
                  .eq("is_read", false)
                  .order("created_at", { ascending: false })
                  .limit(3)

                if (error) {
                  devLogError("bridge fetch notifications", error.message)
                  return
                }

                for (const raw of (data ?? []) as Record<string, unknown>[]) {
                  const meta =
                    raw.data &&
                    typeof raw.data === "object" &&
                    !Array.isArray(raw.data)
                      ? (raw.data as Record<string, unknown>)
                      : {}
                  if (meta.action !== "pix_withdrawal_requested") continue
                  if (
                    meta.payment_id != null &&
                    row.id != null &&
                    String(meta.payment_id) !== String(row.id)
                  ) {
                    continue
                  }
                  processNotificationRowRef.current(raw, "payments-bridge")
                  break
                }
              })()
            }
          )
          .subscribe((status, err) => {
            devLog(LOG_PAYMENTS_BRIDGE, "status", {
              status,
              error: err?.message ?? null,
            })
          })

        paymentsBridgeRef.current = channel
      } catch (e) {
        devLogError("payments bridge subscribe", e instanceof Error ? e.message : String(e))
      }
    }

    void subscribe()

    return () => {
      disposed = true
      void teardown()
    }
  }, [enabled, profileId, role])

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
