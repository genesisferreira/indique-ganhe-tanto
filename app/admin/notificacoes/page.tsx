"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import {
  loadAdminNotificationsFromSupabase,
  markNotificationAsRead,
  type AdminNotificationItem,
} from "@/lib/services/supabase-data.service"

const mockNotificationsFallback: AdminNotificationItem[] = [
  {
    id: "mock-notif-001",
    title: "Alerta SLA (mock)",
    message:
      "Lead vencido por SLA sem comercial disponível. Esta é uma notificação de fallback local.",
    type: "sistema",
    isRead: false,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    referralId: "mock-referral-001",
  },
]

export default function AdminNotificacoesPage() {
  const [notifications, setNotifications] = useState<AdminNotificationItem[]>(
    mockNotificationsFallback
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isMarkingId, setIsMarkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reloadNotifications = async () => {
    setIsLoading(true)
    const remote = await loadAdminNotificationsFromSupabase()
    if (remote !== null) {
      setNotifications(remote)
      setError(null)
    } else {
      setError("Usando fallback local. Não foi possível carregar notificações reais.")
    }
    setIsLoading(false)
  }

  useEffect(() => {
    void reloadNotifications()
  }, [])

  const handleMarkAsRead = async (notificationId: string) => {
    if (isMarkingId) return

    setIsMarkingId(notificationId)
    const result = await markNotificationAsRead(notificationId)
    if (!result.ok) {
      setError(result.message)
      setIsMarkingId(null)
      return
    }

    await reloadNotifications()
    setIsMarkingId(null)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notificações Administrativas"
        description="Alertas e notificações do painel administrativo"
      />

      {error && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </div>
      )}

      <div className="rounded-xl border bg-card p-6 space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando notificações...</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma notificação encontrada.
          </p>
        ) : (
          notifications.map((notification) => (
            <div
              key={notification.id}
              className="rounded-lg border border-border p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {notification.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {notification.message}
                  </p>
                </div>
                {!notification.isRead && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isMarkingId === notification.id}
                    onClick={() => {
                      void handleMarkAsRead(notification.id)
                    }}
                  >
                    {isMarkingId === notification.id
                      ? "Marcando..."
                      : "Marcar como lida"}
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Tipo: {notification.type}</span>
                <span>Lida: {notification.isRead ? "Sim" : "Não"}</span>
                <span>
                  Data:{" "}
                  {notification.createdAt.toLocaleDateString("pt-BR")} às{" "}
                  {notification.createdAt.toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span>Referral: {notification.referralId ?? "—"}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
