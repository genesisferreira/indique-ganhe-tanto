import type { NotificationRepository } from "@/lib/repositories/contracts/notification.repository"

export const supabaseNotificationRepository: NotificationRepository = {
  async getByUser() {
    throw new Error("supabaseNotificationRepository.getByUser not implemented")
  },
  async getUnreadCount() {
    throw new Error("supabaseNotificationRepository.getUnreadCount not implemented")
  },
  async markAsRead() {
    throw new Error("supabaseNotificationRepository.markAsRead not implemented")
  },
  async markAllAsRead() {
    throw new Error("supabaseNotificationRepository.markAllAsRead not implemented")
  },
}
