import Link from "next/link"
import { competenceToParam, parseCompensationListQuery } from "@/lib/employee-portal/contracts"
import { loadEmployeeCompensation } from "@/lib/employee-portal/service"
import { loadEmployeeCompensationPreview } from "@/lib/compensation-config/service"
import { formatCompetence, formatMoney } from "@/lib/employee-portal/format"
import {
  BENEFIT_METHOD_LABEL,
  COMPETENCE_STATUS_LABEL,
  COMPETENCE_STATUS_TONE,
  EMPLOYEE_STATUS_LABEL,
  ENTITLEMENT_STATUS_LABEL,
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
  // 3.1F-J4: prévia do PRÓPRIO rascunho vigente (somente componentes configurados e visíveis).
  const preview = r.ok ? await loadEmployeeCompensationPreview() : null
  return (
    <div className="space-y-6">
      <PageHeader title="Minha remuneração" description="Somente seus dados. Componentes não configurados ou não visíveis não aparecem." />
      {!r.ok || !preview ? (
        <PortalError kind={r.ok ? "unavailable" : r.kind} />
      ) : (
        <>
          {r.data.readOnly ? (
            <Notice>Seu status atual é {labelFor(EMPLOYEE_STATUS_LABEL, r.data.employeeStatus)}. Consulta somente leitura.</Notice>
          ) : null}
          <section aria-labelledby="profile-title" className="space-y-3">
            <h2 id="profile-title" className="text-lg font-semibold">
              Competência atual{preview.ok ? `: ${formatCompetence(preview.data.competenceMonth)}` : ""}
            </h2>
            {!preview.ok ? (
              <PortalError kind={preview.kind === "not_found" ? "unavailable" : preview.kind} />
            ) : !preview.data.configured && !preview.data.commission ? (
              <EmptyState
                title="Nenhuma remuneração configurada para você ainda."
                description="Quando o Financeiro configurar e liberar algum componente para visualização, ele aparecerá aqui."
              />
            ) : (
              <>
                <Notice>Valores estimados a partir da configuração em rascunho. Não constituem folha fechada nem pagamento.</Notice>
                <dl className="grid gap-3 rounded-xl border border-border/50 bg-card/50 p-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Comissão</dt><dd className="font-medium">{preview.data.commission ? "Aguardando evidência comprovada" : "Não calculada"}</dd></div>
                  {preview.data.components.salary ? (
                    <div><dt className="text-muted-foreground">Salário</dt><dd className="font-medium tabular-nums">{formatMoney(preview.data.components.salary.amount)}</dd></div>
                  ) : null}
                  {preview.data.components.meal ? (
                    <div><dt className="text-muted-foreground">Vale-refeição</dt><dd className="font-medium tabular-nums">{formatMoney(preview.data.components.meal.dailyAmount)} por dia trabalhado</dd></div>
                  ) : null}
                  {preview.data.components.transport ? (
                    <div><dt className="text-muted-foreground">Passagem</dt><dd className="font-medium tabular-nums">{formatMoney(preview.data.components.transport.amount)} {labelFor(BENEFIT_METHOD_LABEL, preview.data.components.transport.method)}</dd></div>
                  ) : null}
                  {preview.data.components.fuel ? (
                    <div><dt className="text-muted-foreground">Gasolina</dt><dd className="font-medium tabular-nums">{formatMoney(preview.data.components.fuel.amount)} {labelFor(BENEFIT_METHOD_LABEL, preview.data.components.fuel.method)}</dd></div>
                  ) : null}
                  {preview.data.estimatedTotal ? (
                    <div className="sm:col-span-2 border-t border-border/40 pt-3">
                      <dt className="text-muted-foreground">Total estimado (componentes mensais visíveis)</dt>
                      <dd className="text-lg font-semibold tabular-nums">{formatMoney(preview.data.estimatedTotal)}</dd>
                    </div>
                  ) : null}
                </dl>
                {preview.data.perDayComponentsExcluded ? (
                  <p className="text-xs text-muted-foreground">Itens por dia trabalhado dependem dos dias registrados na competência e não entram no total estimado.</p>
                ) : null}
              </>
            )}
          </section>
          <section aria-labelledby="comm-title" className="space-y-3">
            <h2 id="comm-title" className="text-lg font-semibold">Comissão por venda</h2>
            {r.data.commissions.length === 0 ? (
              <EmptyState title="Nenhuma comissão apurada." description="Quando houver evidência financeira comprovada, a comissão aparece aqui." />
            ) : (
              <ul className="divide-y divide-border/40 rounded-xl border border-border/50">
                {r.data.commissions.map((c) => (
                  <li key={`${c.opportunityId}-${c.status}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span>{labelFor(ENTITLEMENT_STATUS_LABEL, c.status)}{c.method ? ` · ${c.method}` : ""}{c.competenceMonth ? ` · ${formatCompetence(c.competenceMonth)}` : ""}</span>
                    <span className="tabular-nums">{c.amount ? formatMoney(c.amount) : "—"}</span>
                  </li>
                ))}
              </ul>
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
