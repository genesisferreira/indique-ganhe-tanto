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

/** Realtime/postgREST podem enviar UUID como string; normaliza para comparação. */
export function normalizeNotificationId(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim()
    return t.length > 0 ? t : null
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

export function extractNotificationFieldsFromRow(raw: Record<string, unknown>): {
  id: string | null
  profileId: string | null
  notificationType: string | null
  title: string | null
  action: string | null
  isRead: boolean
  actionUrl: string | null
} {
  const metadata = readDataColumn(raw)
  const action =
    typeof metadata.action === "string" ? metadata.action : null
  const explicitActionUrl =
    typeof raw[NOTIFICATIONS_DB.actionUrl] === "string"
      ? (raw[NOTIFICATIONS_DB.actionUrl] as string)
      : null

  return {
    id: normalizeNotificationId(raw[NOTIFICATIONS_DB.id]),
    profileId: normalizeNotificationId(raw[NOTIFICATIONS_DB.profileId]),
    notificationType:
      typeof raw[NOTIFICATIONS_DB.notificationType] === "string"
        ? (raw[NOTIFICATIONS_DB.notificationType] as string)
        : null,
    title:
      typeof raw[NOTIFICATIONS_DB.title] === "string"
        ? (raw[NOTIFICATIONS_DB.title] as string)
        : null,
    action,
    isRead: parseNotificationIsRead(raw),
    actionUrl:
      explicitActionUrl && explicitActionUrl.startsWith("/")
        ? explicitActionUrl
        : null,
  }
}

const LOG_MAPPED = "[notifications:event:mapped]"

function logMapped(...args: unknown[]): void {
  if (!isDev()) return
  console.log(LOG_MAPPED, ...args)
}

/** Realtime pode enviar boolean, string ou número em `is_read`. */
export function parseNotificationIsRead(raw: Record<string, unknown>): boolean {
  const v = raw[NOTIFICATIONS_DB.isRead]
  if (v === true || v === "true" || v === 1 || v === "t") return true
  if (v === false || v === "false" || v === 0 || v === "f") return false
  return false
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
): NotificationItem | null {
  const fields = extractNotificationFieldsFromRow(raw)
  if (!fields.id) {
    logError("map sem id", { rawKeys: Object.keys(raw) })
    return null
  }

  const metadata = readDataColumn(raw)
  const type =
    fields.notificationType ??
    (typeof metadata.type === "string" ? metadata.type : "sistema")

  const title = String(raw[NOTIFICATIONS_DB.title] ?? "")
  const message = String(raw[NOTIFICATIONS_DB.message] ?? "")

  const actionUrl =
    fields.actionUrl ?? resolveNotificationActionUrl(role, metadata)

  const readAtRaw = raw[NOTIFICATIONS_DB.readAt]
  const item: NotificationItem = {
    id: fields.id,
    title,
    message,
    type,
    metadata,
    read: fields.isRead,
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
    action: fields.action,
    read: item.read,
    actionUrl: item.actionUrl,
  })

  logMapped({
    id: item.id,
    profileId: fields.profileId,
    notificationType: type,
    action: fields.action,
    title: item.title,
    read: item.read,
    actionUrl: item.actionUrl,
    role,
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
