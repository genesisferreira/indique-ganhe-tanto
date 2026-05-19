/**
 * Notificação interna (tabela `notifications`).
 * Campos do app mapeados do banco: notification_type→type, data→metadata, is_read→read.
 */
export type NotificationItem = {
  id: string
  title: string
  message: string
  /** Mapeado de `notification_type`. */
  type: string
  /** Mapeado de `data` (jsonb). */
  metadata: Record<string, unknown>
  /** Mapeado de `is_read`. */
  read: boolean
  readAt: Date | null
  createdAt: Date
  actionUrl: string | null
}

export type NotificationToastPayload = {
  id: string
  title: string
  message: string
  actionUrl: string | null
}
