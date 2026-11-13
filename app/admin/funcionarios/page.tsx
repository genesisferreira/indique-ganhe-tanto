"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { Plus, RefreshCw, Search } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoaderStatus } from "@/components/ui/loader-status"
import { useGuardedLoader } from "@/hooks/use-guarded-loader"
import { type EmployeeRow, type EmployeesData } from "@/lib/admin-legacy/employees-outcome"
import {
  loadEmployeesPageOutcome,
  loadSectorsPageOutcome,
  type SectorOption,
} from "@/lib/admin-legacy/page-loaders"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUSES,
  presentSectorMembershipLabel,
} from "@/lib/employees/admin-policy"

export default function AdminFuncionariosPage() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [sector, setSector] = useState("all")

  // 3.1F-K1B: o signal do carregamento vai até o fetch ({ signal }).
  const loadSectors = useCallback(async ({ signal }: { signal: AbortSignal }) => loadSectorsPageOutcome(signal), [])
  const sectorsLoader = useGuardedLoader<SectorOption[]>(loadSectors, "admin-sectors")
  const sectors: SectorOption[] =
    sectorsLoader.state.status === "success" ? sectorsLoader.state.data : []
  const sectorsUnavailable =
    sectorsLoader.state.status === "error" || sectorsLoader.state.status === "timeout"

  const params = new URLSearchParams()
  if (search.trim()) params.set("q", search.trim())
  if (status !== "all") params.set("status", status)
  if (sector !== "all") params.set("sector", sector)
  const query = params.toString()

  // 3.1F-K1: cada combinação de filtros é um carregamento; a troca descarta o anterior (stale guard + abort).
  const loadEmployees = useCallback(
    async ({ signal }: { signal: AbortSignal }) => loadEmployeesPageOutcome(query, signal),
    [query]
  )
  const { state, retry } = useGuardedLoader<EmployeesData>(loadEmployees, `admin-employees?${query}`)
  const loading = state.status === "idle" || state.status === "loading"
  const canWrite = state.status === "success" || state.status === "empty" ? state.data.canWrite : false
  const filtersActive = query.length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funcionários"
        description="Cadastro central de pessoas operacionais. Comerciais e Administradores permanecem como telas especializadas."
      >
        {canWrite ? (
          <Button asChild>
            <Link href="/admin/funcionarios/novo">
              <Plus className="mr-2 h-4 w-4" />
              Novo Funcionário
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-lg">Equipe operacional</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Label htmlFor="funcionarios-busca" className="sr-only">
                  Buscar funcionários por nome, e-mail ou telefone
                </Label>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="funcionarios-busca"
                  type="search"
                  autoComplete="off"
                  className="pl-9 sm:w-64"
                  placeholder="Nome, e-mail ou telefone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="sm:w-40" aria-label="Filtrar por estado">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os estados</SelectItem>
                  {EMPLOYEE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {EMPLOYEE_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sector} onValueChange={setSector} disabled={sectorsUnavailable}>
                <SelectTrigger
                  className="sm:w-44"
                  aria-label={sectorsUnavailable ? "Filtro por setor indisponível" : "Filtrar por setor"}
                >
                  <SelectValue placeholder="Setor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os setores</SelectItem>
                  {sectors.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {presentSectorMembershipLabel({ code: item.code, name: item.name })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void retry()}
                disabled={loading}
                aria-label="Atualizar lista de funcionários"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          {sectorsUnavailable ? (
            <p role="status" className="text-xs text-muted-foreground">
              Lista de setores indisponível no momento; o filtro por setor foi desativado.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => void sectorsLoader.retry()}>
                Tentar novamente
              </button>
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <LoaderStatus
            state={state}
            onRetry={() => void retry()}
            retryDisabled={loading}
            loadingLabel="Carregando funcionários…"
            emptyMessage={
              filtersActive
                ? "Nenhum funcionário corresponde aos filtros."
                : "Nenhum funcionário cadastrado."
            }
          >
            {({ items }) => (
              <DataTable
                data={items}
                getRowKey={(item) => item.id}
                emptyMessage="Nenhum funcionário encontrado."
                columns={[
                  {
                    key: "nome",
                    header: "Nome",
                    cell: (item) => (
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">{item.email}</p>
                        {item.phone ? (
                          <p className="text-sm text-muted-foreground">{item.phone}</p>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: (item) => (
                      <Badge variant={item.status === "active" ? "default" : "secondary"}>
                        {EMPLOYEE_STATUS_LABELS[item.status]}
                      </Badge>
                    ),
                  },
                  {
                    key: "setores",
                    header: "Setores",
                    cell: (item) => {
                      const active = item.sectors.filter((sector) => sector.isActive)
                      if (active.length === 0) {
                        return <span className="text-sm text-muted-foreground">Nenhum setor ativo</span>
                      }
                      return (
                        <div className="flex flex-wrap gap-1">
                          {active.map((sector) => (
                            <Badge key={sector.code} variant="outline">
                              {presentSectorMembershipLabel({
                                code: sector.code,
                                name: sector.name,
                              })}
                            </Badge>
                          ))}
                        </div>
                      )
                    },
                  },
                  {
                    key: "atualizado",
                    header: "Atualização",
                    cell: (item) => (
                      <span className="text-sm text-muted-foreground">
                        {item.updatedAt
                          ? new Date(item.updatedAt).toLocaleString("pt-BR")
                          : "—"}
                      </span>
                    ),
                  },
                  {
                    key: "acoes",
                    header: "Ações",
                    cell: (item) => (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/funcionarios/${item.id}`}>
                          {canWrite ? "Editar" : "Ver"}
                        </Link>
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </LoaderStatus>
        </CardContent>
      </Card>
    </div>
  )
}
