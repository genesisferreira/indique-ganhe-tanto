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
import {
  extractNotificationFieldsFromRow,
  NOTIFICATIONS_SELECT,
} from "@/lib/notifications-db-map"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { AuthProfileBasics } from "@/types/auth-profile"
import type { NotificationItem } from "@/types/notification"
import type { UserRole } from "@/types/user"
import type { RealtimeChannel } from "@supabase/supabase-js"

const LOG_ERROR = "[notification:error]"
const LOG_SUBSCRIBE = "[notifications:subscribe]"
const LOG_UNSUBSCRIBE = "[notifications:unsubscribe]"
const LOG_EVENT_RAW = "[notifications:event:raw]"
const LOG_EVENT_MAPPED = "[notifications:event:mapped]"
const LOG_PROFILE_MATCH = "[notifications:profile-match]"
const LOG_EVENT_ACCEPTED = "[notifications:event:accepted]"
const LOG_EVENT_IGNORED = "[notifications:event:ignored]"
const LOG_TOAST = "[notifications:toast]"
const LOG_STATE_INSERT = "[notifications:state-insert]"
const LOG_STATE_UPDATE = "[notifications:state-update]"
const LOG_CHANNEL_STATUS = "[notifications:channel-status]"
const LOG_PAYMENTS_BRIDGE = "[notifications:payments-bridge]"

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

/** Preserva itens recebidos via realtime quando o poll ainda não os enxerga. */
function mergeNotificationLists(
  remote: NotificationItem[],
  local: NotificationItem[],
  limit: number
): NotificationItem[] {
  const byId = new Map<string, NotificationItem>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return [...byId.values()]
    .sort((a, b) => createdAtMs(b) - createdAtMs(a))
    .slice(0, limit)
}

function countUnread(items: NotificationItem[]): number {
  return items.filter((n) => !n.read).length
}

function profileIdsMatch(
  payloadProfileId: string | null,
  currentProfileId: string | null,
  authUserId: string | null
): boolean {
  if (!payloadProfileId || !currentProfileId) return false
  const a = payloadProfileId.toLowerCase()
  const b = currentProfileId.toLowerCase()
  if (a === b) return true
  if (authUserId && a === authUserId.toLowerCase()) return true
  return false
}

type SubscribeMode = "filtered"

