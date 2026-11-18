import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { loadOperationalActorContext } from "@/lib/collections/actor"
import { operationalHrefForSectorCode } from "@/lib/auth/operational-routes"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmployeeDashboardSection } from "@/components/employee-portal/employee-dashboard-section"
import { ShareLinksCard } from "@/components/referral-share/share-card"
import { RolePeriodSummary } from "@/components/period/role-period-summary"

export const dynamic = "force-dynamic"

const SECTOR_LABEL: Record<string, string> = {
  collections: "Cobrança",
  retention: "Retenção",
}

export default async function FuncionarioHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) redirect("/login")

  const context = await loadOperationalActorContext(user.id)
  if (!context || context.role !== "funcionario") {
    redirect("/")
  }
  if (context.profileIsActive === false) {
    redirect("/conta-inativa")
  }

  const operational =
    context.employeeStatus === "active"
      ? context.membershipCodes
          .map((code) => {
            const href = operationalHrefForSectorCode(code)
            if (!href) return null
            return { code, href, label: SECTOR_LABEL[code] ?? code }
          })
          .filter((row): row is { code: string; href: string; label: string } => row !== null)
      : []

  return (
    <div className="space-y-8">
      <ShareLinksCard
        title="Meu link de vendas"
        description="Cada papel tem o próprio link. A oportunidade fica atribuída a esse papel."
        mode="self"
        originKind="employee"
      />
      <RolePeriodSummary />
      <EmployeeDashboardSection />
      <PageHeader
        title="Operação"
        description="Módulos liberados pelos seus setores ativos."
        className="pb-0"
      />
      {operational.length === 0 ? (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Nenhum módulo operacional</CardTitle>
            <CardDescription>
              Não há setor ativo atribuído, ou seu estado de funcionário não permite
              operação no momento.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {operational.map((item) => (
            <Link key={item.code} href={item.href}>
              <Card className="border-border/50 bg-card/50 transition-colors hover:border-primary/40">
                <CardHeader>
                  <CardTitle>{item.label}</CardTitle>
                  <CardDescription>Abrir módulo</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
