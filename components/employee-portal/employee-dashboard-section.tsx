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
      <PageHeader title="Início" description="Seu resumo de vendas e remuneração." className="pb-0" />
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
            <MetricCard title="Em atendimento" value={String(r.data.salesInProgress)} hint="Oportunidades abertas no pipeline." />
            <MetricCard title="Convertidas / instaladas" value={String(r.data.provenConversions)} hint="Primeira mensalidade confirmada." />
            <MetricCard title="Comissões aguardando evidência" value={String(r.data.commissionsAwaitingEvidence)} />
            <MetricCard
              title="Comissão"
              value={r.data.commissionsAwaitingEvidence === 0 && Number(r.data.commissionAccruedInCompetence) === 0 ? "Não calculada" : formatMoney(r.data.commissionAccruedInCompetence)}
              hint={r.data.commissionsAwaitingEvidence === 0 && Number(r.data.commissionAccruedInCompetence) === 0 ? "Aguardando regra financeira." : "Valor em apuração. Não representa pagamento."}
            />
            <MetricCard
              title="Competência atual"
              value={r.data.currentCompetence ? labelFor(COMPETENCE_STATUS_LABEL, r.data.currentCompetence.status) : "Não aberta"}
              hint={formatCompetence(r.data.competenceMonth)}
            />
          </div>
          <section aria-labelledby="recent-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="recent-title" className="text-lg font-semibold">Últimas vendas</h2>
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
          {r.data.readOnly ? null : (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-foreground">
                Técnico ou Vendas Externas? Registre um cliente interessado e acompanhe em Minhas vendas.
              </p>
              <Link
                href="/funcionario/nova-oportunidade"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Nova oportunidade
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  )
}
