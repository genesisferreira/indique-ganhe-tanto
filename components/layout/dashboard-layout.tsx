"use client"

import { Sidebar } from "./sidebar"

interface DashboardLayoutProps {
  children: React.ReactNode
  variant: "indicador" | "comercial" | "admin"
  userName: string
  userRole: string
}

export function DashboardLayout({
  children,
  variant,
  userName,
  userRole,
}: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar variant={variant} userName={userName} userRole={userRole} />
      <main className="flex-1 pt-14 lg:pt-0">
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  )
}
