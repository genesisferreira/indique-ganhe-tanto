import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  authorizeEmployeeAdminAccess,
  parseCreatableEmployeeStatus,
  presentEmployeeAccountAccess,
  wouldCreateDirectManagerCycle,
} from "@/lib/employees/admin-policy"
import {
  createEmployeeAccount,
  validateEmployeeAccountClientPayload,
  type CreateEmployeeAccountDeps,
  type EmployeeAccountCreationRow,
  type EmployeeAccountProfileRow,
} from "@/lib/employees/create-employee-account"
import {
  isAllowedDuringMustChangePassword,
  evaluateRouteAccessForRole,
} from "@/lib/auth/auth-audit"

const KEY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const KEY_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
const VALID_CPF = "52998224725"
const OTHER_CPF = "39053344705"

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: KEY_A,
    fullName: "Ana Funcionaria",
    cpf: VALID_CPF,
    phone: "11987654321",
    email: "ana.func@example.com",
    birthDate: "1990-05-01",
    jobTitle: "Atendente",
    status: "active",
    sectorCodes: ["collections", "retention"],
    role: "admin_master",
    ...overrides,
  }
}

describe("3.1E-B validação", () => {
  it("E/W) ignora role do browser e rejeita dismissed", () => {
    const ok = validateEmployeeAccountClientPayload(baseBody())
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.data.email, "ana.func@example.com")
      assert.equal(ok.data.status, "active")
    }
    const dismissed = validateEmployeeAccountClientPayload(baseBody({ status: "dismissed" }))
    assert.equal(dismissed.ok, false)
    assert.equal(parseCreatableEmployeeStatus("dismissed"), null)
  })

  it("U) comercial legado não entra no cadastro genérico", () => {
    const r = validateEmployeeAccountClientPayload(
      baseBody({ sectorCodes: ["collections", "commercial"] })
    )
    assert.equal(r.ok, false)
  })
})

