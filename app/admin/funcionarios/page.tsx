"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Search } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import type { EmployeeStatus } from "@/types/employee"

type SectorOption = { code: string; name: string }

type EmployeeRow = {
  id: string
  name: string
  email: string
  phone: string | null
  status: EmployeeStatus
  sectors: Array<{ code: string; name: string; isActive: boolean }>
  updatedAt: string
}

export default function AdminFuncionariosPage() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [sector, setSector] = useState("all")
  const [sectors, setSectors] = useState<SectorOption[]>([])
  const [items, setItems] = useState<EmployeeRow[]>([])
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadSectors = useCallback(async () => {
    const res = await fetch("/api/admin/sectors", { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) {
      setSectors(
        (json.items ?? []).map((row: { code: string; name: string }) => ({
          code: row.code,
          name: row.name,
        }))
      )
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search.trim()) params.set("q", search.trim())
    if (status !== "all") params.set("status", status)
    if (sector !== "all") params.set("sector", sector)
    const res = await fetch(`/api/admin/employees?${params.toString()}`, { cache: "no-store" })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) {
      setItems(json.items ?? [])
      setCanWrite(Boolean(json.canWrite))
    }
    setLoading(false)
  }, [search, status, sector])

  useEffect(() => {
    void loadSectors()
  }, [loadSectors])

  useEffect(() => {
    void load()
  }, [load])

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
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 sm:w-64"
                  placeholder="Nome, e-mail ou telefone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="sm:w-40">
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
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger className="sm:w-44">
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
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={items}
            getRowKey={(item) => item.id}
            emptyMessage={loading ? "Carregando…" : "Nenhum funcionário encontrado."}
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
        </CardContent>
      </Card>
    </div>
  )
}