function subscribeModeForRole(_role: UserRole | null): SubscribeMode {
  return "filtered"
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
  const subscribedModeRef = useRef<SubscribeMode | null>(null)

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

      if (!showToastsRef.current) {
        devLog(LOG_TOAST, { action: "skip", reason: "showToasts desligado", id: item.id, source })
        return
      }

      if (item.read) {
        devLog(LOG_TOAST, { action: "skip", reason: "já lida", id: item.id, source })
        return
      }

      if (toastedIdsRef.current.has(item.id)) {
        devLog(LOG_TOAST, { action: "skip", reason: "duplicate", id: item.id, source })
        return
      }

      const createdMs = createdAtMs(item)
      const mountAt = mountAtRef.current

      if (source === "poll") {
        if (!Number.isFinite(createdMs)) {
          devLog(LOG_TOAST, { action: "skip", reason: "createdAt inválido", id: item.id, source })
          return
        }
        if (createdMs < mountAt - CREATED_AT_SKEW_MS) {
          devLog(LOG_TOAST, {
            action: "skip",
            reason: "anterior ao mount (poll)",
            id: item.id,
            createdMs,
            mountAt,
            source,
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
      devLog(LOG_TOAST, {
        action: "show",
        id: item.id,
        title: payload.title,
        actionUrl: payload.actionUrl,
        source,
        profileId: authProfileId,
        role: roleRef.current,
      })
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
      let mergedSnapshot: NotificationItem[] = []
      setItems((prev) => {
        mergedSnapshot = mergeNotificationLists(
          recent,
          prev,
          NOTIFICATION_RECENT_LIMIT
        )
        devLog(LOG_STATE_UPDATE, {
          source: "refresh",
          remote: recent.length,
          local: prev.length,
          merged: mergedSnapshot.length,
          unreadFromServer: unread,
          unreadMerged: countUnread(mergedSnapshot),
        })
        return mergedSnapshot
      })
      setUnreadCount(Math.max(unread, countUnread(mergedSnapshot)))
      if (basics) {
        setRole(basics.role)
        setProfileId(basics.id)
        profileIdRef.current = basics.id
        roleRef.current = basics.role
      }
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
    if (!initialProfile?.id) return
    setProfileId(initialProfile.id)
    setRole(initialProfile.role)
    profileIdRef.current = initialProfile.id
    roleRef.current = initialProfile.role
  }, [initialProfile?.id, initialProfile?.role])

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
        devLog(LOG_PROFILE_MATCH, {
          currentProfileId: basics.id,
          authUserId: user.id,
          profilesMatchAuth: basics.id === user.id,
          role: basics.role,
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
    const fields = extractNotificationFieldsFromRow(row)
    const currentProfileId = profileIdRef.current
    const authUserId = authUserIdRef.current
    const matches = profileIdsMatch(
      fields.profileId,
      currentProfileId,
      authUserId
    )

    devLog(LOG_PROFILE_MATCH, {
      source,
      payloadProfileId: fields.profileId,
      expectedProfileId: currentProfileId,
      authUserId,
      profilesMatchAuth:
        currentProfileId?.toLowerCase() === authUserId?.toLowerCase(),
      matches,
      notificationType: fields.notificationType,
      action: fields.action,
      title: fields.title,
    })

    if (!matches) {
      devLog(LOG_EVENT_IGNORED, {
        reason: "profile_id mismatch",
        source,
        payloadProfileId: fields.profileId,
        expectedProfileId: currentProfileId,
        notificationType: fields.notificationType,
        action: fields.action,
        title: fields.title,
      })
      return
    }

    const item = mapRealtimePayloadToNotificationItem(row, roleRef.current)
    if (!item) {
      devLog(LOG_EVENT_IGNORED, {
        reason: "map failed (id ausente ou inválido)",
        source,
        id: fields.id,
        notificationType: fields.notificationType,
        action: fields.action,
        rawKeys: Object.keys(row),
      })
      void refreshRef.current()
      return
    }

    devLog(LOG_EVENT_MAPPED, {
      source,
      id: item.id,
      type: item.type,
      action: fields.action,
      read: item.read,
      actionUrl: item.actionUrl,
      title: item.title,
    })

    const alreadyInList = itemsRef.current.some((n) => n.id === item.id)
    const wasUnreadInList = itemsRef.current.some(
      (n) => n.id === item.id && !n.read
    )

    setItems((prev) => {
      const without = prev.filter((n) => n.id !== item.id)
      const next = [item, ...without].slice(0, NOTIFICATION_RECENT_LIMIT)
      devLog(LOG_STATE_INSERT, {
        source,
        id: item.id,
        notificationType: item.type,
        action: fields.action,
        is_read: item.read,
        alreadyInList,
        total: next.length,
        title: item.title,
      })
      return next
    })

    if (!item.read) {
      if (!alreadyInList || !wasUnreadInList) {
        setUnreadCount((c) => c + 1)
      }
      showToastForRef.current(item, "realtime")
    } else {
      devLog(LOG_TOAST, {
        action: "skip",
        reason: "is_read=true no payload",
        id: item.id,
        source,
      })
    }

    const metadataAction =
      item.metadata && typeof item.metadata.action === "string"
        ? item.metadata.action
        : null

    devLog(LOG_EVENT_ACCEPTED, {
      source,
      id: item.id,
      type: item.type,
      read: item.read,
      actionUrl: item.actionUrl,
      metadataAction,
      notificationType: fields.notificationType,
      title: item.title,
    })
  }

  useEffect(() => {
    if (!enabled || !profileId) return

    const mode = subscribeModeForRole(role)
    if (
      channelRef.current &&
      subscribedProfileRef.current === profileId &&
      subscribedModeRef.current === mode
    ) {
      devLog(LOG_SUBSCRIBE, "skip — canal já ativo", { profileId, mode })
      return
    }

    let disposed = false

    const teardownChannel = async () => {
      const ch = channelRef.current
      if (!ch) return
      channelRef.current = null
      subscribedProfileRef.current = null
      subscribedModeRef.current = null
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
        devLog(LOG_SUBSCRIBE, {
          channelName,
          profileId,
          authUserId: authUserIdRef.current,
          role: roleRef.current,
          filter: `profile_id=eq.${profileId}`,
          mode,
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
          filter: `profile_id=eq.${profileId}`,
        }

        const channel = supabase
          .channel(channelName)
          .on(
            "postgres_changes",
            insertConfig,
            (payload) => {
              if (disposed) return
              const row = payload.new as Record<string, unknown>
              const fields = extractNotificationFieldsFromRow(row)
              devLog(LOG_EVENT_RAW, {
                eventType: payload.eventType,
                table: payload.table,
                id: fields.id,
                profile_id: fields.profileId,
                notification_type: fields.notificationType,
                title: fields.title,
                is_read: fields.isRead,
                action: fields.action,
                action_url: fields.actionUrl,
                data: row.data ?? null,
                expectedProfileId: profileIdRef.current,
              })
              processNotificationRowRef.current(row, "realtime")
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
              const fields = extractNotificationFieldsFromRow(row)

              if (
                !profileIdsMatch(
                  fields.profileId,
                  profileIdRef.current,
                  authUserIdRef.current
                )
              ) {
                devLog(LOG_EVENT_IGNORED, {
                  reason: "profile_id mismatch (UPDATE)",
                  id: fields.id,
                  payloadProfileId: fields.profileId,
                })
                return
              }

              devLog(LOG_EVENT_RAW, {
                eventType: "UPDATE",
                id: row.id ?? null,
                profile_id: row.profile_id ?? null,
                is_read: row.is_read ?? null,
              })

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
        subscribedModeRef.current = mode
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
    devLog(LOG_STATE_UPDATE, { source: "markAsRead", id })
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
    devLog(LOG_STATE_UPDATE, { source: "markAllAsRead", updated: result.updated })
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
