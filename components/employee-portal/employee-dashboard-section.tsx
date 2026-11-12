import Link from "next/link"
import { loadEmployeeDashboard } from "@/lib/employee-portal/service"
import { formatCompetence, formatDate, formatMoney } from "@/lib/employee-portal/format"
import {
  ATTRIBUTION_ROLE_LABEL,
  COMPETENCE_STATUS_LABEL,
  EMPLOYEE_STATUS_LABEL,
  OPPORTUNITY_STATUS_LABEL,
  PIPELINE_STAGE_LABEL,
  labelFor,
} from "@/lib/employee-portal/terminology"
import { EmptyState, MetricCard, Notice } from "@/components/employee-portal/portal-ui"
import { PortalError } from "@/components/employee-portal/portal-error"
import { PageHeader } from "@/components/ui/page-header"

/** Painel somente leitura do funcionário (3.1F-J2). Zeros reais; sem dados de demonstração. */
export async function EmployeeDashboardSection() {
  const r = await loadEmployeeDashboard()
  return (
    <section aria-labelledby="employee-dashboard-title" className="space-y-4">
      <PageHeader title="Início" description="Seu resumo de vendas e remuneração. Somente leitura." className="pb-0" />
      <h2 id="employee-dashboard-title" className="sr-only">Resumo</h2>
      {!r.ok ? (
        <PortalError kind={r.kind} />
      ) : (
        <>
          {r.data.readOnly ? (
            <Notice>
              Seu status atual é {labelFor(EMPLOYEE_STATUS_LABEL, r.data.employeeStatus)}. Você pode consultar seus dados; nenhuma alteração está disponível.
            </Notice>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard title="Oportunidades do mês" value={String(r.data.opportunitiesInMonth)} hint={formatCompetence(r.data.competenceMonth)} />
            <MetricCard title="Vendas em andamento" value={String(r.data.salesInProgress)} />
            <MetricCard title="Conversões comprovadas" value={String(r.data.provenConversions)} hint="Primeira mensalidade confirmada." />
            <MetricCard title="Comissões aguardando evidência" value={String(r.data.commissionsAwaitingEvidence)} />
            <MetricCard title="Comissão acumulada na competência" value={formatMoney(r.data.commissionAccruedInCompetence)} hint="Valor em apuração. Não representa pagamento." />
            <MetricCard
              title="Competência atual"
              value={r.data.currentCompetence ? labelFor(COMPETENCE_STATUS_LABEL, r.data.currentCompetence.status) : "Não aberta"}
              hint={formatCompetence(r.data.competenceMonth)}
            />
          </div>
          <section aria-labelledby="recent-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="recent-title" className="text-lg font-semibold">Histórico recente</h2>
              <Link href="/funcionario/vendas" className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                Ver minhas vendas
              </Link>
            </div>
            {r.data.recent.length === 0 ? (
              <EmptyState title="Nenhuma venda atribuída a você ainda." description="Quando uma oportunidade for atribuída a você, ela aparecerá aqui." />
            ) : (
              <ul className="divide-y divide-border/40 rounded-xl border border-border/50">
                {r.data.recent.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <Link href={`/funcionario/vendas/${x.id}`} className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                      {formatDate(x.createdAt)} · {labelFor(PIPELINE_STAGE_LABEL, x.stage)}
                    </Link>
                    <span className="text-muted-foreground">
                      {labelFor(OPPORTUNITY_STATUS_LABEL, x.status)} · {labelFor(ATTRIBUTION_ROLE_LABEL, x.role)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Notice>Nova oportunidade: em breve. O cadastro será liberado em uma próxima etapa.</Notice>
        </>
      )}
    </section>
  )
}
