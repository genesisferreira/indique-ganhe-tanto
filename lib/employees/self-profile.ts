import {
  EMPLOYEE_STATUS_LABELS,
  presentEmployeeAccountAccess,
  presentSectorMembershipLabel,
} from "@/lib/employees/admin-policy"
import { isEmployeeStatus } from "@/lib/employees/foundation"
import { formatUserRoleLabel } from "@/lib/auth/format-user-role-label"
import type { EmployeeStatus } from "@/types/employee"
import type { UserRole } from "@/types/user"

export const FUNCIONARIO_PROFILE_PATH = "/funcionario/perfil"
export const MANAGER_UNDEFINED_LABEL = "Não definido"

export type FuncionarioSelfProfileMembership = {
  name: string
  isActive: boolean
}

export type FuncionarioSelfProfileView = {
  fullName: string
  email: string
  phone: string
  cpfMasked: string
  birthDateLabel: string
  jobTitle: string
  employeeStatusLabel: string
  managerName: string
  memberships: FuncionarioSelfProfileMembership[]
  roleLabel: string
  accountStatusLabel: string
  firstAccessLabel: string
}

export type FuncionarioSelfProfileResult =
  | { kind: "unauthenticated" }
  | { kind: "wrong_role" }
  | { kind: "inactive" }
  | { kind: "missing_employee" }
  | { kind: "dismissed" }
  | { kind: "ok"; view: FuncionarioSelfProfileView }

export function sessionBoundProfileUserId(input: {
  sessionUserId: string | null | undefined
  requestedEmployeeId?: string | null
  requestedProfileId?: string | null
  requestedId?: string | null
}): string | null {
  void input.requestedEmployeeId
  void input.requestedProfileId
  void input.requestedId
  const id = String(input.sessionUserId ?? "").trim()
  return id.length > 0 ? id : null
}

export function maskEmployeeCpfForSelfDisplay(
  cpf: string | null | undefined
): string | null {
  if (cpf == null) return null
  const digits = String(cpf).replace(/\D/g, "")
  if (digits.length !== 11) return null
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`
}

export function formatBirthDateLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim()
  if (!raw) return "—"
  const date = new Date(`${raw.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("pt-BR")
}

export type FuncionarioSelfProfileRecords = {
  profile: {
    id: string
    role: string | null
    is_active: boolean | null
    must_change_password: boolean | null
    full_name: string | null
    email: string | null
    phone: string | null
    cpf: string | null
  } | null
  employee: {
    id: string
    profile_id: string
    status: string | null
    job_title: string | null
    birth_date: string | null
    manager_employee_id: string | null
  } | null
  managerName: string | null
  memberships: Array<{
    sectorCode: string
    sectorName: string | null
    isActive: boolean
  }>
}

export function presentFuncionarioSelfProfile(
  records: FuncionarioSelfProfileRecords
): FuncionarioSelfProfileResult {
  const profile = records.profile
  if (!profile) return { kind: "wrong_role" }
  if (profile.role !== "funcionario") return { kind: "wrong_role" }
  if (profile.is_active === false) return { kind: "inactive" }
  if (!records.employee || records.employee.profile_id !== profile.id) {
    return { kind: "missing_employee" }
  }
  if (records.employee.status === "dismissed") return { kind: "dismissed" }

  const status = isEmployeeStatus(records.employee.status)
    ? (records.employee.status as EmployeeStatus)
    : null
  const account = presentEmployeeAccountAccess({
    isActive: profile.is_active,
    mustChangePassword: profile.must_change_password,
  })
  const firstAccessLabel =
    profile.must_change_password === true
      ? "Primeiro acesso pendente"
      : "Primeiro acesso concluído"

  return {
    kind: "ok",
    view: {
      fullName: String(profile.full_name ?? "").trim() || "—",
      email: String(profile.email ?? "").trim() || "—",
      phone: String(profile.phone ?? "").trim() || "—",
      cpfMasked: maskEmployeeCpfForSelfDisplay(profile.cpf) ?? "—",
      birthDateLabel: formatBirthDateLabel(records.employee.birth_date),
      jobTitle: String(records.employee.job_title ?? "").trim() || "—",
      employeeStatusLabel: status ? EMPLOYEE_STATUS_LABELS[status] : "—",
      managerName: String(records.managerName ?? "").trim() || MANAGER_UNDEFINED_LABEL,
      memberships: records.memberships.map((item) => ({
        name: presentSectorMembershipLabel({
          code: item.sectorCode,
          name: item.sectorName,
        }),
        isActive: item.isActive,
      })),
      roleLabel: formatUserRoleLabel("funcionario" as UserRole),
      accountStatusLabel: account.label,
      firstAccessLabel,
    },
  }
}
