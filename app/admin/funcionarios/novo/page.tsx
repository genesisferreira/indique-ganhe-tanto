"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

type ProfileHit = {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  employeeId: string | null
}

export default function NovoFuncionarioPage() {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ProfileHit[]>([])
  const [selected, setSelected] = useState<ProfileHit | null>(null)
  const [status, setStatus] = useState<EmployeeStatus>("active")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")

  async function search() {
    setBusy(true)
    const res = await fetch(
      `/api/admin/employees/search-profiles?q=${encodeURIComponent(query)}`,
      { cache: "no-store" }
    )
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível buscar usuários.")
      return
    }
    setHits(json.items ?? [])
    setNote(String(json.authCreationNote ?? ""))
    setSelected(null)
  }

  async function link() {
    if (!selected) return
    if (selected.employeeId) {
      router.push(`/admin/funcionarios/${selected.employeeId}`)
      return
    }
    setBusy(true)
    const res = await fetch("/api/admin/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: selected.id, status }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível vincular o funcionário.")
      return
    }
    toast.success(json.created ? "Funcionário criado." : "Funcionário já existia.")
    router.push(`/admin/funcionarios/${json.employeeId}`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Novo funcionário"
        description="Vincule um usuário já existente. Esta sprint não cria conta Auth."
      >
        <Button asChild variant="outline">
          <Link href="/admin/funcionarios">Voltar</Link>
        </Button>
      </PageHeader>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Buscar usuário existente</CardTitle>
          <CardDescription>
            Pesquise por nome, e-mail ou telefone para evitar contas duplicadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome, e-mail ou telefone"
              onKeyDown={(e) => {
                if (e.key === "Enter") void search()
              }}
            />
            <Button disabled={busy || query.trim().length < 2} onClick={() => void search()}>
              Buscar
            </Button>
          </div>
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

          <ul className="space-y-2">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => setSelected(hit)}
                  className={`w-full rounded-lg border p-3 text-left ${
                    selected?.id === hit.id ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <p className="font-medium">{hit.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {hit.email}
                    {hit.phone ? ` · ${hit.phone}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {hit.employeeId ? "Já é funcionário" : `Perfil: ${hit.role}`}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          {hits.length === 0 && note ? (
            <p className="text-sm text-muted-foreground">
              Nenhum usuário encontrado. Não criamos Auth nesta tela.
            </p>
          ) : null}

          {selected && !selected.employeeId ? (
            <div className="space-y-2">
              <Label>Estado inicial</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as EmployeeStatus)}>
                <SelectTrigger>
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
          ) : null}

          <Button disabled={busy || !selected} onClick={() => void link()}>
            {selected?.employeeId ? "Abrir cadastro existente" : "Vincular funcionário"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
