import type { UserRole } from "@/types/user"
import {
  CREATABLE_EMPLOYEE_STATUSES,
  EMPLOYEE_STATUSES,
  type CreatableEmployeeStatus,
  type EmployeeStatus,
} from "@/types/employee"
import { isEmployeeStatus } from "@/lib/employees/foundation"
import { isAdminMasterRole } from "@/lib/auth/sector-membership"

export { CREATABLE_EMPLOYEE_STATUSES, EMPLOYEE_STATUSES, isEmployeeStatus }

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Ativo",
  paused: "Pausado",
  vacation: "Férias",
  away: "Afastado",
  dismissed: "Desligado",
}

export const EMPLOYEE_ADMIN_EVENT_SOURCE = "employee_admin"

export type EmployeeAdminAction = "read" | "write"

export type EmployeeAdminAuthOk = {
  ok: true
  profileId: string
  role: UserRole
  canWrite: boolean
}

export type EmployeeAdminAuthFail = {
  ok: false
  status: 401 | 403
  message: string
}

export function authorizeEmployeeAdminAccess(input: {
  userId?: string | null
  profileId?: string | null
  role?: UserRole | string | null
  action: EmployeeAdminAction
}): EmployeeAdminAuthOk | EmployeeAdminAuthFail {
  if (!input.userId?.trim()) {
    return { ok: false, status: 401, message: "Sessão não encontrada. Faça login novamente." }
  }
  if (!input.profileId || input.profileId !== input.userId) {
    return { ok: false, status: 403, message: "Perfil não autorizado." }
  }
  const role = input.role as UserRole | null
  if (isAdminMasterRole(role)) {
    return { ok: true, profileId: input.profileId, role: "admin_master", canWrite: true }
  }
  if (role === "admin_consulta" && input.action === "read") {
    return { ok: true, profileId: input.profileId, role: "admin_consulta", canWrite: false }
  }
  if (role === "admin_financeiro" && input.action === "read") {
    return { ok: true, profileId: input.profileId, role: "admin_financeiro", canWrite: false }
  }
  if (role === "admin_consulta" || role === "admin_financeiro") {
    return {
      ok: false,
      status: 403,
      message: "Somente Admin Master altera funcionários e setores.",
    }
  }
  return {
    ok: false,
    status: 403,
    message: "Administração de funcionários restrita a perfis administrativos.",
  }
}

export function stripEmployeeAdminBrowserActor(body: unknown): Record<string, unknown> {
  const obj =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>) }
      : {}
  delete obj.actor_profile_id
  delete obj.actorProfileId
  delete obj.user_id
  delete obj.userId
  delete obj.role
  delete obj.source
  return obj
}

export type MembershipRowRef = {
  id: string
  isActive: boolean
  updatedAt?: string | null
  joinedAt?: string | null
}

export type MembershipDecision =
  | { action: "insert" }
  | { action: "activate"; membershipId: string }
  | { action: "deactivate"; membershipId: string }
  | { action: "reject_duplicate" }
  | { action: "noop" }

function latestMembership(rows: readonly MembershipRowRef[]): MembershipRowRef | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.updatedAt || a.joinedAt || "") || 0
    const tb = Date.parse(b.updatedAt || b.joinedAt || "") || 0
    return tb - ta
  })[0] ?? null
}

export function decideMembershipChange(input: {
  existing: readonly MembershipRowRef[]
  wantActive: boolean
}): MembershipDecision {
  const active = input.existing.filter((row) => row.isActive)
  if (input.wantActive) {
    if (active.length > 0) return { action: "reject_duplicate" }
    const inactive = input.existing.filter((row) => !row.isActive)
    const latestInactive = latestMembership(inactive)
    if (latestInactive) return { action: "activate", membershipId: latestInactive.id }
    return { action: "insert" }
  }
  if (active.length === 0) return { action: "noop" }
  return { action: "deactivate", membershipId: active[0]!.id }
}

