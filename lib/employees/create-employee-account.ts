import { isValidCPF, isValidPhoneBR } from "@/lib/client/formatters"
import {
  normalizeReferralDocument,
  normalizeReferralPhone,
} from "@/lib/referral-field-normalize"
import { generateAssistedTemporaryPassword } from "@/lib/commercial-assisted/temporary-password"
import { assertNoSecretsInAuditMetadata } from "@/lib/commercial-assisted/create-assisted-indicator"
import {
  isUniqueViolationError,
  normalizeAssistedIdempotencyKey,
} from "@/lib/commercial-assisted/idempotency"
import {
  authorizeEmployeeAdminAccess,
  isLegacyCommercialSector,
  parseCreatableEmployeeStatus,
  wouldCreateDirectManagerCycle,
} from "@/lib/employees/admin-policy"
import type { UserRole } from "@/types/user"
import type { CreatableEmployeeStatus } from "@/types/employee"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPLOYEE_LOGIN_PATH = "/login" as const
const FORBIDDEN_CREATED_ROLES = new Set([
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
  "comercial",
])

export const EMPLOYEE_ACCOUNT_AUDIT_SOURCE = "employee_account_create"

export type EmployeeAccountClientPayload = {
  idempotencyKey?: unknown
  idempotency_key?: unknown
  fullName?: unknown
  full_name?: unknown
  cpf?: unknown
  phone?: unknown
  email?: unknown
  birthDate?: unknown
  birth_date?: unknown
  jobTitle?: unknown
  job_title?: unknown
  managerEmployeeId?: unknown
  manager_employee_id?: unknown
  status?: unknown
  sectorCodes?: unknown
  sector_codes?: unknown
  notes?: unknown
  role?: unknown
  is_active?: unknown
  actor_profile_id?: unknown
}

export type EmployeeAccountValidated = {
  idempotencyKey: string
  fullName: string
  cpf: string
  phone: string
  email: string
  birthDate: string | null
  jobTitle: string | null
  managerEmployeeId: string | null
  status: CreatableEmployeeStatus
  sectorCodes: string[]
  notes: string | null
}

export type EmployeeAccountCreationRow = {
  id: string
  idempotency_key: string
  actor_profile_id: string | null
  auth_user_id: string | null
  profile_id: string | null
  employee_id: string | null
  status: "pending" | "created" | "failed"
}

export type EmployeeAccountProfileRow = {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  cpf: string | null
  role: string
  is_active: boolean | null
  must_change_password: boolean | null
}

export type EmployeeAccountSector = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export type CreationUpdateResult = { ok: true } | { ok: false; message: string }

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

export function validateBirthDate(
  value: unknown
): { ok: true; date: string | null } | { ok: false; message: string } {
  const raw = asString(value).trim()
  if (!raw) return { ok: true, date: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, message: "Informe a data de nascimento no formato AAAA-MM-DD." }
  }
  const date = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    return { ok: false, message: "Data de nascimento inválida." }
  }
  const now = new Date()
  const age =
    now.getUTCFullYear() -
    date.getUTCFullYear() -
    (now.getUTCMonth() < date.getUTCMonth() ||
    (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())
      ? 1
      : 0)
  if (date.getTime() > Date.now() || age > 90 || age < 16) {
    return { ok: false, message: "Data de nascimento fora do intervalo permitido." }
  }
  return { ok: true, date: raw }
}

