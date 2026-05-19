import { resolveNotificationActionUrl } from "@/lib/notification-routes"
import type { NotificationItem } from "@/types/notification"
import type { UserRole } from "@/types/user"

/**
 * Schema real confirmado (public.notifications).
 * Queries/inserts usam APENAS estes nomes de coluna.
 */
export const NOTIFICATIONS_DB = {
  id: "id",
  profileId: "profile_id",
  notificationType: "notification_type",
  title: "title",
  message: "message",
  data: "data",
  isRead: "is_read",
  readAt: "read_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  actionUrl: "action_url",
} as const

export const NOTIFICATIONS_SELECT = [
  NOTIFICATIONS_DB.id,
  NOTIFICATIONS_DB.profileId,
  NOTIFICATIONS_DB.notificationType,
  NOTIFICATIONS_DB.title,
  NOTIFICATIONS_DB.message,
  NOTIFICATIONS_DB.data,
  NOTIFICATIONS_DB.isRead,
  NOTIFICATIONS_DB.readAt,
  NOTIFICATIONS_DB.createdAt,
  NOTIFICATIONS_DB.actionUrl,
].join(", ")

export type NotificationInsertInput = {
  profile_id: string
  title: string
  message: string
  notificationType: string
  metadata?: Record<string, unknown>
  actionUrl?: string | null
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function logMap(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[notification:map]", ...args)
}

function logError(...args: unknown[]): void {
  if (!isDev()) return
  console.warn("[notification:error]", ...args)
}

function readDataColumn(raw: Record<string, unknown>): Record<string, unknown> {
  const data = raw[NOTIFICATIONS_DB.data]
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  return {}
}

export function parseNotificationCreatedAt(raw: Record<string, unknown>): Date {
  const value = raw[NOTIFICATIONS_DB.createdAt]
  if (typeof value === "string" && value.length > 0) {
    const ms = new Date(value).getTime()
    if (Number.isFinite(ms)) return new Date(ms)
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value)
  }
  return new Date()
}

export function mapNotificationRowFromDb(
  raw: Record<string, unknown>,
  role: UserRole | null
): NotificationItem {
  const metadata = readDataColumn(raw)
  const type =
    typeof raw[NOTIFICATIONS_DB.notificationType] === "string"
      ? (raw[NOTIFICATIONS_DB.notificationType] as string)
      : typeof metadata.type === "string"
        ? metadata.type
        : "sistema"

  const title = String(raw[NOTIFICATIONS_DB.title] ?? "")
  const message = String(raw[NOTIFICATIONS_DB.message] ?? "")

  const explicitAction =
    typeof raw[NOTIFICATIONS_DB.actionUrl] === "string"
      ? (raw[NOTIFICATIONS_DB.actionUrl] as string)
      : null

  const actionUrl =
    (explicitAction && explicitAction.startsWith("/") ? explicitAction : null) ??
    resolveNotificationActionUrl(role, metadata)

  const readAtRaw = raw[NOTIFICATIONS_DB.readAt]
  const item: NotificationItem = {
    id: String(raw[NOTIFICATIONS_DB.id] ?? ""),
    title,
    message,
    type,
    metadata,
    read: Boolean(raw[NOTIFICATIONS_DB.isRead]),
    readAt:
      typeof readAtRaw === "string" && readAtRaw.length > 0
        ? new Date(readAtRaw)
        : null,
    createdAt: parseNotificationCreatedAt(raw),
    actionUrl,
  }

  logMap("row mapeada", {
    id: item.id,
    type: item.type,
    read: item.read,
  })

  return item
}

/** INSERT — somente colunas do schema real. */
export function buildNotificationInsertRow(
  payload: NotificationInsertInput
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    profile_id: payload.profile_id,
    notification_type: payload.notificationType,
    title: payload.title,
    message: payload.message,
    data: payload.metadata ?? {},
    is_read: false,
  }

  if (payload.actionUrl) {
    row.action_url = payload.actionUrl
  }

  if (isDev()) {
    console.log("[notification:create]", {
      profile_id: payload.profile_id,
      notification_type: payload.notificationType,
      title: payload.title,
    })
  }

  return row
}

export function buildNotificationMarkReadUpdate(): Record<string, unknown> {
  return {
    is_read: true,
    read_at: new Date().toISOString(),
  }
}
