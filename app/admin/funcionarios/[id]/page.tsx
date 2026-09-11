"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
} from "@/lib/employees/admin-policy"
import type { EmployeeStatus } from "@/types/employee"

type Sector = { id: string; code: string; name: string; isActive: boolean }

type Membership = {
  id: string
  sectorCode: string
  sectorName: string
  isActive: boolean
  receivingAssignments: boolean | null
  isAvailable: boolean | null
  activeAssignments: number
}

type EmployeeDetail = {
  id: string
  name: string
  email: string
  phone: string | null
  status: EmployeeStatus
  notes: string | null
  memberships: Membership[]
  events: Array<{
    id: string
    eventType: string
    sectorName: string | null
    actorName: string | null
    createdAt: string
  }>
  commercialLegacy: {
    message: string
    distributionReady: boolean
  }
}

const EVENT_LABEL: Record<string, string> = {
  employee_created: "Funcionário criado",
  status_changed: "Status alterado",
  sector_added: "Setor adicionado",
  sector_removed: "Setor desativado",
  employee_dismissed: "Desligado",
  employee_reactivated: "Reativado",
}

export default function FuncionarioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null)
  const [sectors, setSectors] = useState<Sector[]>([])
  const [canWrite, setCanWrite] = useState(false)
  const [status, setStatus] = useState<EmployeeStatus>("active")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [empRes, sectorRes] = await Promise.all([
      fetch(`/api/admin/employees/${id}`, { cache: "no-store" }),
      fetch("/api/admin/sectors", { cache: "no-store" }),
    ])
    const empJson = await empRes.json().catch(() => null)
    const sectorJson = await sectorRes.json().catch(() => null)
    if (!empRes.ok || !empJson?.ok) {
      toast.error(empJson?.message || "Funcionário não encontrado.")
      return
    }
    setEmployee(empJson.employee)
    setCanWrite(Boolean(empJson.canWrite))
    setStatus(empJson.employee.status)
    setNotes(empJson.employee.notes ?? "")
    if (sectorRes.ok && sectorJson?.ok) setSectors(sectorJson.items ?? [])
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function saveStatus() {
    setBusy(true)
    const res = await fetch(`/api/admin/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível salvar.")
      return
    }
    toast.success("Dados atualizados.")
    await load()
  }

  async function toggleSector(code: string, nextActive: boolean) {
    setBusy(true)
    const res = await fetch(`/api/admin/employees/${id}/memberships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectorCode: code, active: nextActive }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível atualizar o setor.")
      return
    }
    if (json.commercialWarning) toast.message(json.commercialWarning)
    else toast.success("Setor atualizado.")
    await load()
  }

  if (!employee) {
    return <p className="text-muted-foreground">Carregando funcionário…</p>
  }

  const membershipByCode = new Map(employee.memberships.map((item) => [item.sectorCode, item]))

  return (
    <div className="space-y-6">
      <PageHeader title={employee.name} description={`${employee.email}${employee.phone ? ` · ${employee.phone}` : ""}`}>
        <Button asChild variant="outline">
          <Link href="/admin/funcionarios">Voltar</Link>
        </Button>
      </PageHeader>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Dados do funcionário</CardTitle>
          <CardDescription>O perfil de acesso legado permanece separado das funções operacionais.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Nome:</span> {employee.name}</p>
          <p><span className="text-muted-foreground">E-mail:</span> {employee.email}</p>
          <p><span className="text-muted-foreground">Telefone:</span> {employee.phone || "—"}</p>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            Somente funcionários ativos entram em novas atribuições. Pausado, férias, afastado e
            desligado ficam fora do motor 2.2.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Estado</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as EmployeeStatus)}
              disabled={!canWrite || busy}
            >
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYEE_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {EMPLOYEE_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Observações internas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canWrite || busy}
              maxLength={500}
            />
          </div>
          {canWrite ? (
            <Button disabled={busy} onClick={() => void saveStatus()}>
              Salvar status
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Somente leitura para o seu perfil.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Setores e funções</CardTitle>
          <CardDescription>
            Um funcionário pode ter vários setores ao mesmo tempo. A membership é a função
            operacional; o role legado não é alterado aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sectors.map((sector) => {
            const membership = membershipByCode.get(sector.code)
            const checked = membership?.isActive === true
            return (
              <label
                key={sector.code}
                className="flex items-start justify-between gap-4 rounded-lg border p-3"
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={checked}
                    disabled={!canWrite || busy}
                    onCheckedChange={(value) => void toggleSector(sector.code, value === true)}
                  />
                  <div>
                    <p className="font-medium">{sector.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {checked ? "Membership ativa" : membership ? "Inativa (histórico preservado)" : "Sem vínculo"}
                    </p>
                  </div>
                </div>
                <Badge variant={checked ? "default" : "secondary"}>
                  {checked ? "Ativo" : "Inativo"}
                </Badge>
              </label>
            )
          })}
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Configurações operacionais</CardTitle>
          <CardDescription>
            Estado do funcionário, membership e disponibilidade de fila são conceitos diferentes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {employee.memberships.filter((item) => item.isActive).length === 0 ? (
            <p className="text-muted-foreground">Nenhuma membership ativa.</p>
          ) : (
            employee.memberships
              .filter((item) => item.isActive)
              .map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <p className="font-medium">{item.sectorName}</p>
                  <p className="text-muted-foreground">
                    Recebe trabalhos:{" "}
                    {item.receivingAssignments == null ? "—" : item.receivingAssignments ? "sim" : "não"}
                    {" · "}
                    Disponível na fila:{" "}
                    {item.isAvailable == null ? "—" : item.isAvailable ? "sim" : "não"}
                    {" · "}
                    Itens ativos: {item.activeAssignments}
                  </p>
                </div>
              ))
          )}
          <p className="text-muted-foreground">{employee.commercialLegacy.message}</p>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {employee.events.length === 0 ? (
              <li className="text-muted-foreground">Nenhum evento administrativo.</li>
            ) : (
              employee.events.map((event) => (
                <li key={event.id}>
                  {new Date(event.createdAt).toLocaleString("pt-BR")} ·{" "}
                  {EVENT_LABEL[event.eventType] ?? event.eventType}
                  {event.sectorName ? ` · ${event.sectorName}` : ""}
                  {event.actorName ? ` · ${event.actorName}` : ""}
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
