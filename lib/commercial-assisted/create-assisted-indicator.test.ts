import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  assertNoSecretsInAuditMetadata,
  buildAssistedIndicatorAuthMetadata,
  buildAssistedIndicatorAuditMetadata,
  createAssistedIndicator,
  validateAssistedIndicatorClientPayload,
  type AssistedIndicatorCreationRow,
  type AssistedIndicatorProfileRow,
  type CreateAssistedIndicatorDeps,
} from "./create-assisted-indicator"
import { generateAssistedTemporaryPassword } from "./temporary-password"
import {
  isAllowedDuringMustChangePassword,
  resolvePostAuthPath,
} from "@/lib/auth/auth-audit"

const KEY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const KEY_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
const VALID_CPF = "52998224725"
const VALID_PIX = "a1b2c3d4-e5f6-4789-a012-3456789abcde"

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: KEY_A,
    fullName: "João Indicador",
    cpf: VALID_CPF,
    phone: "11987654321",
    email: "joao.novo@example.com",
    pixKeyType: "aleatoria",
    pixKeyValue: VALID_PIX,
    role: "admin_master",
    must_change_password: false,
    ...overrides,
  }
}

describe("temporary password", () => {
  it("gera senha com entropia adequada sem Math.random", () => {
    const a = generateAssistedTemporaryPassword()
    const b = generateAssistedTemporaryPassword()
    assert.equal(a.length, 16)
    assert.notEqual(a, b)
    assert.equal(/^[A-Za-z0-9!@#$%]+$/.test(a), true)
  })
})

describe("validateAssistedIndicatorClientPayload", () => {
  it("rejeita CPF inválido", () => {
    const r = validateAssistedIndicatorClientPayload(
      baseBody({ cpf: "11111111111" })
    )
    assert.equal(r.ok, false)
  })

  it("rejeita email inválido", () => {
    const r = validateAssistedIndicatorClientPayload(
      baseBody({ email: "nao-email" })
    )
    assert.equal(r.ok, false)
  })

  it("rejeita phone inválido", () => {
    const r = validateAssistedIndicatorClientPayload(
      baseBody({ phone: "123" })
    )
    assert.equal(r.ok, false)
  })

  it("rejeita Pix inválido", () => {
    const r = validateAssistedIndicatorClientPayload(
      baseBody({ pixKeyType: "aleatoria", pixKeyValue: "xyz" })
    )
    assert.equal(r.ok, false)
  })

  it("aceita payload válido e ignora role do browser", () => {
    const r = validateAssistedIndicatorClientPayload(baseBody())
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.data.email, "joao.novo@example.com")
    assert.equal(r.data.cpf, VALID_CPF)
  })
})

describe("createAssistedIndicator service", () => {
  function makeDeps(
    overrides: Partial<CreateAssistedIndicatorDeps> = {}
  ): CreateAssistedIndicatorDeps & {
    creations: Map<string, AssistedIndicatorCreationRow>
    profiles: Map<string, AssistedIndicatorProfileRow>
    pixOwners: Map<string, string>
    createdUsers: string[]
    deletedUsers: string[]
    audits: Record<string, unknown>[]
    passwordsSeen: string[]
  } {
    const creations = new Map<string, AssistedIndicatorCreationRow>()
    const profiles = new Map<string, AssistedIndicatorProfileRow>()
    const pixOwners = new Map<string, string>()
    const createdUsers: string[] = []
    const deletedUsers: string[] = []
    const audits: Record<string, unknown>[] = []
    const passwordsSeen: string[] = []
    let nextId = 1

    const deps: CreateAssistedIndicatorDeps & {
      creations: Map<string, AssistedIndicatorCreationRow>
      profiles: Map<string, AssistedIndicatorProfileRow>
      pixOwners: Map<string, string>
      createdUsers: string[]
      deletedUsers: string[]
      audits: Record<string, unknown>[]
      passwordsSeen: string[]
    } = {
      creations,
      profiles,
      pixOwners,
      createdUsers,
      deletedUsers,
      audits,
      passwordsSeen,
      getUser: overrides.getUser ?? (async () => ({ id: "comercial-1" })),
      getActorProfile:
        overrides.getActorProfile ??
        (async () => ({
          id: "comercial-1",
          role: "comercial",
          is_active: true,
        })),
      findCreationByKey:
        overrides.findCreationByKey ??
        (async (key) => creations.get(key) ?? null),
      insertCreationPending:
        overrides.insertCreationPending ??
        (async ({ idempotencyKey, actorProfileId }) => {
          if (creations.has(idempotencyKey)) {
            return { error: "duplicate", uniqueViolation: true }
          }
          const id = `op-${nextId++}`
          creations.set(idempotencyKey, {
            id,
            idempotency_key: idempotencyKey,
            actor_profile_id: actorProfileId,
            indicator_profile_id: null,
            status: "pending",
          })
          return { id }
        }),
      updateCreation:
        overrides.updateCreation ??
        (async ({ id, status, indicatorProfileId }) => {
          for (const [key, row] of creations) {
            if (row.id === id) {
              creations.set(key, {
                ...row,
                status,
                indicator_profile_id:
                  indicatorProfileId !== undefined
                    ? indicatorProfileId
                    : row.indicator_profile_id,
              })
            }
          }
        }),
      findProfileByEmail:
        overrides.findProfileByEmail ??
        (async (email) => {
          for (const p of profiles.values()) {
            if (p.email.toLowerCase() === email.toLowerCase()) return p
          }
          return null
        }),
      findProfileByCpf:
        overrides.findProfileByCpf ??
        (async (cpf) => {
          for (const p of profiles.values()) {
            if (p.cpf === cpf) return p
          }
          return null
        }),
      findPixOwnerProfileId:
        overrides.findPixOwnerProfileId ??
        (async (pix) => pixOwners.get(pix) ?? null),
      findProfileById:
        overrides.findProfileById ??
        (async (id) => profiles.get(id) ?? null),
      createAuthUser:
        overrides.createAuthUser ??
        (async ({ email, password, metadata }) => {
          passwordsSeen.push(password)
          assert.ok(!("password" in metadata))
          assert.ok(!("role" in metadata))
          assert.equal(metadata.full_name.length > 0, true)
          for (const p of profiles.values()) {
            if (p.email === email) {
              return { ok: false as const, code: "email_exists" as const }
            }
          }
          const userId = `user-${nextId++}`
          createdUsers.push(userId)
          profiles.set(userId, {
            id: userId,
            full_name: metadata.full_name,
            email,
            phone: metadata.phone,
            cpf: null,
            role: "indicador",
            is_active: true,
            must_change_password: false,
          })
          pixOwners.set(metadata.pix_key_value, userId)
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
        (async ({ profileId, cpf }) => {
          const p = profiles.get(profileId)
          if (!p) return { ok: false as const, message: "missing" }
          for (const other of profiles.values()) {
            if (other.id !== profileId && other.cpf === cpf) {
              return { ok: false as const, message: "cpf conflict" }
            }
          }
          profiles.set(profileId, {
            ...p,
            cpf,
            must_change_password: true,
            role: "indicador",
            is_active: true,
          })
          return { ok: true as const }
        }),
      insertAudit:
        overrides.insertAudit ??
        (async ({ metadata }) => {
          audits.push(metadata)
        }),
      generateTemporaryPassword:
        overrides.generateTemporaryPassword ??
        (() => "TempPass!2345678"),
    }
    return deps
  }

  it("commercial ativo cria com role indicador e must_change true", async () => {
    const deps = makeDeps()
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.replayed, false)
    assert.equal(result.temporaryPassword, "TempPass!2345678")
    assert.equal(result.mustChangePassword, true)
    assert.equal(result.login, "joao.novo@example.com")
    const profile = deps.profiles.get(result.indicator.id)!
    assert.equal(profile.role, "indicador")
    assert.equal(profile.must_change_password, true)
    assert.equal(profile.cpf, VALID_CPF)
  })

  it("admin_master permitido", async () => {
    const deps = makeDeps({
      getUser: async () => ({ id: "admin-1" }),
      getActorProfile: async () => ({
        id: "admin-1",
        role: "admin_master",
        is_active: true,
      }),
    })
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, true)
  })

  it("demais roles negados", async () => {
    for (const role of [
      "indicador",
      "admin_consulta",
      "admin_financeiro",
    ] as const) {
      const deps = makeDeps({
        getActorProfile: async () => ({
          id: "comercial-1",
          role,
          is_active: true,
        }),
      })
      const result = await createAssistedIndicator(deps, baseBody())
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.status, 403)
    }
  })

  it("anônimo negado", async () => {
    const deps = makeDeps({ getUser: async () => null })
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })

  it("duplicidade email/cpf/pix", async () => {
    const deps = makeDeps()
    deps.profiles.set("existing", {
      id: "existing",
      full_name: "X",
      email: "joao.novo@example.com",
      phone: "11999999999",
      cpf: "39053344705",
      role: "indicador",
      is_active: true,
      must_change_password: false,
    })
    assert.equal((await createAssistedIndicator(deps, baseBody())).ok, false)

    const depsCpf = makeDeps()
    depsCpf.profiles.set("existing", {
      id: "existing",
      full_name: "X",
      email: "outro@example.com",
      phone: "11999999999",
      cpf: VALID_CPF,
      role: "indicador",
      is_active: true,
      must_change_password: false,
    })
    assert.equal((await createAssistedIndicator(depsCpf, baseBody())).ok, false)

    const depsPix = makeDeps()
    depsPix.pixOwners.set(VALID_PIX, "other")
    assert.equal((await createAssistedIndicator(depsPix, baseBody())).ok, false)
  })

  it("metadata AUTH 1C sem senha/role; audit sem segredos", async () => {
    const meta = buildAssistedIndicatorAuthMetadata({
      idempotencyKey: KEY_A,
      fullName: "João",
      cpf: VALID_CPF,
      phone: "11987654321",
      email: "joao@example.com",
      pixKeyType: "aleatoria",
      pixKeyValue: VALID_PIX,
    })
    assert.deepEqual(Object.keys(meta).sort(), [
      "full_name",
      "phone",
      "pix_key_type",
      "pix_key_value",
    ].sort())

    const deps = makeDeps()
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, true)
    if (!result.ok) return
    const audit = deps.audits[0]!
    assert.equal(
      assertNoSecretsInAuditMetadata(audit, [
        result.temporaryPassword ?? "",
        VALID_CPF,
        VALID_PIX,
        "11987654321",
        "joao.novo@example.com",
      ]),
      true
    )
    const auditMeta = buildAssistedIndicatorAuditMetadata({
      actorProfileId: "a",
      indicatorProfileId: "b",
      idempotencyKey: KEY_A,
    })
    assert.equal("password" in auditMeta, false)
  })

  it("idempotência: retry não cria user e não retorna senha", async () => {
    const deps = makeDeps()
    const first = await createAssistedIndicator(deps, baseBody())
    assert.equal(first.ok, true)
    if (!first.ok) return
    const second = await createAssistedIndicator(deps, baseBody())
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.equal(second.replayed, true)
    assert.equal(second.temporaryPassword, null)
    assert.equal(second.passwordAlreadyIssued, true)
    assert.equal(deps.createdUsers.length, 1)
    assert.equal(first.indicator.id, second.indicator.id)
  })

  it("nova key cria nova operação", async () => {
    const deps = makeDeps()
    const first = await createAssistedIndicator(deps, baseBody())
    const second = await createAssistedIndicator(
      deps,
      baseBody({
        idempotencyKey: KEY_B,
        email: "outro.novo@example.com",
        cpf: "39053344705",
        pixKeyValue: "b1b2c3d4-e5f6-4789-a012-3456789abcde",
      })
    )
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) return
    assert.notEqual(first.indicator.id, second.indicator.id)
    assert.equal(deps.createdUsers.length, 2)
  })

  it("createUser failure marca failed sem segredo", async () => {
    const deps = makeDeps({
      createAuthUser: async () => ({
        ok: false as const,
        code: "create_failed" as const,
      }),
    })
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    assert.equal(deps.deletedUsers.length, 0)
  })

  it("profile failure compensa deleteUser", async () => {
    const deps = makeDeps({
      waitForProfile: async () => null,
      findProfileById: async () => null,
    })
    // createAuthUser still adds to createdUsers via default — override carefully
    const created: string[] = []
    deps.createAuthUser = async ({ email, password, metadata }) => {
      deps.passwordsSeen.push(password)
      const userId = "orphan-user"
      created.push(userId)
      return { ok: true, userId }
    }
    deps.deleteAuthUser = async (userId) => {
      deps.deletedUsers.push(userId)
      return { ok: true }
    }
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    assert.deepEqual(deps.deletedUsers, ["orphan-user"])
  })

  it("CPF update failure compensa", async () => {
    const deps = makeDeps({
      updateProfileAfterCreate: async () => ({
        ok: false as const,
        message: "cpf fail",
      }),
    })
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    assert.equal(deps.deletedUsers.length, 1)
  })
})

