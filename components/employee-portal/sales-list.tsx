import Link from "next/link"
import type { SaleListItem } from "@/lib/employee-portal/contracts"
import { formatDate } from "@/lib/employee-portal/format"
import {
  ATTRIBUTION_ROLE_LABEL,
  ENTITLEMENT_STATUS_LABEL,
  ENTITLEMENT_STATUS_TONE,
  OPPORTUNITY_STATUS_LABEL,
  PIPELINE_STAGE_LABEL,
  labelFor,
} from "@/lib/employee-portal/terminology"
import { StatusPill } from "@/components/employee-portal/status-pill"

/** Tabela no desktop; cards empilhados no mobile (sem overflow horizontal). */
export function SalesList({ items }: { items: SaleListItem[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border/50 lg:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Minhas vendas</caption>
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="w-28 px-3 py-2">Referência</th>
              <th scope="col" className="w-28 px-3 py-2">Data</th>
              <th scope="col" className="px-3 py-2">Interessado</th>
              <th scope="col" className="px-3 py-2">Plano</th>
              <th scope="col" className="px-3 py-2">Etapa</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Papel</th>
              <th scope="col" className="px-3 py-2">Comissão</th>
              <th scope="col" className="w-28 px-3 py-2">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-border/40 align-top">
                <td className="px-3 py-2 font-mono">
                  <Link href={`/funcionario/vendas/${s.id}`} className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                    {s.reference}
                  </Link>
                </td>
                <td className="px-3 py-2">{formatDate(s.createdAt)}</td>
                <td className="break-words px-3 py-2">{s.interested ?? "—"}</td>
                <td className="break-words px-3 py-2">{s.plan ?? "—"}</td>
                <td className="px-3 py-2">{labelFor(PIPELINE_STAGE_LABEL, s.stage)}</td>
                <td className="px-3 py-2">{labelFor(OPPORTUNITY_STATUS_LABEL, s.status)}</td>
                <td className="px-3 py-2">{labelFor(ATTRIBUTION_ROLE_LABEL, s.role)}</td>
                <td className="px-3 py-2">
                  <StatusPill label={labelFor(ENTITLEMENT_STATUS_LABEL, s.commissionStatus)} tone={ENTITLEMENT_STATUS_TONE[s.commissionStatus] ?? "neutral"} />
                </td>
                <td className="px-3 py-2">{formatDate(s.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 lg:hidden" aria-label="Minhas vendas">
        {items.map((s) => (
          <li key={s.id} className="min-w-0 rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/funcionario/vendas/${s.id}`} className="font-mono text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                {s.reference}
              </Link>
              <StatusPill label={labelFor(ENTITLEMENT_STATUS_LABEL, s.commissionStatus)} tone={ENTITLEMENT_STATUS_TONE[s.commissionStatus] ?? "neutral"} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Interessado</dt><dd className="break-words">{s.interested ?? "—"}</dd>
              <dt className="text-muted-foreground">Plano</dt><dd className="break-words">{s.plan ?? "—"}</dd>
              <dt className="text-muted-foreground">Etapa</dt><dd>{labelFor(PIPELINE_STAGE_LABEL, s.stage)}</dd>
              <dt className="text-muted-foreground">Status</dt><dd>{labelFor(OPPORTUNITY_STATUS_LABEL, s.status)}</dd>
              <dt className="text-muted-foreground">Papel</dt><dd>{labelFor(ATTRIBUTION_ROLE_LABEL, s.role)}</dd>
              <dt className="text-muted-foreground">Criada em</dt><dd>{formatDate(s.createdAt)}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
