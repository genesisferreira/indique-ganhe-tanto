import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"

export const dynamic = "force-dynamic"

export default function ComercialLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthenticatedDashboardShell variant="comercial">
      {children}
    </AuthenticatedDashboardShell>
  )
}