export function canDeactivateMembership(activeAssignmentCount: number):
  | { ok: true }
  | { ok: false; code: "active_assignments"; count: number; message: string } {
  const count = Number.isFinite(activeAssignmentCount) ? Math.max(0, activeAssignmentCount) : 0
  if (count > 0) {
    return {
      ok: false,
      code: "active_assignments",
      count,
      message:
        count === 1
          ? "Há 1 item ativo atribuído neste setor. Reatribua ou encerre antes de remover a função."
          : `Há ${count} itens ativos atribuídos neste setor. Reatribua ou encerre antes de remover a função.`,
    }
  }
  return { ok: true }
}

export const LEGACY_COMMERCIAL_SECTOR_CODE = "commercial"

export const LEGACY_COMMERCIAL_MEMBERSHIP_LABEL = "Comercial — legado"

export const LEGACY_COMMERCIAL_MEMBERSHIP_WARNING =
  "O vínculo com este setor não habilita sozinho a distribuição de leads do Comercial. A operação atual também depende do perfil Comercial e das configurações de disponibilidade/distribuição."

export function isLegacyCommercialSector(code: string | null | undefined): boolean {
  return String(code ?? "").trim().toLowerCase() === LEGACY_COMMERCIAL_SECTOR_CODE
}

export function presentSectorMembershipLabel(input: {
  code: string
  name?: string | null
}): string {
  if (isLegacyCommercialSector(input.code)) return LEGACY_COMMERCIAL_MEMBERSHIP_LABEL
  const name = (input.name ?? "").trim()
  return name || input.code
}

export const ADMIN_SECTORS_VISIBLE_COLUMNS = [
  { key: "nome", header: "Nome" },
  { key: "codigo", header: "Código" },
  { key: "descricao", header: "Descrição" },
  { key: "situacao", header: "Situação" },
  { key: "membros_ativos", header: "Membros ativos" },
] as const

export function commercialMembershipDoesNotBypassLegacy(input: {
  profileRole: string | null | undefined
  hasCommercialLeadSettings: boolean
}): {
  bypassesLegacy: false
  commercialDistributionReady: boolean
  message: string
} {
  const ready =
    input.profileRole === "comercial" && input.hasCommercialLeadSettings === true
  return {
    bypassesLegacy: false,
    commercialDistributionReady: ready,
    message: LEGACY_COMMERCIAL_MEMBERSHIP_WARNING,
  }
}

export function parseRequestedEmployeeStatus(value: unknown): EmployeeStatus | null {
  const raw = String(value ?? "").trim()
  return isEmployeeStatus(raw) ? raw : null
}

export function parseCreatableEmployeeStatus(
  value: unknown
): CreatableEmployeeStatus | null {
  const parsed = parseRequestedEmployeeStatus(value)
  if (!parsed) return null
  return (CREATABLE_EMPLOYEE_STATUSES as readonly string[]).includes(parsed)
    ? (parsed as CreatableEmployeeStatus)
    : null
}

export function presentEmployeeAccountAccess(input: {
  isActive: boolean | null | undefined
  mustChangePassword: boolean | null | undefined
}): { label: string; loginPath: "/login" } {
  if (input.isActive === false) {
    return { label: "Inativa", loginPath: "/login" }
  }
  if (input.mustChangePassword === true) {
    return { label: "Primeiro acesso pendente", loginPath: "/login" }
  }
  return { label: "Ativa", loginPath: "/login" }
}

export function wouldCreateDirectManagerCycle(input: {
  employeeId: string
  managerEmployeeId: string | null
  managerOfManagerId: string | null
}): boolean {
  if (!input.managerEmployeeId) return false
  if (input.managerEmployeeId === input.employeeId) return true
  return input.managerOfManagerId === input.employeeId
}

export function matchesEmployeeSearch(input: {
  name: string | null | undefined
  email: string | null | undefined
  phone: string | null | undefined
  query: string
}): boolean {
  const q = input.query.trim().toLowerCase()
  if (!q) return true
  const hay = [input.name, input.email, input.phone]
    .map((value) => (value ?? "").toLowerCase())
    .join(" ")
  return hay.includes(q)
}

export const ADMIN_FINANCE_ACTION_HREFS = new Set([
  "/admin/pagamentos-pendentes",
  "/admin/upload-comprovante",
])

