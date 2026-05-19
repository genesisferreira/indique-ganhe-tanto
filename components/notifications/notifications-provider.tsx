"use client"

import { createContext, useContext, type ReactNode } from "react"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { useNotifications, type UseNotificationsResult } from "@/hooks/use-notifications"

const NotificationsContext = createContext<UseNotificationsResult | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotifications({
    enabled: !isDataProviderMock(),
    showToasts: true,
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
