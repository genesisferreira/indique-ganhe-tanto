import { redirect } from "next/navigation"
import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { operationalShellVariantForRole } from "@/lib/auth/dashboard-variant"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const dynamic = "force-dynamic"

export default async function CobrancaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "read",
  })
  if (!auth.ok) {
    if (auth.status === 401) redirect("/login")
    redirect("/")
  }
  return (
    <AuthenticatedDashboardShell variant={operationalShellVariantForRole(auth.role)}>
      {children}
    </AuthenticatedDashboardShell>
  )
}