export function validateEmployeeAccountClientPayload(
  body: EmployeeAccountClientPayload
):
  | { ok: true; data: EmployeeAccountValidated }
  | { ok: false; message: string } {
  const idempotencyKey = normalizeAssistedIdempotencyKey(
    body.idempotencyKey ?? body.idempotency_key
  )
  if (!idempotencyKey) {
    return {
      ok: false,
      message: "Chave de idempotência inválida. Recarregue e tente novamente.",
    }
  }

  const fullName = asString(body.fullName ?? body.full_name).trim()
  if (fullName.length < 3) {
    return { ok: false, message: "Informe o nome completo do funcionário." }
  }

  const cpf = normalizeReferralDocument(asString(body.cpf))
  if (!cpf || cpf.length !== 11 || !isValidCPF(cpf)) {
    return { ok: false, message: "Informe um CPF válido." }
  }

  const phone = normalizeReferralPhone(asString(body.phone))
  if (!phone || !isValidPhoneBR(phone)) {
    return { ok: false, message: "Informe um telefone válido com DDD." }
  }

  const email = asString(body.email).trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Informe um e-mail válido para o login." }
  }

  const birth = validateBirthDate(body.birthDate ?? body.birth_date)
  if (!birth.ok) return birth

  const jobRaw = asString(body.jobTitle ?? body.job_title).trim()
  const jobTitle = jobRaw ? jobRaw.slice(0, 80) : null

  const managerRaw = asString(body.managerEmployeeId ?? body.manager_employee_id).trim()
  const managerEmployeeId = managerRaw || null

  const status = parseCreatableEmployeeStatus(body.status) ?? "active"
  if (asString(body.status).trim() && !parseCreatableEmployeeStatus(body.status)) {
    return {
      ok: false,
      message: "Estado inicial inválido. Não é possível criar já como desligado.",
    }
  }

  const sectorInput = body.sectorCodes ?? body.sector_codes
  const sectorCodes = Array.isArray(sectorInput)
    ? [...new Set(sectorInput.map((item) => asString(item).trim()).filter(Boolean))]
    : []
  if (sectorCodes.some((code) => isLegacyCommercialSector(code))) {
    return {
      ok: false,
      message:
        "O cadastro genérico não ativa o Comercial legado. Use o fluxo especializado do Comercial 2.1B.",
    }
  }

  const notesRaw = asString(body.notes).trim()
  const notes = notesRaw ? notesRaw.slice(0, 500) : null

  return {
    ok: true,
    data: {
      idempotencyKey,
      fullName,
      cpf,
      phone,
      email,
      birthDate: birth.date,
      jobTitle,
      managerEmployeeId,
      status,
      sectorCodes,
      notes,
    },
  }
}

export function buildEmployeeAccountAuditMetadata(input: {
  actorProfileId: string
  profileId: string
  employeeId: string
  idempotencyKey: string
  status: string
  jobTitle: string | null
  managerEmployeeId: string | null
  sectorCodes: string[]
}): Record<string, unknown> {
  return {
    source: EMPLOYEE_ACCOUNT_AUDIT_SOURCE,
    actor_profile_id: input.actorProfileId,
    profile_id: input.profileId,
    employee_id: input.employeeId,
    idempotency_key: input.idempotencyKey,
    status: input.status,
    job_title: input.jobTitle,
    manager_employee_id: input.managerEmployeeId,
    sector_codes: input.sectorCodes,
    login_path: EMPLOYEE_LOGIN_PATH,
  }
}

