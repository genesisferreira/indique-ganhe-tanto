import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { currentIndicador } from "@/lib/mock-data"

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
