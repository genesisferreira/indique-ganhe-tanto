import { parseOpportunityId } from "@/lib/employee-portal/contracts"
import { loadEmployeeSaleDetail } from "@/lib/employee-portal/service"
import { formatCompetence, formatDate, formatMoney } from "@/lib/employee-portal/format"
import {
  ATTRIBUTION_ROLE_LABEL,
  ENTITLEMENT_STATUS_LABEL,
  ENTITLEMENT_STATUS_TONE,
  OPPORTUNITY_STATUS_LABEL,
  PIPELINE_STAGE_LABEL,
  labelFor,
} from "@/lib/employee-portal/terminology"
import { PageHeader } from "@/components/ui/page-header"
import { BackLink, EmptyState } from "@/components/employee-portal/portal-ui"
import { PortalError } from "@/components/employee-portal/portal-error"
import { StatusPill } from "@/components/employee-portal/status-pill"

export const dynamic = "force-dynamic"

export default async function DetalheVendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const opportunityId = parseOpportunityId(id)
  const r = opportunityId ? await loadEmployeeSaleDetail(opportunityId) : ({ ok: false, kind: "not_found" } as const)
  return (
    <div className="space-y-6">
      <BackLink href="/funcionario/vendas" label="Minhas vendas" />
      {!r.ok ? (
        <>
          <PageHeader title="Detalhe da venda" />
          <PortalError kind={r.kind} />
        </>
      ) : (
        <>
          <PageHeader title={`Venda ${r.data.reference}`} description={`Criada em ${formatDate(r.data.createdAt)} · atualizada em ${formatDate(r.data.updatedAt)}`} />
          <dl className="grid gap-4 rounded-xl border border-border/50 bg-card/50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-muted-foreground">Interessado</dt><dd className="break-words font-medium">{r.data.interested ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Plano</dt><dd className="break-words font-medium">{r.data.plan ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Seu papel</dt><dd className="font-medium">{labelFor(ATTRIBUTION_ROLE_LABEL, r.data.role)}</dd></div>
            <div><dt className="text-muted-foreground">Etapa comercial</dt><dd className="font-medium">{labelFor(PIPELINE_STAGE_LABEL, r.data.stage)}{r.data.stageSince ? ` · desde ${formatDate(r.data.stageSince)}` : ""}</dd></div>
            <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{labelFor(OPPORTUNITY_STATUS_LABEL, r.data.status)}</dd></div>
          </dl>
          <section aria-labelledby="fin-title" className="space-y-3">
            <h2 id="fin-title" className="text-lg font-semibold">Situação da comissão</h2>
            {r.data.commissions.length === 0 ? (
              <EmptyState title="Comissão: aguardando regra financeira." description="A comissão só é registrada quando houver regra ativa e evidência comprovada." />
            ) : (
              <ul className="space-y-2">
                {r.data.commissions.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 px-4 py-3 text-sm">
                    <StatusPill label={labelFor(ENTITLEMENT_STATUS_LABEL, c.status)} tone={ENTITLEMENT_STATUS_TONE[c.status] ?? "neutral"} />
                    <span className="text-muted-foreground">{c.competenceMonth ? formatCompetence(c.competenceMonth) : "Sem competência"}</span>
                    {c.amount !== undefined ? <span className="font-medium tabular-nums">{formatMoney(c.amount)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="tl-title" className="space-y-3">
            <h2 id="tl-title" className="text-lg font-semibold">Linha do tempo</h2>
            {r.data.timeline.length === 0 ? (
              <EmptyState title="Nenhuma mudança de status registrada." />
            ) : (
              <ol className="space-y-2 border-l border-border/60 pl-4">
                {r.data.timeline.map((e, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-muted-foreground">{formatDate(e.at)}</span>{" "}
                    {e.from ? `${labelFor(OPPORTUNITY_STATUS_LABEL, e.from)} → ` : ""}
                    <span className="font-medium">{labelFor(OPPORTUNITY_STATUS_LABEL, e.to)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}
