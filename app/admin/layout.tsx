"use client"

import { DashboardLayout } from "@/components/layout/dashboard-layout"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardLayout userRole="admin">
      {children}
    </DashboardLayout>
  )
}
