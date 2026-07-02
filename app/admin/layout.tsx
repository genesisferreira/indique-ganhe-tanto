import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"

export const dynamic = "force-dynamic"

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
