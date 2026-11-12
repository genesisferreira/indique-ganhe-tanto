import Link from "next/link"
import { parseSalesQuery } from "@/lib/employee-portal/contracts"
import { loadEmployeeSales } from "@/lib/employee-portal/service"
import { PageHeader } from "@/components/ui/page-header"
import { SalesFilters } from "@/components/employee-portal/sales-filters"
import { SalesList } from "@/components/employee-portal/sales-list"
import { EmptyState } from "@/components/employee-portal/portal-ui"
import { PortalError } from "@/components/employee-portal/portal-error"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function toParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v
    if (typeof value === "string" && value !== "") p.set(k, value)
  }
  return p
}

export default async function MinhasVendasPage({ searchParams }: { searchParams: SearchParams }) {
  const params = toParams(await searchParams)
  const parsed = parseSalesQuery(params)
  const result = parsed.ok ? await loadEmployeeSales(parsed.value) : null
  const query = parsed.ok ? parsed.value : null
  const pageHref = (offset: number) => {
    const p = new URLSearchParams(params)
    p.delete("page")
    p.set("offset", String(offset))
    return `/funcionario/vendas?${p.toString()}`
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Minhas vendas" description="Oportunidades atribuídas a você. Somente leitura." />
      <SalesFilters query={query} />
      {!parsed.ok ? (
        <PortalError kind="invalid" />
      ) : !result ? null : !result.ok ? (
        <PortalError kind={result.kind} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          title={result.data.total === 0 && !params.toString() ? "Nenhuma venda atribuída a você ainda." : "Nenhuma venda encontrada com estes filtros."}
          description="Somente oportunidades atribuídas a você aparecem aqui."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.data.total} {result.data.total === 1 ? "venda" : "vendas"}
          </p>
          <SalesList items={result.data.items} />
          <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2">
            {result.data.offset > 0 ? (
              <Link className="rounded-md border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary" href={pageHref(Math.max(0, result.data.offset - result.data.limit))}>
                Anterior
              </Link>
            ) : <span />}
            {result.data.offset + result.data.items.length < result.data.total ? (
              <Link className="rounded-md border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary" href={pageHref(result.data.offset + result.data.limit)}>
                Próxima
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </div>
  )
}