export function shouldShowSidebarHref(input: {
  href: string
  variant: "indicador" | "comercial" | "admin" | "funcionario"
  role: UserRole | null
  membershipCodes: readonly string[]
}): boolean {
  if (input.variant === "indicador") return true

  if (input.variant === "funcionario") {
    if (input.href === "/funcionario" || input.href === "/notificacoes") return true
    if (input.href === "/cobranca") {
      return input.membershipCodes.includes("collections")
    }
    if (input.href === "/retencao") {
      return input.membershipCodes.includes("retention")
    }
    return false
  }

  if (input.href === "/cobranca") {
    if (input.variant === "admin") {
      return (
        input.role === "admin_master" ||
        input.role === "admin_consulta" ||
        input.role === "admin_financeiro"
      )
    }
    return input.membershipCodes.includes("collections")
  }

  if (input.href === "/retencao") {
    if (input.variant === "admin") {
      return (
        input.role === "admin_master" ||
        input.role === "admin_consulta" ||
        input.role === "admin_financeiro"
      )
    }
    return input.membershipCodes.includes("retention")
  }

  if (input.variant === "admin" && input.role === "admin_consulta") {
    return !ADMIN_FINANCE_ACTION_HREFS.has(input.href)
  }

  return true
}

export type AdminNavGroupSpec = {
  title: string
  items: Array<{ label: string; href: string }>
}

export function adminNavGroupSpecs(): AdminNavGroupSpec[] {
  return [
    {
      title: "Visão geral",
      items: [
        { label: "Dashboard", href: "/admin" },
        { label: "Notificações", href: "/notificacoes" },
      ],
    },
    {
      title: "Comercial",
      items: [
        { label: "Indicações", href: "/admin/indicacoes" },
        { label: "Pipeline", href: "/admin/pipeline" },
        { label: "Indicadores", href: "/admin/indicadores" },
        { label: "Comerciais", href: "/admin/comerciais" },
      ],
    },
    {
      title: "Operação",
      items: [
        { label: "Cobrança", href: "/cobranca" },
        { label: "Retenção", href: "/retencao" },
      ],
    },
    {
      title: "Equipe",
      items: [
        { label: "Funcionários", href: "/admin/funcionarios" },
        { label: "Administradores", href: "/admin/admins" },
        { label: "Setores", href: "/admin/setores" },
      ],
    },
    {
      title: "Financeiro",
      items: [
        { label: "Recompensas", href: "/admin/financeiro" },
        { label: "Pagamentos Pendentes", href: "/admin/pagamentos-pendentes" },
        { label: "Histórico de Pagamentos", href: "/admin/historico-pagamentos" },
        { label: "Upload Comprovante", href: "/admin/upload-comprovante" },
      ],
    },
    {
      title: "Gestão",
      items: [
        { label: "Planos", href: "/admin/planos" },
        { label: "Relatórios", href: "/admin/relatorios" },
        { label: "Auditoria", href: "/admin/auditoria" },
      ],
    },
    {
      title: "Integrações",
      items: [
        { label: "BRByte / Controllr", href: "/admin/integracoes/brbyte" },
      ],
    },
    {
      title: "Configurações",
      items: [
        { label: "Configurações", href: "/admin/configuracoes" },
        { label: "Cobrança", href: "/admin/configuracoes/cobranca" },
      ],
    },
  ]
}

export function funcionarioNavGroupSpecs(): AdminNavGroupSpec[] {
  return [
    {
      title: "Visão geral",
      items: [
        { label: "Início", href: "/funcionario" },
        { label: "Notificações", href: "/notificacoes" },
      ],
    },
    {
      title: "Operação",
      items: [
        { label: "Cobrança", href: "/cobranca" },
        { label: "Retenção", href: "/retencao" },
      ],
    },
  ]
}

export function filterNavGroups<T extends { href: string }>(
  groups: Array<{ title: string; items: T[] }>,
  input: {
    variant: "indicador" | "comercial" | "admin" | "funcionario"
    role: UserRole | null
    membershipCodes: readonly string[]
  }
): Array<{ title: string; items: T[] }> {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        shouldShowSidebarHref({
          href: item.href,
          variant: input.variant,
          role: input.role,
          membershipCodes: input.membershipCodes,
        })
      ),
    }))
    .filter((group) => group.items.length > 0)
}
