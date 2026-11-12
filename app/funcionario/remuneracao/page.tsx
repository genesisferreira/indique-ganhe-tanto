import Link from "next/link"
import { competenceToParam, parseCompensationListQuery } from "@/lib/employee-portal/contracts"
import { loadEmployeeCompensation } from "@/lib/employee-portal/service"
import { formatCompetence, formatMoney } from "@/lib/employee-portal/format"
import {
  BENEFIT_METHOD_LABEL,
  COMPETENCE_STATUS_LABEL,
  COMPETENCE_STATUS_TONE,
  EMPLOYEE_STATUS_LABEL,
  TOTAL_KIND_LABEL,
  labelFor,
} from "@/lib/employee-portal/terminology"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Notice } from "@/components/employee-portal/portal-ui"
import { PortalError } from "@/components/employee-portal/portal-error"
import { StatusPill } from "@/components/employee-portal/status-pill"

export const dynamic = "force-dynamic"

export default async function MinhaRemuneracaoPage() {
  const parsed = parseCompensationListQuery(new URLSearchParams())
  const r = parsed.ok ? await loadEmployeeCompensation(parsed.value) : ({ ok: false, kind: "invalid" } as const)
  return (
    <div className="space-y-6">
      <PageHeader title="Minha remuneração" description="Somente seus dados. Componentes não configurados ou não visíveis não aparecem." />
      {!r.ok ? (
        <PortalError kind={r.kind} />
      ) : (
        <>
          {r.data.readOnly ? (
            <Notice>Seu status atual é {labelFor(EMPLOYEE_STATUS_LABEL, r.data.employeeStatus)}. Consulta somente leitura.</Notice>
          ) : null}
          <section aria-labelledby="profile-title" className="space-y-3">
            <h2 id="profile-title" className="text-lg font-semibold">Configuração vigente</h2>
            {!r.data.profile ? (
              <EmptyState
                title="Nenhuma remuneração configurada para você ainda."
                description="A comissão aparece por venda quando houver regra ativa e evidência. Salário e benefícios só aparecem quando configurados e liberados para visualização."
              />
            ) : (
              <dl className="grid gap-3 rounded-xl border border-border/50 bg-card/50 p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Comissão</dt><dd className="font-medium">Por venda, conforme regra vigente</dd></div>
                {r.data.profile.salary ? (
                  <div><dt className="text-muted-foreground">Salário</dt><dd className="font-medium tabular-nums">{formatMoney(r.data.profile.salary.amount)}</dd></div>
                ) : null}
                {r.data.profile.meal ? (
                  <div><dt className="text-muted-foreground">Vale-refeição</dt><dd className="font-medium tabular-nums">{formatMoney(r.data.profile.meal.dailyAmount)} por dia trabalhado</dd></div>
                ) : null}
                {r.data.profile.transport ? (
                  <div><dt className="text-muted-foreground">Transporte</dt><dd className="font-medium tabular-nums">{formatMoney(r.data.profile.transport.amount)} {labelFor(BENEFIT_METHOD_LABEL, r.data.profile.transport.method)}</dd></div>
                ) : null}
                {r.data.profile.fuel ? (
                  <div><dt className="text-muted-foreground">Combustível</dt><dd className="font-medium tabular-nums">{formatMoney(r.data.profile.fuel.amount)} {labelFor(BENEFIT_METHOD_LABEL, r.data.profile.fuel.method)}</dd></div>
                ) : null}
              </dl>
            )}
          </section>
          <section aria-labelledby="comp-title" className="space-y-3">
            <h2 id="comp-title" className="text-lg font-semibold">Competências</h2>
            {r.data.competences.length === 0 ? (
              <EmptyState title="Nenhuma competência registrada." description="Competências são abertas pelo Financeiro. Nada é criado automaticamente." />
            ) : (
              <ul className="space-y-2">
                {r.data.competences.map((c) => (
                  <li key={c.competenceMonth}>
                    <Link
                      href={`/funcionario/remuneracao/${competenceToParam(c.competenceMonth)}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-card/50 px-4 py-3 text-sm hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="font-medium">{formatCompetence(c.competenceMonth)}</span>
                      <StatusPill label={labelFor(COMPETENCE_STATUS_LABEL, c.status)} tone={COMPETENCE_STATUS_TONE[c.status] ?? "neutral"} />
                      <span className="tabular-nums text-muted-foreground">
                        {labelFor(TOTAL_KIND_LABEL, c.totalKind)}: <span className="text-foreground">{formatMoney(c.visibleTotal)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