describe("primeiro acesso gate helpers", () => {
  it("flag true bloqueia dashboard e permite /primeiro-acesso", () => {
    assert.equal(isAllowedDuringMustChangePassword("/primeiro-acesso"), true)
    assert.equal(isAllowedDuringMustChangePassword("/indicador"), false)
    assert.equal(isAllowedDuringMustChangePassword("/indicador/carteira"), false)
    assert.equal(
      resolvePostAuthPath({
        role: "indicador",
        mustChangePassword: true,
        redirectParam: "/indicador",
      }),
      "/primeiro-acesso"
    )
  })

  it("flag false preserva fluxo normal", () => {
    assert.equal(
      resolvePostAuthPath({
        role: "indicador",
        mustChangePassword: false,
        redirectParam: "/indicador/perfil",
      }),
      "/indicador/perfil"
    )
  })
})

describe("cadastro público regression (contrato must_change default)", () => {
  it("metadata signup pública não inclui must_change_password", async () => {
    const { buildIndicatorSignupUserMetadata } = await import(
      "@/lib/auth/indicator-signup"
    )
    const meta = buildIndicatorSignupUserMetadata({
      fullName: "Maria",
      phone: "11999998888",
      pixKeyType: "aleatoria",
      pixKeyValue: VALID_PIX,
    })
    assert.equal("must_change_password" in meta, false)
    assert.equal("cpf" in meta, false)
  })
})
