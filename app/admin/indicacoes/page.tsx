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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { indicacoes, comerciais } from "@/lib/services/mock-data.service"
import {
  assignReferralToCommercialFromSupabase,
  getAuthProfileBasicsFromSupabase,
  loadAdminComerciaisFromSupabase,
  loadAdminReferralsFromSupabase,
  updateAdminReferralStatusFromSupabase,
} from "@/lib/services"
import { Search, Eye, MoreHorizontal, UserPlus, RefreshCw } from "lucide-react"
import { CommercialSlaOverdueBadge } from "@/components/commercial/commercial-sla-overdue-badge"
import { CommercialRedistributedBadge } from "@/components/commercial/commercial-redistributed-badge"
import { devLogCommercialSla } from "@/lib/commercial-sla"
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
  const [carregando, setCarregando] = useState(true)
  const [authRole, setAuthRole] = useState<UserRole | null>(null)
  const [dataVersion, setDataVersion] = useState(0)

  const podeMutar = authRole === "admin_master" || authRole === "admin_financeiro"

  const loadAdminReferrals = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setCarregando(true)
    if (isDataProviderMock()) {
      setLista([...indicacoes])
      setComerciaisLista([...comerciais])
      if (process.env.NODE_ENV === "development") {
        console.log("[page-data:debug]", {
          page: "/admin/indicacoes",
          source: "mock",
          total: indicacoes.length,
        })
      }
      setCarregando(false)
      return
    }
    const [remote, comRemoto, basics] = await Promise.all([
      loadAdminReferralsFromSupabase(),
      loadAdminComerciaisFromSupabase(),
      getAuthProfileBasicsFromSupabase(),
    ])
    setAuthRole(basics?.role ?? null)
    if (!remote.ok) {
      console.error("[admin-indicacoes:error]", remote.error, remote.meta)
      toast.error(
        remote.error ||
          "Não foi possível carregar as indicações. Veja o console."
      )
      setLista([])
      setComerciaisLista([...(comRemoto ?? [])])
      setCarregando(false)
      return
    }
    if (process.env.NODE_ENV === "development") {
      console.log("[page-data:debug]", {
        page: "/admin/indicacoes",
        source: "supabase",
        total: remote.data.length,
        meta: remote.meta,
      })
    }
    const listaRemota = [...remote.data]
    setLista(listaRemota)
    setComerciaisLista([...(comRemoto ?? [])])
    devLogCommercialSla("admin indicacoes", {
      total: listaRemota.length,
      sla: {
        warning: listaRemota.filter((i) => i.slaLevel === "warning").length,
        critical: listaRemota.filter((i) => i.slaLevel === "critical").length,
        redistribution_ready: listaRemota.filter(
          (i) => i.slaLevel === "redistribution_ready"
        ).length,
      },
    })
    setCarregando(false)
  }, [])

  useEffect(() => {
    void loadAdminReferrals()
  }, [loadAdminReferrals])

  useEffect(() => {
    return subscribeReferralDataMutated(() => {
      void loadAdminReferrals({ silent: true }).then(() => {
        setDataVersion((v) => v + 1)
      })
    })
  }, [loadAdminReferrals])

  useRealtimeReload(
    () => {
      void loadAdminReferrals({ silent: true }).then(() => {
        setDataVersion((v) => v + 1)
      })
    },
    REALTIME_TABLES_ADMIN,
    { enabled: !isDataProviderMock() }
  )

  const refreshAfterMutation = useCallback(async () => {
    await loadAdminReferrals({ silent: true })
    setDataVersion((v) => v + 1)
    emitReferralDataMutated()
    router.refresh()
  }, [loadAdminReferrals, router])

  const filteredIndicacoes = lista.filter((indicacao: Indicacao) => {
    const matchesSearch =
      indicacao.nomeIndicado.toLowerCase().includes(search.toLowerCase()) ||
      indicacao.telefoneIndicado.includes(search)
    const matchesStatus = statusFilter === "todos" || indicacao.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getIndicadorNome = (indicacao: Indicacao) =>
    indicacao.indicador?.nome ?? "—"

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
        setDataVersion((v) => v + 1)
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
        setDataVersion((v) => v + 1)
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
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
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
                  <DropdownMenuItem disabled>Nenhum comercial disponível</DropdownMenuItem>
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
  ], [podeMutar, comerciaisLista, handleAtribuirComercial, handleAlterarStatus])

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
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou telefone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[300px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
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
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <DataTable
              key={dataVersion}
              data={filteredIndicacoes}
              getRowKey={(i) => i.id}
              columns={columns}
              emptyMessage="Nenhuma indicação encontrada"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
