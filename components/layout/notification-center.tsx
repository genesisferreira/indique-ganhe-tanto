"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Bell,
  BellRing,
  Wallet,
  Gift,
  FileText,
  Shield,
  Users,
  CreditCard,
  Inbox,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useNotificationsContextOptional } from "@/components/notifications/notifications-provider"
import {
  getNotificationTimeGroup,
  notificationTimeGroupLabel,
  formatRelativeNotificationTime,
  type NotificationTimeGroup,
} from "@/lib/notification-time"
import type { NotificationItem } from "@/types/notification"

const GROUP_ORDER: NotificationTimeGroup[] = [
  "agora",
  "hoje",
  "ontem",
  "semana",
  "anteriores",
]

function iconForType(type: string) {
  switch (type) {
    case "carteira":
      return Wallet
    case "recompensa":
      return Gift
    case "pagamento":
      return CreditCard
    case "indicacao":
      return Users
    case "seguranca":
      return Shield
    default:
      return FileText
  }
}

function capUnread(n: number): string {
  return n > 99 ? "99+" : String(n)
}

function groupNotifications(items: NotificationItem[]) {
  const map = new Map<NotificationTimeGroup, NotificationItem[]>()
  for (const g of GROUP_ORDER) map.set(g, [])
  for (const item of items) {
    const g = getNotificationTimeGroup(item.createdAt)
    map.get(g)!.push(item)
  }
  return GROUP_ORDER.filter((g) => (map.get(g)?.length ?? 0) > 0).map((g) => ({
    group: g,
    items: map.get(g)!,
  }))
}

function NotificationSkeleton() {
  return (
    <div className="space-y-3 p-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex gap-3 rounded-lg border border-border/40 bg-muted/20 p-3 animate-pulse"
        >
          <div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="h-2 w-full rounded bg-muted/80" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function NotificationCenter({ className }: { className?: string }) {
  const router = useRouter()
  const ctx = useNotificationsContextOptional()
  const [open, setOpen] = useState(false)
  const [pulse, setPulse] = useState(false)
  const prevUnreadRef = useRef(0)

  const items = ctx?.items ?? []
  const unreadCount = ctx?.unreadCount ?? 0
  const loading = ctx?.loading ?? false

  const grouped = useMemo(() => groupNotifications(items), [items])

  useEffect(() => {
    if (unreadCount > prevUnreadRef.current) {
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 600)
      prevUnreadRef.current = unreadCount
      return () => clearTimeout(t)
    }
    prevUnreadRef.current = unreadCount
  }, [unreadCount])

  const handleOpenItem = async (item: NotificationItem) => {
    if (!item.read && ctx) {
      await ctx.markAsRead(item.id)
    }
    setOpen(false)
    if (item.actionUrl) {
      router.push(item.actionUrl)
    } else {
      router.push("/notificacoes")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent",
            pulse && "animate-[pulse_0.6s_ease-in-out_1]",
            className
          )}
          aria-label={
            unreadCount > 0
              ? `Notificações, ${unreadCount} não lidas`
              : "Notificações"
          }
        >
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5 text-amber-400/90" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full",
                "bg-amber-500 px-1 text-[10px] font-bold text-amber-950",
                "ring-2 ring-sidebar shadow-[0_0_10px_rgba(234,179,8,0.45)]"
              )}
            >
              {capUnread(unreadCount)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="right"
        sideOffset={8}
        className="w-[min(100vw-2rem,380px)] border-border/60 bg-card/95 p-0 shadow-xl backdrop-blur-md"
      >
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Notificações</p>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0
                ? `${unreadCount} não lida${unreadCount > 1 ? "s" : ""}`
                : "Tudo em dia"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {ctx && unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void ctx.markAllAsRead()}
              >
                Marcar todas
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
              <Link href="/notificacoes" onClick={() => setOpen(false)}>
                Ver todas
              </Link>
            </Button>
          </div>
        </div>

        {loading ? (
          <NotificationSkeleton />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
              <Inbox className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">Nenhuma notificação</p>
            <p className="text-xs text-muted-foreground max-w-[240px]">
              Você será avisado aqui sobre indicações, recompensas e pagamentos.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[min(70vh,420px)]">
            <div className="p-2 space-y-4">
              {grouped.map(({ group, items: groupItems }) => (
                <section key={group}>
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {notificationTimeGroupLabel(group)}
                  </p>
                  <ul className="space-y-1">
                    {groupItems.map((item) => {
                      const Icon = iconForType(item.type)
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => void handleOpenItem(item)}
                            className={cn(
                              "flex w-full gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-200",
                              "hover:bg-muted/60",
                              !item.read &&
                                "bg-amber-500/5 ring-1 ring-amber-500/20 hover:bg-amber-500/10"
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                                !item.read
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p
                                  className={cn(
                                    "text-sm leading-snug truncate",
                                    !item.read
                                      ? "font-semibold text-foreground"
                                      : "font-medium text-foreground/90"
                                  )}
                                >
                                  {item.title}
                                </p>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {formatRelativeNotificationTime(item.createdAt)}
                                </span>
                              </div>
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                {item.message}
                              </p>
                              {!item.read && (
                                <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
                              )}
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
