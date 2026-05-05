export interface Notification {
  id: string
  userId: string
  title: string
  message: string
  read: boolean
  createdAt: Date
}

export interface NotificationRepository {
  getByUser(userId: string): Promise<Notification[]>
  getUnreadCount(userId: string): Promise<number>
  markAsRead(notificationId: string): Promise<boolean>
  markAllAsRead(userId: string): Promise<boolean>
}