export type CreateEmployeeAccountDeps = {
  getUser: () => Promise<{ id: string } | null>
  getActorProfile: (userId: string) => Promise<{
    id: string
    role: string
    is_active: boolean | null
  } | null>
  findCreationByKey: (key: string) => Promise<EmployeeAccountCreationRow | null>
  insertCreationPending: (input: {
    idempotencyKey: string
    actorProfileId: string
  }) => Promise<{ id: string } | { error: string; uniqueViolation?: boolean }>
  updateCreation: (input: {
    id: string
    status?: "pending" | "created" | "failed"
    authUserId?: string | null
    profileId?: string | null
    employeeId?: string | null
  }) => Promise<CreationUpdateResult>
  findProfileByEmail: (email: string) => Promise<EmployeeAccountProfileRow | null>
  findProfileByCpf: (cpf: string) => Promise<EmployeeAccountProfileRow | null>
  findProfileById: (id: string) => Promise<EmployeeAccountProfileRow | null>
  findEmployeeByProfileId: (profileId: string) => Promise<{ id: string } | null>
  findEmployeeById: (id: string) => Promise<{
    id: string
    managerEmployeeId: string | null
  } | null>
  listSectors: () => Promise<EmployeeAccountSector[]>
  createAuthUser: (input: {
    email: string
    password: string
    metadata: { full_name: string; phone: string }
  }) => Promise<
    | { ok: true; userId: string }
    | { ok: false; code: "email_exists" | "create_failed"; message?: string }
  >
  deleteAuthUser: (userId: string) => Promise<{ ok: boolean }>
  updateProfileAfterCreate: (input: {
    profileId: string
    fullName: string
    email: string
    phone: string
    cpf: string
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  insertEmployee: (input: {
    profileId: string
    status: CreatableEmployeeStatus
    jobTitle: string | null
    birthDate: string | null
    managerEmployeeId: string | null
    notes: string | null
  }) => Promise<{ ok: true; employeeId: string } | { ok: false; message: string }>
  insertMemberships: (input: {
    employeeId: string
    sectorIds: string[]
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  insertAuditEvents: (input: {
    employeeId: string
    actorProfileId: string
    metadata: Record<string, unknown>
    sectorCodes: string[]
  }) => Promise<void>
  generateTemporaryPassword?: () => string
  waitForProfile?: (userId: string) => Promise<EmployeeAccountProfileRow | null>
}

export type CreateEmployeeAccountResult =
  | {
      ok: true
      replayed: boolean
      employeeId: string
      profileId: string
      login: string
      loginPath: "/login"
      role: "funcionario"
      temporaryPassword: string | null
      mustChangePassword: true
      passwordAlreadyIssued: boolean
    }
  | { ok: false; status: number; message: string }

async function resolveOperationalSectors(
  deps: CreateEmployeeAccountDeps,
  sectorCodes: string[]
): Promise<{ ok: true; sectorIds: string[] } | { ok: false; status: number; message: string }> {
  if (sectorCodes.length === 0) return { ok: true, sectorIds: [] }
  const catalog = await deps.listSectors()
  const byCode = new Map(catalog.map((row) => [row.code, row]))
  const sectorIds: string[] = []
  for (const code of sectorCodes) {
    const sector = byCode.get(code)
    if (!sector || !sector.isActive) {
      return { ok: false, status: 400, message: `Setor não encontrado no catálogo: ${code}` }
    }
    if (isLegacyCommercialSector(sector.code)) {
      return {
        ok: false,
        status: 400,
        message: "O cadastro genérico não ativa o Comercial legado.",
      }
    }
    sectorIds.push(sector.id)
  }
  return { ok: true, sectorIds }
}

async function resolveManager(
  deps: CreateEmployeeAccountDeps,
  managerEmployeeId: string | null,
  employeeId: string | null
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!managerEmployeeId) return { ok: true }
  if (employeeId && managerEmployeeId === employeeId) {
    return { ok: false, status: 400, message: "O funcionário não pode ser gestor de si mesmo." }
  }
  const manager = await deps.findEmployeeById(managerEmployeeId)
  if (!manager) {
    return { ok: false, status: 400, message: "Gestor informado não existe." }
  }
  if (
    employeeId &&
    wouldCreateDirectManagerCycle({
      employeeId,
      managerEmployeeId: manager.id,
      managerOfManagerId: manager.managerEmployeeId,
    })
  ) {
    return { ok: false, status: 400, message: "Ciclo direto de gestão não é permitido." }
  }
  return { ok: true }
}

async function resolveReplay(
  deps: CreateEmployeeAccountDeps,
  creation: EmployeeAccountCreationRow
): Promise<CreateEmployeeAccountResult> {
  const profileId = creation.profile_id ?? creation.auth_user_id
  const employeeId = creation.employee_id
  if (!profileId || !employeeId) {
    return {
      ok: false,
      status: 409,
      message:
        "Operação em andamento ou incompleta. Aguarde e tente novamente com a mesma chave.",
    }
  }
  const profile = await deps.findProfileById(profileId)
  if (!profile) {
    return {
      ok: false,
      status: 409,
      message: "Funcionário já processado, mas o perfil não foi encontrado.",
    }
  }
  return {
    ok: true,
    replayed: true,
    employeeId,
    profileId,
    login: profile.email,
    loginPath: EMPLOYEE_LOGIN_PATH,
    role: "funcionario",
    temporaryPassword: null,
    mustChangePassword: true,
    passwordAlreadyIssued: true,
  }
}

async function compensateOwnedAuth(
  deps: CreateEmployeeAccountDeps,
  creationId: string,
  authUserId: string
) {
  await deps.deleteAuthUser(authUserId)
  await deps.updateCreation({ id: creationId, status: "failed" })
}

async function recoverPendingOwnedCreation(
  deps: CreateEmployeeAccountDeps,
  creation: EmployeeAccountCreationRow,
  data: EmployeeAccountValidated,
  actorProfileId: string
): Promise<CreateEmployeeAccountResult> {
  const ownedUserId = creation.auth_user_id
  if (!ownedUserId) {
    return { ok: false, status: 500, message: "Estado de ownership inválido." }
  }
  return finalizeOwnedAccount(deps, {
    creationId: creation.id,
    ownedUserId,
    existingEmployeeId: creation.employee_id,
    data,
    actorProfileId,
    temporaryPassword: null,
    replayed: true,
  })
}

async function finalizeOwnedAccount(
  deps: CreateEmployeeAccountDeps,
  input: {
    creationId: string
    ownedUserId: string
    existingEmployeeId: string | null
    data: EmployeeAccountValidated
    actorProfileId: string
    temporaryPassword: string | null
    replayed: boolean
  }
): Promise<CreateEmployeeAccountResult> {
  const wait = deps.waitForProfile ?? ((id: string) => deps.findProfileById(id))
  let profile = await wait(input.ownedUserId)

  if (!profile) {
    if (!input.existingEmployeeId) {
      await compensateOwnedAuth(deps, input.creationId, input.ownedUserId)
      return {
        ok: false,
        status: 500,
        message: "Conta Auth sem perfil. Operação compensada. Inicie uma nova criação.",
      }
    }
    return {
      ok: false,
      status: 500,
      message: "Perfil ausente após criação do funcionário. Contate o suporte.",
    }
  }

  if (FORBIDDEN_CREATED_ROLES.has(profile.role)) {
    if (!input.existingEmployeeId) {
      await compensateOwnedAuth(deps, input.creationId, input.ownedUserId)
    }
    return {
      ok: false,
      status: 500,
      message: "Perfil desta operação inválido. Operação compensada.",
    }
  }

  if (profile.role === "indicador" || profile.role === "funcionario") {
    const updated = await deps.updateProfileAfterCreate({
      profileId: input.ownedUserId,
      fullName: input.data.fullName,
      email: input.data.email,
      phone: input.data.phone,
      cpf: input.data.cpf,
    })
    if (!updated.ok) {
      if (!input.existingEmployeeId) {
        await compensateOwnedAuth(deps, input.creationId, input.ownedUserId)
      }
      return {
        ok: false,
        status: updated.message.toLowerCase().includes("já existe") ? 409 : 500,
        message: updated.message,
      }
    }
    profile = (await deps.findProfileById(input.ownedUserId)) ?? {
      ...profile,
      role: "funcionario",
      is_active: true,
      must_change_password: true,
    }
  }

  if (profile.role !== "funcionario") {
    if (!input.existingEmployeeId) {
      await compensateOwnedAuth(deps, input.creationId, input.ownedUserId)
    }
    return {
      ok: false,
      status: 500,
      message: "Não foi possível definir a identidade funcionario.",
    }
  }

  if (input.data.managerEmployeeId) {
    const managerCheck = await resolveManager(
      deps,
      input.data.managerEmployeeId,
      input.existingEmployeeId
    )
    if (!managerCheck.ok) return managerCheck
  }

  let employeeId = input.existingEmployeeId
  if (!employeeId) {
    const existing = await deps.findEmployeeByProfileId(input.ownedUserId)
    if (existing) {
      employeeId = existing.id
    } else {
      const inserted = await deps.insertEmployee({
        profileId: input.ownedUserId,
        status: input.data.status,
        jobTitle: input.data.jobTitle,
        birthDate: input.data.birthDate,
        managerEmployeeId: input.data.managerEmployeeId,
        notes: input.data.notes,
      })
      if (!inserted.ok) {
        await compensateOwnedAuth(deps, input.creationId, input.ownedUserId)
        return { ok: false, status: 500, message: inserted.message }
      }
      employeeId = inserted.employeeId
    }
    const owned = await deps.updateCreation({
      id: input.creationId,
      status: "pending",
      authUserId: input.ownedUserId,
      profileId: input.ownedUserId,
      employeeId,
    })
    if (!owned.ok) {
      return {
        ok: false,
        status: 500,
        message: "Funcionário criado, mas a confirmação falhou. Tente novamente com a mesma chave.",
      }
    }
  }

  const catalog = await resolveOperationalSectors(deps, input.data.sectorCodes)
  if (!catalog.ok) return catalog
  if (catalog.sectorIds.length > 0) {
    const memberships = await deps.insertMemberships({
      employeeId,
      sectorIds: catalog.sectorIds,
    })
    if (!memberships.ok) {
      return {
        ok: false,
        status: 500,
        message: "Conta criada, mas os setores falharam. Tente novamente com a mesma chave.",
      }
    }
  }

  const auditMeta = buildEmployeeAccountAuditMetadata({
    actorProfileId: input.actorProfileId,
    profileId: input.ownedUserId,
    employeeId,
    idempotencyKey: input.data.idempotencyKey,
    status: input.data.status,
    jobTitle: input.data.jobTitle,
    managerEmployeeId: input.data.managerEmployeeId,
    sectorCodes: input.data.sectorCodes,
  })
  const secrets = [
    input.temporaryPassword ?? "",
    input.data.cpf,
    input.data.phone,
    input.data.email,
  ]
  if (assertNoSecretsInAuditMetadata(auditMeta, secrets)) {
    try {
      await deps.insertAuditEvents({
        employeeId,
        actorProfileId: input.actorProfileId,
        metadata: auditMeta,
        sectorCodes: input.data.sectorCodes,
      })
    } catch {
      // best-effort
    }
  }

  const finalized = await deps.updateCreation({
    id: input.creationId,
    status: "created",
    authUserId: input.ownedUserId,
    profileId: input.ownedUserId,
    employeeId,
  })
  if (!finalized.ok) {
    return {
      ok: false,
      status: 500,
      message: "Conta criada, mas a confirmação falhou. Tente novamente com a mesma chave.",
    }
  }

  return {
    ok: true,
    replayed: input.replayed,
    employeeId,
    profileId: input.ownedUserId,
    login: input.data.email,
    loginPath: EMPLOYEE_LOGIN_PATH,
    role: "funcionario",
    temporaryPassword: input.replayed ? null : input.temporaryPassword,
    mustChangePassword: true,
    passwordAlreadyIssued: input.replayed,
  }
}

async function dispatchExistingCreation(
  deps: CreateEmployeeAccountDeps,
  existingOp: EmployeeAccountCreationRow,
  data: EmployeeAccountValidated,
  actorProfileId: string
): Promise<CreateEmployeeAccountResult | { continueWithId: string }> {
  if (existingOp.status === "created") {
    return resolveReplay(deps, existingOp)
  }
  if (existingOp.status === "failed") {
    return {
      ok: false,
      status: 409,
      message: "Esta tentativa de criação falhou. Inicie uma nova criação (nova chave).",
    }
  }
  if (existingOp.auth_user_id) {
    return recoverPendingOwnedCreation(deps, existingOp, data, actorProfileId)
  }
  if (existingOp.employee_id) {
    return resolveReplay(deps, existingOp)
  }
  return { continueWithId: existingOp.id }
}

export async function createEmployeeAccount(
  deps: CreateEmployeeAccountDeps,
  body: EmployeeAccountClientPayload
): Promise<CreateEmployeeAccountResult> {
  const user = await deps.getUser()
  if (!user) {
    return { ok: false, status: 401, message: "Sessão não encontrada. Faça login novamente." }
  }

  const actor = await deps.getActorProfile(user.id)
  const auth = authorizeEmployeeAdminAccess({
    userId: user.id,
    profileId: actor?.id ?? null,
    role: (actor?.role ?? null) as UserRole | null,
    action: "write",
  })
  if (!auth.ok) {
    return { ok: false, status: auth.status, message: auth.message }
  }
  if (actor?.is_active === false) {
    return { ok: false, status: 403, message: "Perfil inativo." }
  }

  const validated = validateEmployeeAccountClientPayload(body)
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.message }
  }
  const data = validated.data

  const existingOp = await deps.findCreationByKey(data.idempotencyKey)
  if (existingOp) {
    const dispatched = await dispatchExistingCreation(
      deps,
      existingOp,
      data,
      auth.profileId
    )
    if (!("continueWithId" in dispatched)) return dispatched
  }

  const emailOwner = await deps.findProfileByEmail(data.email)
  if (emailOwner) {
    return {
      ok: false,
      status: 409,
      message: "Já existe um cadastro com este e-mail. Vincule o usuário existente se for o caso.",
    }
  }
  const cpfOwner = await deps.findProfileByCpf(data.cpf)
  if (cpfOwner) {
    return {
      ok: false,
      status: 409,
      message: "Já existe um cadastro com este CPF. Vincule o usuário existente se for o caso.",
    }
  }

  const sectorsCheck = await resolveOperationalSectors(deps, data.sectorCodes)
  if (!sectorsCheck.ok) return sectorsCheck
  const managerCheck = await resolveManager(deps, data.managerEmployeeId, null)
  if (!managerCheck.ok) return managerCheck

  let creationId = existingOp?.id ?? null
  if (!creationId) {
    const inserted = await deps.insertCreationPending({
      idempotencyKey: data.idempotencyKey,
      actorProfileId: auth.profileId,
    })
    if ("error" in inserted) {
      if (inserted.uniqueViolation || isUniqueViolationError({ message: inserted.error })) {
        const raced = await deps.findCreationByKey(data.idempotencyKey)
        if (raced) {
          const dispatched = await dispatchExistingCreation(
            deps,
            raced,
            data,
            auth.profileId
          )
          if (!("continueWithId" in dispatched)) return dispatched
          creationId = dispatched.continueWithId
        }
      }
      if (!creationId) {
        return {
          ok: false,
          status: 500,
          message: "Não foi possível iniciar a criação. Tente novamente.",
        }
      }
    } else {
      creationId = inserted.id
    }
  }

  const temporaryPassword =
    deps.generateTemporaryPassword?.() ?? generateAssistedTemporaryPassword()

  const created = await deps.createAuthUser({
    email: data.email,
    password: temporaryPassword,
    metadata: { full_name: data.fullName, phone: data.phone },
  })

  if (!created.ok) {
    await deps.updateCreation({ id: creationId, status: "failed" })
    if (created.code === "email_exists") {
      return {
        ok: false,
        status: 409,
        message: "Já existe um cadastro com este e-mail. Vincule o usuário existente se for o caso.",
      }
    }
    return {
      ok: false,
      status: 500,
      message: "Não foi possível criar o acesso do funcionário. Tente novamente.",
    }
  }

  const ownership = await deps.updateCreation({
    id: creationId,
    status: "pending",
    authUserId: created.userId,
    profileId: created.userId,
  })
  if (!ownership.ok) {
    await compensateOwnedAuth(deps, creationId, created.userId)
    return {
      ok: false,
      status: 500,
      message: "Não foi possível registrar a criação. Operação compensada. Tente novamente.",
    }
  }

  return finalizeOwnedAccount(deps, {
    creationId,
    ownedUserId: created.userId,
    existingEmployeeId: null,
    data,
    actorProfileId: auth.profileId,
    temporaryPassword,
    replayed: false,
  })
}
