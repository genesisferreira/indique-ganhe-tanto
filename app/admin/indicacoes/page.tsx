"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  emitReferralDataMutated,
  subscribeReferralDataMutated,
} from "@/lib/client/referral-data-sync"
import {
  REALTIME_TABLES_ADMIN,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoaderStatus } from "@/components/ui/loader-status"
import { useGuardedLoader } from "@/hooks/use-guarded-loader"
import {
  dataOutcome,
  LOADER_TIMEOUT_MESSAGE,
  loaderErrorMessage,
} from "@/lib/client/guarded-loader"
import type { AdminIndicacoesBundle } from "@/lib/admin-legacy/indicacoes-loader"
import { fetchIndicacoesPageOutcome } from "@/lib/admin-legacy/api-page-loaders"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { indicacoes, comerciais } from "@/lib/services/mock-data.service"
import {
  assignReferralToCommercialFromSupabase,
  updateAdminReferralStatusFromSupabase,
} from "@/lib/services"
import { Search, Eye, MoreHorizontal, UserPlus, RefreshCw } from "lucide-react"
import { CommercialSlaOverdueBadge } from "@/components/commercial/commercial-sla-overdue-badge"
import { CommercialRedistributedBadge } from "@/components/commercial/commercial-redistributed-badge"
import { devLogCommercialSla } from "@/lib/commercial-sla"
import { isPublicPreRegistrationReferral } from "@/lib/referral-reward-eligibility"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import type { Indicacao, Comercial } from "@/types"
import type { IndicacaoStatus } from "@/types/referral"
import type { UserRole } from "@/types/user"

const STATUS_ALTERAR_OPCOES: IndicacaoStatus[] = [
  "pendente",
  "em_atendimento",
  "em_negociacao",
  "em_andamento",
  "aprovada",
  "recusada",
]

