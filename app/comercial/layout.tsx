import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { currentComercial } from "@/lib/mock-data"

export default function ComercialLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardLayout
      variant="comercial"
      userName={currentComercial.nome}
      userRole="Comercial"
    >
      {children}
    </DashboardLayout>
  )
}