describe("3.1E-B createEmployeeAccount", () => {
  function makeDeps(
    overrides: Partial<CreateEmployeeAccountDeps> = {}
  ): CreateEmployeeAccountDeps & {
    creations: Map<string, EmployeeAccountCreationRow>
    profiles: Map<string, EmployeeAccountProfileRow>
    employees: Map<string, { id: string; profileId: string; managerEmployeeId: string | null }>
    memberships: string[]
    deletedUsers: string[]
    audits: Array<Record<string, unknown>>
    passwordsSeen: string[]
    createUserCalls: number
    syncCalls: number
    commercialSettingsInserts: number
  } {
    const creations = new Map<string, EmployeeAccountCreationRow>()
    const profiles = new Map<string, EmployeeAccountProfileRow>()
    const employees = new Map<
      string,
      { id: string; profileId: string; managerEmployeeId: string | null }
    >()
    const memberships: string[] = []
    const deletedUsers: string[] = []
    const audits: Array<Record<string, unknown>> = []
    const passwordsSeen: string[] = []
    let next = 1
    let createUserCalls = 0

    const deps: CreateEmployeeAccountDeps & {
      creations: Map<string, EmployeeAccountCreationRow>
      profiles: Map<string, EmployeeAccountProfileRow>
      employees: Map<string, { id: string; profileId: string; managerEmployeeId: string | null }>
      memberships: string[]
      deletedUsers: string[]
      audits: Array<Record<string, unknown>>
      passwordsSeen: string[]
      createUserCalls: number
      syncCalls: number
      commercialSettingsInserts: number
    } = {
      creations,
      profiles,
      employees,
      memberships,
      deletedUsers,
      audits,
      passwordsSeen,
      createUserCalls: 0,
      syncCalls: 0,
      commercialSettingsInserts: 0,
      getUser: overrides.getUser ?? (async () => ({ id: "admin-1" })),
      getActorProfile:
        overrides.getActorProfile ??
        (async () => ({ id: "admin-1", role: "admin_master", is_active: true })),
      findCreationByKey:
        overrides.findCreationByKey ??
        (async (key) => {
          for (const row of creations.values()) {
            if (row.idempotency_key === key) return row
          }
          return null
        }),
      insertCreationPending:
        overrides.insertCreationPending ??
        (async ({ idempotencyKey, actorProfileId }) => {
          const id = `op-${next++}`
          creations.set(id, {
            id,
            idempotency_key: idempotencyKey,
            actor_profile_id: actorProfileId,
            auth_user_id: null,
            profile_id: null,
            employee_id: null,
            status: "pending",
          })
          return { id }
        }),
      updateCreation:
        overrides.updateCreation ??
        (async (input) => {
          const row = creations.get(input.id)
          if (!row) return { ok: false, message: "missing" }
          if (input.status) row.status = input.status
          if (input.authUserId !== undefined) row.auth_user_id = input.authUserId
          if (input.profileId !== undefined) row.profile_id = input.profileId
          if (input.employeeId !== undefined) row.employee_id = input.employeeId
          return { ok: true }
        }),
      findProfileByEmail:
        overrides.findProfileByEmail ??
        (async (email) => [...profiles.values()].find((row) => row.email === email) ?? null),
      findProfileByCpf:
        overrides.findProfileByCpf ??
        (async (cpf) => [...profiles.values()].find((row) => row.cpf === cpf) ?? null),
      findProfileById:
        overrides.findProfileById ?? (async (id) => profiles.get(id) ?? null),
      findEmployeeByProfileId:
        overrides.findEmployeeByProfileId ??
        (async (profileId) =>
          [...employees.values()].find((row) => row.profileId === profileId) ?? null),
      findEmployeeById:
        overrides.findEmployeeById ??
        (async (id) => {
          const row = employees.get(id)
          return row
            ? { id: row.id, managerEmployeeId: row.managerEmployeeId }
            : null
        }),
      listSectors:
        overrides.listSectors ??
        (async () => [
          { id: "s-col", code: "collections", name: "Cobrança", isActive: true },
          { id: "s-ret", code: "retention", name: "Retenção", isActive: true },
          { id: "s-com", code: "commercial", name: "Comercial", isActive: true },
        ]),
      createAuthUser:
        overrides.createAuthUser ??
        (async ({ email, password }) => {
          createUserCalls += 1
          deps.createUserCalls = createUserCalls
          passwordsSeen.push(password)
          const userId = `auth-${next++}`
          profiles.set(userId, {
            id: userId,
            full_name: "Indicador",
            email,
            phone: null,
            cpf: null,
            role: "indicador",
            is_active: true,
            must_change_password: false,
          })
          return { ok: true as const, userId }
        }),
      deleteAuthUser:
        overrides.deleteAuthUser ??
        (async (userId) => {
          deletedUsers.push(userId)
          profiles.delete(userId)
          return { ok: true }
        }),
      updateProfileAfterCreate:
        overrides.updateProfileAfterCreate ??
        (async ({ profileId, fullName, email, phone, cpf }) => {
          const profile = profiles.get(profileId)
          if (!profile) return { ok: false, message: "missing profile" }
          if ([...profiles.values()].some((row) => row.id !== profileId && row.cpf === cpf)) {
            return { ok: false, message: "Já existe um cadastro com este CPF." }
          }
          profiles.set(profileId, {
            ...profile,
            full_name: fullName,
            email,
            phone,
            cpf,
            role: "funcionario",
            is_active: true,
            must_change_password: true,
          })
          return { ok: true as const }
        }),
      insertEmployee:
        overrides.insertEmployee ??
        (async ({ profileId, managerEmployeeId }) => {
          const id = `emp-${next++}`
          employees.set(id, { id, profileId, managerEmployeeId })
          return { ok: true as const, employeeId: id }
        }),
      insertMemberships:
        overrides.insertMemberships ??
        (async ({ sectorIds }) => {
          memberships.push(...sectorIds)
          return { ok: true as const }
        }),
      insertAuditEvents:
        overrides.insertAuditEvents ??
        (async ({ actorProfileId, metadata }) => {
          audits.push({ actorProfileId, metadata })
        }),
      generateTemporaryPassword: overrides.generateTemporaryPassword ?? (() => "TempPass!2345678"),
      waitForProfile:
        overrides.waitForProfile ?? ((id: string) => deps.findProfileById(id)),
    }
    return deps
  }

  it("A) somente Admin Master cria", async () => {
    const deps = makeDeps()
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.role, "funcionario")
      assert.equal(result.loginPath, "/login")
      assert.equal(result.mustChangePassword, true)
    }
  })

  it("B) Consulta não cria", async () => {
    const deps = makeDeps({
      getActorProfile: async () => ({
        id: "c1",
        role: "admin_consulta",
        is_active: true,
      }),
      getUser: async () => ({ id: "c1" }),
    })
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
    assert.equal(deps.createUserCalls, 0)
  })

  it("C) Financeiro não cria", async () => {
    const deps = makeDeps({
      getActorProfile: async () => ({
        id: "f1",
        role: "admin_financeiro",
        is_active: true,
      }),
      getUser: async () => ({ id: "f1" }),
    })
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it("D) funcionário não cria outro funcionário", async () => {
    const deps = makeDeps({
      getActorProfile: async () => ({
        id: "fn1",
        role: "funcionario",
        is_active: true,
      }),
      getUser: async () => ({ id: "fn1" }),
    })
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it("E/F/G/H/O) role funcionario, profile ativo, employee 1:1, memberships, must_change_password", async () => {
    const deps = makeDeps()
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, true)
    if (!result.ok) return
    const profile = deps.profiles.get(result.profileId)
    assert.equal(profile?.role, "funcionario")
    assert.equal(profile?.is_active, true)
    assert.equal(profile?.must_change_password, true)
    assert.equal(deps.employees.size, 1)
    assert.deepEqual(deps.memberships, ["s-col", "s-ret"])
    assert.equal(result.temporaryPassword, "TempPass!2345678")
  })

  it("I) e-mail duplicado bloqueado", async () => {
    const deps = makeDeps()
    deps.profiles.set("other", {
      id: "other",
      full_name: "X",
      email: "ana.func@example.com",
      phone: null,
      cpf: OTHER_CPF,
      role: "indicador",
      is_active: true,
      must_change_password: false,
    })
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 409)
    assert.equal(deps.createUserCalls, 0)
  })

  it("J) CPF duplicado bloqueado", async () => {
    const deps = makeDeps()
    deps.profiles.set("other", {
      id: "other",
      full_name: "X",
      email: "outro@example.com",
      phone: null,
      cpf: VALID_CPF,
      role: "indicador",
      is_active: true,
      must_change_password: false,
    })
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 409)
    assert.equal(deps.createUserCalls, 0)
  })

  it("K/L) duplo submit / retry idempotente não duplica Auth nem employee", async () => {
    const deps = makeDeps()
    const first = await createEmployeeAccount(deps, baseBody())
    const second = await createEmployeeAccount(deps, baseBody())
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(deps.createUserCalls, 1)
    assert.equal(deps.employees.size, 1)
    if (second.ok) {
      assert.equal(second.replayed, true)
      assert.equal(second.temporaryPassword, null)
    }
  })

  it("M) falha após Auth não deixa órfão silencioso", async () => {
    const deps = makeDeps({
      waitForProfile: async () => null,
    })
    const result = await createEmployeeAccount(deps, baseBody())
    assert.equal(result.ok, false)
    assert.equal(deps.deletedUsers.length, 1)
    assert.equal(deps.employees.size, 0)
  })

  it("N/Y) senha não aparece em auditoria e actor é registrado", async () => {
    const deps = makeDeps()
    await createEmployeeAccount(deps, baseBody())
    assert.equal(deps.audits.length, 1)
    const blob = JSON.stringify(deps.audits)
    assert.equal(blob.includes("TempPass!2345678"), false)
    assert.equal(deps.audits[0]?.actorProfileId, "admin-1")
  })

  it("P/Q) login /login e primeiro acesso permitido a funcionario", () => {
    assert.equal(evaluateRouteAccessForRole("/login", "funcionario").allowed, true)
    assert.equal(evaluateRouteAccessForRole("/primeiro-acesso", "funcionario").allowed, true)
    assert.equal(isAllowedDuringMustChangePassword("/primeiro-acesso"), true)
  })

  it("V) manager não pode ser o próprio employee", () => {
    assert.equal(
      wouldCreateDirectManagerCycle({
        employeeId: "e1",
        managerEmployeeId: "e1",
        managerOfManagerId: null,
      }),
      true
    )
    assert.equal(
      wouldCreateDirectManagerCycle({
        employeeId: "e1",
        managerEmployeeId: "e2",
        managerOfManagerId: "e1",
      }),
      true
    )
    assert.equal(
      wouldCreateDirectManagerCycle({
        employeeId: "e1",
        managerEmployeeId: "e2",
        managerOfManagerId: null,
      }),
      false
    )
  })

  it("X) setores vêm do catálogo; código inexistente falha", async () => {
    const deps = makeDeps()
    const result = await createEmployeeAccount(
      deps,
      baseBody({ sectorCodes: ["unknown_sector"] })
    )
    assert.equal(result.ok, false)
    assert.equal(deps.createUserCalls, 0)
  })

  it("conta de acesso útil", () => {
    assert.equal(
      presentEmployeeAccountAccess({ isActive: true, mustChangePassword: true }).label,
      "Primeiro acesso pendente"
    )
    assert.equal(
      presentEmployeeAccountAccess({ isActive: false, mustChangePassword: false }).label,
      "Inativa"
    )
    assert.equal(
      presentEmployeeAccountAccess({ isActive: true, mustChangePassword: false }).loginPath,
      "/login"
    )
  })
})

