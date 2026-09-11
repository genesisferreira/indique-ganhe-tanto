import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"

export const dynamic = "force-dynamic"

export default function FuncionarioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthenticatedDashboardShell variant="funcionario">
      {children}
    </AuthenticatedDashboardShell>
  )
}
