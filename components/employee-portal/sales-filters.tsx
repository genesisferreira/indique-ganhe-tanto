import {
  COMMISSION_FILTERS,
  OPPORTUNITY_STATUSES,
  PIPELINE_STAGES,
  SALES_ROLE_FILTERS,
  SALES_SEARCH_MAX,
  type SalesQuery,
} from "@/lib/employee-portal/contracts"
import {
  ATTRIBUTION_ROLE_LABEL,
  ENTITLEMENT_STATUS_LABEL,
  OPPORTUNITY_STATUS_LABEL,
  PIPELINE_STAGE_LABEL,
} from "@/lib/employee-portal/terminology"

const fieldClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"

/**
 * Filtros de CONSULTA (method=GET, somente querystring). Não envia dados,
 * não cria registro, não tem POST. Sem JavaScript.
 */
export function SalesFilters({ query }: { query: SalesQuery | null }) {
  return (
    <form method="get" action="/funcionario/vendas" role="search" aria-label="Filtrar minhas vendas" className="grid gap-3 rounded-xl border border-border/50 bg-card/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="min-w-0 sm:col-span-2">
        <label htmlFor="f-q" className="mb-1 block text-xs font-medium text-muted-foreground">Buscar (protocolo, nome exibido ou plano)</label>
        <input id="f-q" name="q" type="search" maxLength={SALES_SEARCH_MAX} defaultValue={query?.search ?? ""} placeholder="Ex.: A1B2C3D4 ou Maria" className={fieldClass} />
      </div>
      <div className="min-w-0">
        <label htmlFor="f-from" className="mb-1 block text-xs font-medium text-muted-foreground">De</label>
        <input id="f-from" name="from" type="date" defaultValue={query?.from ?? ""} className={fieldClass} />
      </div>
      <div className="min-w-0">
        <label htmlFor="f-to" className="mb-1 block text-xs font-medium text-muted-foreground">Até</label>
        <input id="f-to" name="to" type="date" defaultValue={query?.to ?? ""} className={fieldClass} />
      </div>
      <div className="min-w-0">
        <label htmlFor="f-stage" className="mb-1 block text-xs font-medium text-muted-foreground">Etapa</label>
        <select id="f-stage" name="stage" defaultValue={query?.stage ?? ""} className={fieldClass}>
          <option value="">Todas</option>
          {PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>{PIPELINE_STAGE_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor="f-status" className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
        <select id="f-status" name="status" defaultValue={query?.status ?? ""} className={fieldClass}>
          <option value="">Todos</option>
          {OPPORTUNITY_STATUSES.map((s) => (
            <option key={s} value={s}>{OPPORTUNITY_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor="f-commission" className="mb-1 block text-xs font-medium text-muted-foreground">Comissão</label>
        <select id="f-commission" name="commission" defaultValue={query?.commission ?? ""} className={fieldClass}>
          <option value="">Todas</option>
          {COMMISSION_FILTERS.map((s) => (
            <option key={s} value={s}>{ENTITLEMENT_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor="f-role" className="mb-1 block text-xs font-medium text-muted-foreground">Papel</label>
        <select id="f-role" name="role" defaultValue={query?.role ?? ""} className={fieldClass}>
          <option value="">Todos</option>
          {SALES_ROLE_FILTERS.map((s) => (
            <option key={s} value={s}>{ATTRIBUTION_ROLE_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 items-end gap-2">
        <button type="submit" className="h-10 flex-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Filtrar
        </button>
        <a href="/funcionario/vendas" className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Limpar
        </a>
      </div>
    </form>
  )
}
