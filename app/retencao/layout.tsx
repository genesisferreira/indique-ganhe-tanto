import { redirect } from "next/navigation"
import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { RETENTION_SECTOR_CODE } from "@/types/collections"
import type { UserRole } from "@/types/user"

export const dynamic = "force-dynamic"

function shellVariantForRole(role: UserRole): "comercial" | "admin" {
  if (role === "admin_consulta" || role === "admin_financeiro" || role === "admin_master") {
    return "admin"
  }
  return "comercial"
}

export default async function RetencaoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const auth = await authorizeOperationalRequest({
    sectorCode: RETENTION_SECTOR_CODE,
    action: "read",
  })
  if (!auth.ok) {
    if (auth.status === 401) redirect("/login")
    redirect("/")
  }
  return (
    <AuthenticatedDashboardShell variant={shellVariantForRole(auth.role)}>
      {children}
    </AuthenticatedDashboardShell>
  )
}
