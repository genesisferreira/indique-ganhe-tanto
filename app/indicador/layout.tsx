import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { currentIndicador } from "@/lib/services/mock-data.service"

export default function IndicadorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardLayout
      variant="indicador"
      userName={currentIndicador.nome}
      userRole="Indicador"
    >
      {children}
    </DashboardLayout>
  )
}
