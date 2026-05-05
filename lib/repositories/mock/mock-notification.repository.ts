import type {
  Notification,
  NotificationRepository,
} from "@/lib/repositories/contracts/notification.repository"

const notifications: Notification[] = []

export const mockNotificationRepository: NotificationRepository = {
  async getByUser(userId) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    return notifications.filter((item) => item.userId === userId)
  },

  async getUnreadCount(userId) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return notifications.filter((item) => item.userId === userId && !item.read).length
  },

  async markAsRead(notificationId) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const notification = notifications.find((item) => item.id === notificationId)
    if (!notification) return false
    notification.read = true
    return true
  },

  async markAllAsRead(userId) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    notifications.forEach((item) => {
      if (item.userId === userId) item.read = true
    })
    return true
  },
}
