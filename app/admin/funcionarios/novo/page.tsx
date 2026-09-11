"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CREATABLE_EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  isLegacyCommercialSector,
  presentSectorMembershipLabel,
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

type Sector = { id: string; code: string; name: string; isActive: boolean }
type EmployeeOption = { id: string; name: string; status: string }

function newIdempotencyKey() {
  return crypto.randomUUID()
}

export default function NovoFuncionarioPage() {
  const router = useRouter()
  const idempotencyKey = useRef(newIdempotencyKey())
  const submitting = useRef(false)
  const [mode, setMode] = useState<"create" | "link">("create")
  const [busy, setBusy] = useState(false)
  const [fullName, setFullName] = useState("")
  const [cpf, setCpf] = useState("")
  const [birthDate, setBirthDate] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [managerEmployeeId, setManagerEmployeeId] = useState("")
  const [status, setStatus] = useState<EmployeeStatus>("active")
  const [sectorCodes, setSectorCodes] = useState<string[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [managers, setManagers] = useState<EmployeeOption[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<{
    employeeId: string
    login: string
    temporaryPassword: string | null
  } | null>(null)

  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ProfileHit[]>([])
  const [selected, setSelected] = useState<ProfileHit | null>(null)
  const [note, setNote] = useState("")

  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/sectors", { cache: "no-store" }),
      fetch("/api/admin/employees", { cache: "no-store" }),
    ]).then(async ([sectorRes, empRes]) => {
      const sectorJson = await sectorRes.json().catch(() => null)
      const empJson = await empRes.json().catch(() => null)
      if (sectorRes.ok && sectorJson?.ok) setSectors(sectorJson.items ?? [])
      if (empRes.ok && empJson?.ok) {
        setManagers(
          ((empJson.items ?? []) as Array<{ id: string; name: string; status: string }>).map(
            (item) => ({ id: item.id, name: item.name, status: item.status })
          )
        )
      }
    })
  }, [])

  function toggleSector(code: string, checked: boolean) {
    setSectorCodes((current) =>
      checked ? [...new Set([...current, code])] : current.filter((item) => item !== code)
    )
  }

  async function createEmployee() {
    if (submitting.current || busy) return
    submitting.current = true
    setBusy(true)
    setFieldErrors({})
    const res = await fetch("/api/admin/employees/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: idempotencyKey.current,
        fullName,
        cpf,
        birthDate: birthDate || null,
        phone,
        email,
        jobTitle: jobTitle || null,
        managerEmployeeId: managerEmployeeId || null,
        status,
        sectorCodes,
        role: "admin_master",
      }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    submitting.current = false
    if (!res.ok || !json?.ok) {
      const message = json?.message || "Não foi possível criar o funcionário."
      toast.error(message)
      if (/e-mail/i.test(message)) setFieldErrors({ email: message })
      else if (/cpf/i.test(message)) setFieldErrors({ cpf: message })
      else if (/telefone/i.test(message)) setFieldErrors({ phone: message })
      else if (/nome/i.test(message)) setFieldErrors({ fullName: message })
      return
    }
    setCreated({
      employeeId: json.employeeId,
      login: json.login,
      temporaryPassword: json.temporaryPassword ?? null,
    })
    toast.success("Funcionário criado.")
  }

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
    if (!selected || submitting.current) return
    if (selected.employeeId) {
      router.push(`/admin/funcionarios/${selected.employeeId}`)
      return
    }
    submitting.current = true
    setBusy(true)
    const res = await fetch("/api/admin/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: selected.id, status }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    submitting.current = false
    if (!res.ok || !json?.ok) {
      toast.error(json?.message || "Não foi possível vincular o funcionário.")
      return
    }
    toast.success(json.created ? "Funcionário vinculado." : "Funcionário já existia.")
    router.push(`/admin/funcionarios/${json.employeeId}`)
  }

  const operationalSectors = sectors.filter((sector) => !isLegacyCommercialSector(sector.code))
  const commercialSector = sectors.find((sector) => isLegacyCommercialSector(sector.code))

  if (created) {
    return (
      <div className="space-y-6">
        <PageHeader title="Funcionário criado" description="Acesso inicial gerado. O login continua em /login." />
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Credencial temporária</CardTitle>
            <CardDescription>
              Mostre esta senha uma vez ao colaborador. Ela não fica salva no cadastro.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">Login:</span> {created.login}</p>
            <p>
              <span className="text-muted-foreground">Senha temporária:</span>{" "}
              {created.temporaryPassword ?? "Já emitida nesta chave. Não é reexibida."}
            </p>
            <p className="text-muted-foreground">No primeiro acesso o funcionário troca a senha em /primeiro-acesso.</p>
            <Button onClick={() => router.push(`/admin/funcionarios/${created.employeeId}`)}>
              Ver funcionário
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Novo funcionário"
        description="Cria conta Auth, perfil funcionario, employee e setores. Login central em /login."
      >
        <Button asChild variant="outline">
          <Link href="/admin/funcionarios">Voltar</Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <Button variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>
          Criar novo funcionário
        </Button>
        <Button variant={mode === "link" ? "default" : "outline"} onClick={() => setMode("link")}>
          Vincular usuário existente
        </Button>
      </div>

      {mode === "create" ? (
        <div className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>1. Dados pessoais</CardTitle>
              <CardDescription>Campos obrigatórios marcados. Validação também ocorre no servidor.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Nome completo *</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                {fieldErrors.fullName ? <p className="text-sm text-destructive">{fieldErrors.fullName}</p> : null}
              </div>
              <div className="space-y-2">
                <Label>CPF *</Label>
                <Input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="somente números" />
                {fieldErrors.cpf ? <p className="text-sm text-destructive">{fieldErrors.cpf}</p> : null}
              </div>
              <div className="space-y-2">
                <Label>Data de nascimento</Label>
                <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Telefone *</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                {fieldErrors.phone ? <p className="text-sm text-destructive">{fieldErrors.phone}</p> : null}
              </div>
              <div className="space-y-2">
                <Label>E-mail (login) *</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                {fieldErrors.email ? <p className="text-sm text-destructive">{fieldErrors.email}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>2. Acesso</CardTitle>
              <CardDescription>
                A identidade global será funcionario. Senha temporária gerada no servidor. Não cria admin nem comercial.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Login em /login. Primeiro acesso em /primeiro-acesso com troca obrigatória de senha.
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>3. Cargo / estrutura</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Cargo</Label>
                <Input
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Atendente, Técnico, Supervisor…"
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label>Gestor</Label>
                <Select
                  value={managerEmployeeId || "none"}
                  onValueChange={(value) => setManagerEmployeeId(value === "none" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem gestor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem gestor</SelectItem>
                    {managers.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Estado inicial *</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as EmployeeStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATABLE_EMPLOYEE_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {EMPLOYEE_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>4. Setores / funções</CardTitle>
              <CardDescription>Catálogo carregado de public.sectors. Múltiplas funções permitidas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {operationalSectors.map((sector) => (
                <label key={sector.code} className="flex items-start gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={sectorCodes.includes(sector.code)}
                    onCheckedChange={(value) => toggleSector(sector.code, value === true)}
                    disabled={!sector.isActive}
                  />
                  <div>
                    <p className="font-medium">
                      {presentSectorMembershipLabel({ code: sector.code, name: sector.name })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {sector.code === "collections"
                        ? "Torna elegível conforme regras existentes. Não dispara Sync Controllr nem cria caso."
                        : sector.code === "retention"
                          ? "Habilita autorização futura. Não cria round-robin nem caso."
                          : "Membership operacional."}
                    </p>
                  </div>
                </label>
              ))}
              {commercialSector ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <p className="font-medium">Comercial — legado</p>
                  <p className="text-muted-foreground">
                    Não disponível neste cadastro genérico. O Comercial 2.1B continua no fluxo especializado.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>5. Revisão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{fullName || "Nome pendente"} · {email || "e-mail pendente"}</p>
              <p>Cargo: {jobTitle || "—"} · Estado: {EMPLOYEE_STATUS_LABELS[status]}</p>
              <p>Setores: {sectorCodes.length ? sectorCodes.join(", ") : "nenhum"}</p>
              <Button disabled={busy} onClick={() => void createEmployee()}>
                {busy ? "Criando funcionário…" : "6. Criar funcionário"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Vincular usuário existente</CardTitle>
            <CardDescription>
              Opção secundária. Não cria Auth. Evita duplicar perfil já cadastrado.
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
            {selected && !selected.employeeId ? (
              <div className="space-y-2">
                <Label>Estado inicial</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as EmployeeStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATABLE_EMPLOYEE_STATUSES.map((value) => (
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
      )}
    </div>
  )
}
