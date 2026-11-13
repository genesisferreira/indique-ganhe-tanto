import Link from "next/link"
import { PageHeader } from "@/components/ui/page-header"
import { Notice } from "@/components/employee-portal/portal-ui"
import { PortalError } from "@/components/employee-portal/portal-error"
import { EmployeeOpportunityForm } from "@/components/employee-opportunities/opportunity-form"
import { loadEmployeeOpportunityFormContext } from "@/lib/employee-opportunities/service"

export const dynamic = "force-dynamic"

export default async function NovaOportunidadePage() {
  const ctx = await loadEmployeeOpportunityFormContext()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nova oportunidade"
        description="Registre um cliente interessado. Ele entra no pipeline como Interessado e você acompanha em Minhas vendas."
      />
      {!ctx.ok ? (
        <PortalError kind={ctx.kind} />
      ) : !ctx.data.canCreate ? (
        <Notice>
          {ctx.data.employeeStatus && ctx.data.employeeStatus !== "active"
            ? "Seu cadastro de funcionário não está ativo. O registro de oportunidades fica indisponível."
            : "O registro de oportunidades é exclusivo para funcionários com vínculo ativo de Técnico ou Vendas Externas. Fale com o administrador."}{" "}
          <Link href="/funcionario/vendas" className="text-primary underline-offset-4 hover:underline">Ver minhas vendas</Link>
        </Notice>
      ) : ctx.data.plans.length === 0 ? (
        <Notice>Nenhum plano ativo disponível no momento. Fale com o administrador.</Notice>
      ) : (
        <EmployeeOpportunityForm context={ctx.data} />
      )}
    </div>
  )
}
