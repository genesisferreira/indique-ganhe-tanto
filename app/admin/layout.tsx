"use client"

import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthenticatedDashboardShell variant="admin">
      {children}
    </AuthenticatedDashboardShell>
  )
}
