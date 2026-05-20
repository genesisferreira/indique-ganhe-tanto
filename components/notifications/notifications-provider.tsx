"use client"

import { createContext, useContext, type ReactNode } from "react"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { useNotifications, type UseNotificationsResult } from "@/hooks/use-notifications"
import type { AuthProfileBasics } from "@/types/auth-profile"

const NotificationsContext = createContext<UseNotificationsResult | null>(null)

export function NotificationsProvider({
  children,
  initialProfile = null,
}: {
  children: ReactNode
  /** Perfil já resolvido no shell — evita subscribe com profileId atrasado. */
  initialProfile?: AuthProfileBasics | null
}) {
  const value = useNotifications({
    enabled: !isDataProviderMock(),
    showToasts: true,
    initialProfile,
  })

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotificationsContext(): UseNotificationsResult {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error(
      "useNotificationsContext deve ser usado dentro de NotificationsProvider"
    )
  }
  return ctx
}

/** Opcional: fora do provider retorna null (ex. páginas públicas). */
export function useNotificationsContextOptional(): UseNotificationsResult | null {
  return useContext(NotificationsContext)
}
