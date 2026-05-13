/**
 * Notificação interna (tabela `notifications`) para a Central do usuário.
 */
export type NotificationItem = {
  id: string
  title: string
  message: string
  notificationType: string
  data: Record<string, unknown>
  isRead: boolean
  readAt: Date | null
  createdAt: Date
}
