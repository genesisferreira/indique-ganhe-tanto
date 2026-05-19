export type NotificationTimeGroup = "agora" | "hoje" | "ontem" | "semana" | "anteriores"

const GROUP_LABELS: Record<NotificationTimeGroup, string> = {
  agora: "Agora",
  hoje: "Hoje",
  ontem: "Ontem",
  semana: "Esta semana",
  anteriores: "Anteriores",
}

export function notificationTimeGroupLabel(group: NotificationTimeGroup): string {
  return GROUP_LABELS[group]
}

export function getNotificationTimeGroup(date: Date, now = new Date()): NotificationTimeGroup {
  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 60_000) return "agora"
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() - 7)

  if (date >= startOfToday) return "hoje"
  if (date >= startOfYesterday) return "ontem"
  if (date >= startOfWeek) return "semana"
  return "anteriores"
}

export function formatRelativeNotificationTime(date: Date, now = new Date()): string {
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diffSec < 60) return "agora"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return "ontem"
  if (diffD < 7) return `${diffD} dias`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}
