"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  REALTIME_TABLES_INDICADOR,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PeriodFilter } from "@/components/period/period-filter"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { indicacoes, currentIndicador } from "@/lib/services/mock-data.service"
import { loadIndicadorReferralsListFromSupabase } from "@/lib/services/supabase-data.service"
import { parsePage, parsePageSize, parsePeriod } from "@/lib/period/range"
import { buildInternalReturn, rememberListScroll, restoreListScroll } from "@/lib/period/return-to"
import { Plus, Search, Eye, Filter } from "lucide-react"
import type { Indicacao } from "@/types"

const statusOptions = [
  { value: "all", label: "Todos os status" },
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em Andamento" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
  { value: "paga", label: "Paga" },
]

export default function MinhasIndicacoesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const listQuery = searchParams.toString()
  const period = parsePeriod(new URLSearchParams(listQuery))
  const fromIso = period.from?.toISOString() ?? null
  const toIso = period.to?.toISOString() ?? null
  const page = parsePage(searchParams.get("page"))
  const pageSize = parsePageSize(searchParams.get("pageSize"))
  const statusFilter = searchParams.get("status") || "all"
  const [search, setSearch] = useState(searchParams.get("q") ?? "")
  const [items, setItems] = useState<Indicacao[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadLista = useCallback(async () => {
    if (isDataProviderMock()) {
      const own = indicacoes.filter((item) => item.indicadorId === currentIndicador.id)
      setItems(own)
      setTotal(own.length)
      setError(false)
      setLoading(false)
      return
    }
    setLoading(true)
    const remote = await loadIndicadorReferralsListFromSupabase({
      from: fromIso,
      to: toIso,
      page,
      pageSize,
      search: searchParams.get("q") ?? "",
      status: statusFilter,
    })
    setLoading(false)
    if (!remote) {
      setError(true)
      setItems([])
      setTotal(0)
      return
    }
    setError(false)
    setItems(remote.items)
    setTotal(remote.total)
  }, [fromIso, page, pageSize, searchParams, statusFilter, toIso])

  useEffect(() => {
    void loadLista()
  }, [loadLista])

  useEffect(() => {
    restoreListScroll()
  }, [listQuery])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(listQuery)
      const term = search.trim()
      if (term.length >= 2) next.set("q", term)
      else next.delete("q")
      next.delete("page")
      if (next.toString() !== listQuery) router.replace(`/indicador/indicacoes?${next.toString()}`, { scroll: false })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [search, listQuery, router])

  useRealtimeReload(loadLista, REALTIME_TABLES_INDICADOR, {
    enabled: !isDataProviderMock(),
    logPrefix: "[indicador:realtime]",
  })

  const returnTo = buildInternalReturn("/indicador/indicacoes", new URLSearchParams(listQuery))
  const fromRow = total === 0 ? 0 : (page - 1) * pageSize + 1
  const toRow = Math.min(total, page * pageSize)
  const pages = Math.max(1, Math.ceil(total / pageSize))

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(listQuery)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== "page") next.delete("page")
    router.replace(`/indicador/indicacoes?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Minhas Indicações"
        description={`Período ${period.label}. Somente as suas indicações.`}
      >
        <Button asChild>
          <Link href="/indicador/nova-indicacao">
            <Plus className="w-4 h-4 mr-2" />
            Nova Indicação
          </Link>
        </Button>
      </PageHeader>

      <div className="mb-4">
        <PeriodFilter />
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar indicações por nome"
            placeholder="Buscar por nome..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={(value) => setParam("status", value === "all" ? null : value)}>
            <SelectTrigger className="w-[180px]" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border p-6 text-sm">
          <p>Não foi possível carregar as indicações.</p>
          <Button className="mt-3" variant="outline" onClick={() => void loadLista()}>Tentar de novo</Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Indicado</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plano</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recompensa</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Data</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando o período.</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma indicação neste período.</td></tr>
              ) : (
                items.map((indicacao) => (
                  <tr key={indicacao.id} className="transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{indicacao.nomeIndicado}</p>
                      <p className="text-xs text-muted-foreground">{indicacao.telefoneIndicado}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">{indicacao.plano?.nome || "Plano"}</td>
                    <td className="px-4 py-3 text-sm font-medium">R$ {(indicacao.valorRecompensa ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-sm capitalize text-muted-foreground">{indicacao.tipoRecompensa === "pix" ? "Pix" : "Desconto"}</td>
                    <td className="px-4 py-3"><StatusBadge status={indicacao.status} /></td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{indicacao.createdAt.toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          href={`/indicador/indicacoes/${indicacao.id}?returnTo=${encodeURIComponent(returnTo)}`}
                          aria-label="Ver indicação"
                          onClick={() => rememberListScroll(returnTo)}
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>Página {page} de {pages}. Exibindo {fromRow}–{toRow} de {total}. Período: {period.label}.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>Próxima</Button>
          <Select value={String(pageSize)} onValueChange={(value) => setParam("pageSize", value)}>
            <SelectTrigger className="w-[110px]" aria-label="Itens por página"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
