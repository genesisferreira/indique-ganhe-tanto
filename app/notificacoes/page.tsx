"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  getAuthProfileBasicsFromSupabase,
  loadUserNotificationsFromSupabase,
  markAllUserNotificationsAsRead,
  markUserNotificationAsRead,
} from "@/lib/services/supabase-data.service"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { useRealtimeReload } from "@/hooks/use-supabase-realtime"
import type { NotificationItem } from "@/types/notification"
import type { UserRole } from "@/types/user"
import { ExternalLink } from "lucide-react"

const MOCK_FALLBACK: NotificationItem[] = [
  {
    id: "mock-demo-1",
    title: "Recompensa gerada (exemplo)",
    message:
      "Sua indicação foi aprovada e uma recompensa foi gerada. Ela será liberada após confirmação da primeira mensalidade.",
    notificationType: "recompensa",
    data: {},
    isRead: false,
    readAt: null,
    createdAt: new Date(),
  },
]

function strData(data: Record<string, unknown>, key: string): string | null {
  const v = data[key]
  return typeof v === "string" && v.length > 0 ? v : null
}

function referralHref(role: UserRole | null, referralId: string): string | null {
  if (!referralId) return null
  if (role === "indicador") return `/indicador/indicacoes/${referralId}`
  if (role === "comercial") return `/comercial/leads/${referralId}`
  if (
    role === "admin_consulta" ||
    role === "admin_financeiro" ||
    role === "admin_master"
  ) {
    return "/admin/indicacoes"
  }
  return null
}

function paymentHref(role: UserRole | null): string | null {
  if (role === "indicador") return "/indicador/pagamentos"
  if (
    role === "admin_consulta" ||
    role === "admin_financeiro" ||
    role === "admin_master"
  ) {
    return "/admin/pagamentos-pendentes"
  }
  return null
}

function tipoLabel(t: string): string {
  const map: Record<string, string> = {
    sistema: "Sistema",
    indicacao: "Indicação",
    pagamento: "Pagamento",
    recompensa: "Recompensa",
    carteira: "Carteira",
    seguranca: "Segurança",
  }
  return map[t] ?? t
}

export default function NotificacoesPage() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [source, setSource] = useState<"supabase" | "mock">("supabase")
  const [role, setRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const [remote, basics] = await Promise.all([
      loadUserNotificationsFromSupabase(),
      getAuthProfileBasicsFromSupabase(),
    ])
    setRole(basics?.role ?? null)
    if (remote !== null) {
      setItems(remote)
      setSource("supabase")
    } else if (isDataProviderMock()) {
      setItems(MOCK_FALLBACK)
      setSource("mock")
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[user-notifications:page]",
          "Supabase indisponível — exibindo fallback mock (DATA_PROVIDER=mock)"
        )
      }
    } else {
      setItems([])
      setSource("supabase")
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[user-notifications:page]",
          "Supabase não retornou lista; exibindo vazio (sem mock de notificações)"
        )
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useRealtimeReload(reload, ["notifications"], {
    enabled: !isDataProviderMock(),
  })

  const onMarkOne = async (id: string) => {
    if (source === "mock" && id.startsWith("mock-")) {
      setItems((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, isRead: true, readAt: new Date() } : n
        )
      )
      toast.success("Marcada como lida (demonstração).")
      return
    }
    const r = await markUserNotificationAsRead(id)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success("Marcada como lida.")
    await reload()
  }

  const onMarkAll = async () => {
    if (source === "mock") {
      setItems((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date() }))
      )
      toast.success("Todas marcadas como lidas (demonstração).")
      return
    }
    const r = await markAllUserNotificationsAsRead()
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.updated === 0
        ? "Não havia notificações não lidas."
        : `${r.updated} notificação(ões) marcada(s) como lidas.`
    )
    await reload()
  }

  const unread = items.filter((n) => !n.isRead).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notificações"
        description={
          source === "mock"
            ? "Modo demonstração (Supabase indisponível ou sem sessão)."
            : "Mensagens do sistema sobre recompensas e saques Pix."
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void onMarkAll()} disabled={loading}>
          Marcar todas como lidas
        </Button>
        {source === "mock" && (
          <Badge variant="secondary" className="text-xs">
            Mock
          </Badge>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando notificações…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma notificação por enquanto.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => {
            const referralId = strData(n.data, "referral_id")
            const paymentId = strData(n.data, "payment_id")
            const rewardId = strData(n.data, "reward_id")
            const refLink = referralId ? referralHref(role, referralId) : null
            const payLink = paymentId ? paymentHref(role) : null

            return (
              <li key={n.id}>
                <Card className={!n.isRead ? "border-primary/30" : undefined}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground">{n.title}</h3>
                          {!n.isRead && (
                            <Badge variant="default" className="text-xs shrink-0">
                              Não lida
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs shrink-0">
                            {tipoLabel(n.notificationType)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {n.message}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {n.createdAt.toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        disabled={n.isRead}
                        onClick={() => void onMarkOne(n.id)}
                      >
                        Marcar como lida
                      </Button>
                    </div>

                    {(refLink || payLink || rewardId) && (
                      <div className="flex flex-wrap gap-2 text-xs pt-1 border-t border-border/60">
                        {refLink && referralId && (
                          <Button variant="link" size="sm" className="h-auto p-0" asChild>
                            <Link href={refLink}>
                              Ver indicação
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        )}
                        {payLink && paymentId && (
                          <Button variant="link" size="sm" className="h-auto p-0" asChild>
                            <Link href={payLink}>
                              Pagamentos
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        )}
                        {rewardId && (
                          <span className="text-muted-foreground self-center">
                            Recompensa: {rewardId.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && source === "supabase" && process.env.NODE_ENV === "development" && (
        <p className="text-xs text-muted-foreground">
          Carregadas: {items.length} · Não lidas: {unread}
        </p>
      )}
    </div>
  )
}
