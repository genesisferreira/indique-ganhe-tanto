"use client"

import { Toaster } from "sonner"
import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"
import { IndicadorHomeProvider } from "./indicador-home-provider"

export default function IndicadorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <AuthenticatedDashboardShell variant="indicador">
        <IndicadorHomeProvider>{children}</IndicadorHomeProvider>
      </AuthenticatedDashboardShell>
      <Toaster richColors closeButton />
    </>
  )
}