export default function AdminIndicacoesPage() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")
  const [lista, setLista] = useState<Indicacao[]>([])
  const [comerciaisLista, setComerciaisLista] = useState<Comercial[]>([])
  const [comerciaisDisponiveis, setComerciaisDisponiveis] = useState(true)
  const [authRole, setAuthRole] = useState<UserRole | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(false)

  const podeMutar = authRole === "admin_master" || authRole === "admin_financeiro"

  // 3.1F-K1: um carregamento lógico = uma resolução de identidade (auth.getUser 1×).
  // Estados explícitos; erro/timeout nunca viram "zero indicações"; sem retry automático.
  const loadBundle = useCallback(async ({ signal }: { signal: AbortSignal }) => {
    if (isDataProviderMock()) {
      const bundle: AdminIndicacoesBundle = {
        lista: [...indicacoes],
        comerciais: [...comerciais],
        comerciaisDisponiveis: true,
        role: "admin_master",
      }
      return dataOutcome(bundle, bundle.lista.length === 0)
    }
    // 3.1F-K1S: leitura via /api/admin/indicacoes (sessão do usuário no servidor; sem lock de auth do
    // navegador). O signal do carregamento cancela o fetch real (timeout/desmontagem/retry).
    return fetchIndicacoesPageOutcome(signal)
  }, [])
  const { state, reload, retry } = useGuardedLoader<AdminIndicacoesBundle>(loadBundle, "admin-indicacoes")
  const carregando = state.status === "idle" || state.status === "loading"

  useEffect(() => {
    if (state.status !== "success" && state.status !== "empty") return
    const bundle = state.data
    setLista(bundle.lista)
    setComerciaisLista(bundle.comerciais)
    setComerciaisDisponiveis(bundle.comerciaisDisponiveis)
    setAuthRole(bundle.role)
    setHasLoaded(true)
    setDataVersion((v) => v + 1)
    devLogCommercialSla("admin indicacoes", {
      total: bundle.lista.length,
      sla: {
        warning: bundle.lista.filter((i) => i.slaLevel === "warning").length,
        critical: bundle.lista.filter((i) => i.slaLevel === "critical").length,
        redistribution_ready: bundle.lista.filter(
          (i) => i.slaLevel === "redistribution_ready"
        ).length,
      },
    })
  }, [state])

  /** Recarregamento silencioso (realtime/mutação): coalescido, mantém a lista atual visível. */
  const loadAdminReferrals = useCallback(
    (opts?: { silent?: boolean }) => reload({ silent: opts?.silent ?? false }),
    [reload]
  )

  useEffect(() => {
    return subscribeReferralDataMutated(() => {
      void loadAdminReferrals({ silent: true })
    })
  }, [loadAdminReferrals])

  useRealtimeReload(
    () => {
      void loadAdminReferrals({ silent: true })
    },
    REALTIME_TABLES_ADMIN,
    { enabled: !isDataProviderMock() }
  )

  const refreshAfterMutation = useCallback(async () => {
    await loadAdminReferrals({ silent: true })
    emitReferralDataMutated()
    router.refresh()
  }, [loadAdminReferrals, router])

  const filteredIndicacoes = lista.filter((indicacao: Indicacao) => {
    const matchesSearch =
      (indicacao.nomeIndicado ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (indicacao.telefoneIndicado ?? "").includes(search)
    const matchesStatus = statusFilter === "todos" || indicacao.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getIndicadorNome = (indicacao: Indicacao) => {
    if (
      isPublicPreRegistrationReferral({
        source: indicacao.source,
        erp_lead_source: indicacao.erpLeadSource,
      })
    ) {
      return "Captação direta"
    }
    return indicacao.indicador?.nome ?? "—"
  }

  const getComercialNome = (indicacao: Indicacao) => {
    if (!indicacao.comercialId) return "Não atribuído"
    return indicacao.comercial?.nome ?? "—"
  }

  const handleAtribuirComercial = useCallback(
    async (indicacao: Indicacao, comercialId: string) => {
      if (isDataProviderMock()) {
        toast.message("Indisponível no modo mock.")
        return
      }
      const comercial = comerciaisLista.find((c) => c.id === comercialId)
      setLista((prev) =>
        prev.map((item) =>
          item.id === indicacao.id
            ? {
                ...item,
                comercialId,
                comercial: comercial ?? item.comercial,
                updatedAt: new Date(),
              }
            : item
        )
      )
      setDataVersion((v) => v + 1)
      const r = await assignReferralToCommercialFromSupabase(indicacao.id, comercialId)
      if (r.ok) {
        toast.success("Comercial atribuído.")
        await refreshAfterMutation()
      } else {
        toast.error(r.message)
        await loadAdminReferrals({ silent: true })
      }
    },
    [comerciaisLista, loadAdminReferrals, refreshAfterMutation]
  )

  const handleAlterarStatus = useCallback(
    async (indicacao: Indicacao, novo: IndicacaoStatus) => {
      if (isDataProviderMock()) {
        toast.message("Indisponível no modo mock.")
        return
      }
      setLista((prev) =>
        prev.map((item) =>
          item.id === indicacao.id
            ? { ...item, status: novo, updatedAt: new Date() }
            : item
        )
      )
      setDataVersion((v) => v + 1)
      const r = await updateAdminReferralStatusFromSupabase(indicacao.id, novo)
      if (r.ok) {
        toast.success("Status atualizado.")
        await refreshAfterMutation()
      } else {
        toast.error(r.message)
        await loadAdminReferrals({ silent: true })
      }
    },
    [loadAdminReferrals, refreshAfterMutation]
  )

  const columns = useMemo(() => [
    {
      key: "indicado",
      header: "Indicado",
      cell: (indicacao: Indicacao) => (
        <div>
          <p className="font-medium">{indicacao.nomeIndicado}</p>
          <p className="text-sm text-muted-foreground">{indicacao.telefoneIndicado}</p>
        </div>
      ),
    },
    {
      key: "indicador",
      header: "Indicador",
      cell: (indicacao: Indicacao) => (
        <Link
          href={`/admin/indicadores/${indicacao.indicadorId}`}
          className="text-primary hover:underline"
        >
          {getIndicadorNome(indicacao)}
        </Link>
      ),
    },
    {
      key: "comercial",
      header: "Comercial",
      cell: (indicacao: Indicacao) => (
        <span className={indicacao.comercialId ? "" : "text-muted-foreground"}>
          {getComercialNome(indicacao)}
        </span>
      ),
    },
    {
      key: "plano",
      header: "Plano",
      cell: (indicacao: Indicacao) => (
        <span className="text-sm">{indicacao.plano?.nome || "Não informado"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (indicacao: Indicacao) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge status={indicacao.status} />
          <CommercialRedistributedBadge
            redistributionCount={indicacao.redistributionCount}
            previousCommercialName={indicacao.previousCommercialNome}
            variant="compact"
          />
          <CommercialSlaOverdueBadge
            level={indicacao.slaLevel}
            variant="compact"
          />
        </div>
      ),
    },
    {
      key: "data",
      header: "Data",
      cell: (indicacao: Indicacao) => (
        <span className="text-sm text-muted-foreground">
          {new Date(indicacao.createdAt).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      cell: (indicacao: Indicacao) => {
        const comerciaisAtribuicao = comerciaisLista.filter(
          (c: Comercial) => c.disponibilidade === "disponivel" && c.ativo !== false
        )
        return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Ações para a indicação de ${indicacao.nomeIndicado || "indicado"}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/indicacoes/${indicacao.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalhes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!podeMutar || isDataProviderMock()}>
                <UserPlus className="mr-2 h-4 w-4" />
                Atribuir Comercial
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {comerciaisAtribuicao.map((comercial: Comercial) => (
                    <DropdownMenuItem
                      key={comercial.id}
                      onSelect={(e) => {
                        e.preventDefault()
                        void handleAtribuirComercial(indicacao, comercial.id)
                      }}
                    >
                      {comercial.nome}
                    </DropdownMenuItem>
                  ))}
                {comerciaisAtribuicao.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {comerciaisDisponiveis
                      ? "Nenhum comercial disponível"
                      : "Lista de comerciais indisponível no momento"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!podeMutar || isDataProviderMock()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Alterar Status
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {STATUS_ALTERAR_OPCOES.map((st) => (
                  <DropdownMenuItem
                    key={st}
                    onSelect={(e) => {
                      e.preventDefault()
                      void handleAlterarStatus(indicacao, st)
                    }}
                  >
                    {st}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        )
      },
    },
  ], [podeMutar, comerciaisLista, comerciaisDisponiveis, handleAtribuirComercial, handleAlterarStatus])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Todas as Indicações"
        description={
          isDataProviderMock()
            ? "Dados de demonstração (modo mock)."
            : "Dados do Supabase."
        }
      />

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Lista de Indicações</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Label htmlFor="indicacoes-busca" className="sr-only">
                  Buscar indicações por nome ou telefone
                </Label>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="indicacoes-busca"
                  type="search"
                  placeholder="Buscar por nome ou telefone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[300px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filtrar por status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendente">Pendentes</SelectItem>
                  <SelectItem value="em_andamento">Em Andamento</SelectItem>
                  <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                  <SelectItem value="em_negociacao">Em Negociação</SelectItem>
                  <SelectItem value="aprovada">Aprovadas</SelectItem>
                  <SelectItem value="recusada">Recusadas</SelectItem>
                  <SelectItem value="paga">Pagas</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void retry()}
                disabled={carregando}
                aria-label="Atualizar lista de indicações"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {hasLoaded ? (
            <div data-loader-state={state.status}>
              {state.status === "error" || state.status === "timeout" ? (
                <div
                  role="alert"
                  className="mb-4 flex flex-col items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    {state.status === "timeout" ? LOADER_TIMEOUT_MESSAGE : loaderErrorMessage(state.errorClass)}{" "}
                    A lista abaixo pode estar desatualizada.
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void retry()}>
                    Tentar novamente
                  </Button>
                </div>
              ) : null}
              {carregando ? (
                <p role="status" aria-live="polite" className="mb-2 text-xs text-muted-foreground">
                  Atualizando…
                </p>
              ) : null}
              <DataTable
                key={dataVersion}
                data={filteredIndicacoes}
                getRowKey={(i) => i.id}
                columns={columns}
                emptyMessage={
                  lista.length === 0
                    ? "Nenhuma indicação cadastrada."
                    : "Nenhuma indicação corresponde aos filtros."
                }
              />
            </div>
          ) : (
            <LoaderStatus
              state={state}
              onRetry={() => void retry()}
              retryDisabled={carregando}
              loadingLabel="Carregando indicações…"
              emptyMessage="Nenhuma indicação cadastrada."
            >
              {() => null}
            </LoaderStatus>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