describe("3.1E-B A-AB arquitetura", () => {
  const root = process.cwd()
  const createSrc = readFileSync(join(root, "lib/employees/create-employee-account.ts"), "utf8")
  const routeSrc = readFileSync(join(root, "app/api/admin/employees/create/route.ts"), "utf8")
  const serviceSrc = readFileSync(join(root, "lib/employees/admin.service.ts"), "utf8")
  const novoSrc = readFileSync(join(root, "app/admin/funcionarios/novo/page.tsx"), "utf8")
  const detailSrc = readFileSync(join(root, "app/admin/funcionarios/[id]/page.tsx"), "utf8")

  it("R/S) collections não dispara sync nem case", () => {
    assert.equal(createSrc.includes("syncCollectionsFromControllr"), false)
    assert.equal(routeSrc.includes("syncCollectionsFromControllr"), false)
    assert.equal(createSrc.includes("collection_case"), false)
    assert.equal(routeSrc.includes("createInterest"), false)
  })

  it("T) retention não cria round-robin/case", () => {
    assert.equal(createSrc.toLowerCase().includes("round-robin"), false)
    assert.equal(routeSrc.includes("retention_case"), false)
  })

  it("U) comercial legado não é ativado", () => {
    assert.equal(routeSrc.includes("commercial_lead_settings"), false)
    assert.equal(routeSrc.includes('role: "comercial"'), false)
    assert.equal(createSrc.includes("commercial_availability"), false)
  })

  it("Z) vínculo existente preservado", () => {
    assert.match(novoSrc, /Vincular usuário existente/)
    assert.match(readFileSync(join(root, "app/api/admin/employees/route.ts"), "utf8"), /linkOrCreateEmployee/)
  })

  it("AA) nenhuma lógica financeira criada", () => {
    assert.equal(/\bsal[aá]rio\b/i.test(createSrc), false)
    assert.equal(/comiss[aã]o/i.test(createSrc), false)
    assert.equal(/vale[_\s-]?transporte/i.test(createSrc), false)
  })

  it("AB) nenhuma lógica Vendas Internas criada", () => {
    assert.equal(createSrc.includes("Vendas Internas"), false)
    assert.equal(createSrc.includes("vendedor_efetivo"), false)
    assert.equal(createSrc.includes("originador"), false)
  })

  it("Auth só server-side; service não expõe createUser", () => {
    assert.match(routeSrc, /getPrivileged\(\)\.auth\.admin\.createUser/)
    assert.equal(serviceSrc.includes("auth.admin.createUser"), false)
    assert.equal(novoSrc.includes("createUser"), false)
  })

  it("P) login central preservado", () => {
    assert.match(createSrc, /\/login/)
    assert.equal(novoSrc.includes("/login-funcionario"), false)
    assert.match(detailSrc, /\/login/)
  })

  it("senha não vai para employee_events metadata builder", () => {
    assert.equal(createSrc.includes("temporaryPassword"), true)
    assert.equal(/metadata:[\s\S]{0,200}temporaryPassword/.test(createSrc), false)
  })
})
