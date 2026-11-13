import { COMPONENT_KEYS, parseCompetenceParam } from "@/lib/employee-portal/contracts"
import { loadEmployeeCompetence } from "@/lib/employee-portal/service"
import { formatCompetence, formatDate, formatMoney } from "@/lib/employee-portal/format"
import {
  COMPETENCE_STATUS_LABEL,
  COMPETENCE_STATUS_TONE,
  COMPONENT_LABEL,
  TOTAL_KIND_LABEL,
  labelFor,
} from "@/lib/employee-portal/terminology"
import { PageHeader } from "@/components/ui/page-header"
import { BackLink, EmptyState } from "@/components/employee-portal/portal-ui"
import { PortalError } from "@/components/employee-portal/portal-error"
import { StatusPill } from "@/components/employee-portal/status-pill"

export const dynamic = "force-dynamic"

export default async function CompetenciaPage({ params }: { params: Promise<{ competencia: string }> }) {
  const { competencia } = await params
  const month = parseCompetenceParam(competencia)
  const r = month ? await loadEmployeeCompetence(month) : ({ ok: false, kind: "not_found" } as const)
  return (
    <div className="space-y-6">
      <BackLink href="/funcionario/remuneracao" label="Minha remuneração" />
      {!r.ok ? (
        <>
        <PageHeader title="Competência" />
        {r.kind === "not_found" ? (
          <EmptyState title="Competência não encontrada." description="Não há competência registrada para você neste mês." action={{ href: "/funcionario/remuneracao", label: "Voltar" }} />
        ) : (
          <PortalError kind={r.kind} />
        )}
        </>
      ) : (
        <>
          <PageHeader title={`Competência ${formatCompetence(r.data.competenceMonth)}`} description="Somente componentes configurados e visíveis para você.">
            <StatusPill label={labelFor(COMPETENCE_STATUS_LABEL, r.data.status)} tone={COMPETENCE_STATUS_TONE[r.data.status] ?? "neutral"} />
          </PageHeader>
          {r.data.paidOn ? (
            <p className="text-sm text-muted-foreground">Pagamento registrado em {formatDate(r.data.paidOn)}.</p>
          ) : null}
          <dl className="divide-y divide-border/40 rounded-xl border border-border/50 bg-card/50 text-sm">
            {r.data.components.commission ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-muted-foreground">{COMPONENT_LABEL.commission}</dt>
                <dd className="font-medium tabular-nums">{formatMoney(r.data.components.commission)}</dd>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-muted-foreground">{COMPONENT_LABEL.commission}</dt>
                <dd className="font-medium">Sem comissão visível neste mês</dd>
              </div>
            )}
            {COMPONENT_KEYS.filter((k) => k !== "commission" && r.data.components[k] !== undefined).map((k) => (
              <div key={k} className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-muted-foreground">{COMPONENT_LABEL[k]}</dt>
                <dd className="font-medium tabular-nums">{formatMoney(r.data.components[k])}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="font-semibold">{labelFor(TOTAL_KIND_LABEL, r.data.total.kind)}</dt>
              <dd className="text-lg font-bold tabular-nums">{formatMoney(r.data.total.amount)}</dd>
            </div>
          </dl>
          <section aria-labelledby="lines-title" className="space-y-3">
            <h2 id="lines-title" className="text-lg font-semibold">Lançamentos</h2>
            {r.data.lines.length === 0 ? (
              <EmptyState title="Nenhum lançamento nesta competência." />
            ) : (
              <ul className="divide-y divide-border/40 rounded-xl border border-border/50">
                {r.data.lines.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="min-w-0 break-words">
                      <span className="text-muted-foreground">{COMPONENT_LABEL[l.kind]} · </span>
                      {l.description}
                    </span>
                    <span className="tabular-nums">
                      <span className="mr-2 text-xs text-muted-foreground">{formatDate(l.createdAt)}</span>
                      {formatMoney(l.amount)}
                    </span>
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
