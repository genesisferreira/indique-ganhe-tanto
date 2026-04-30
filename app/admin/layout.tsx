"use client"

import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { currentAdmin } from "@/lib/mock-data"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardLayout 
      variant="admin" 
      userName={currentAdmin.nome}
      userRole="Administrador"
    >
      {children}
    </DashboardLayout>
  )
}
