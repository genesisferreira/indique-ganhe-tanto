import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  assertNoSecretsInAuditMetadata,
  buildAssistedIndicatorAuthMetadata,
  buildAssistedIndicatorAuditMetadata,
  createAssistedIndicator,
  recoverPendingOwnedCreation,
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
    createUserCalls: number
    updateFailures: Set<string>
  } {
    const creations = new Map<string, AssistedIndicatorCreationRow>()
    const profiles = new Map<string, AssistedIndicatorProfileRow>()
    const pixOwners = new Map<string, string>()
    const createdUsers: string[] = []
    const deletedUsers: string[] = []
    const audits: Record<string, unknown>[] = []
    const passwordsSeen: string[] = []
    const updateFailures = new Set<string>()
    let nextId = 1
    let createUserCalls = 0

    const deps: CreateAssistedIndicatorDeps & {
      creations: Map<string, AssistedIndicatorCreationRow>
      profiles: Map<string, AssistedIndicatorProfileRow>
      pixOwners: Map<string, string>
      createdUsers: string[]
      deletedUsers: string[]
      audits: Record<string, unknown>[]
      passwordsSeen: string[]
      createUserCalls: number
      updateFailures: Set<string>
    } = {
      creations,
      profiles,
      pixOwners,
      createdUsers,
      deletedUsers,
      audits,
      passwordsSeen,
      createUserCalls: 0,
      updateFailures,
      getUser:
        overrides.getUser ?? (async () => ({ id: "comercial-1" })),
      getActorProfile:
        overrides.getActorProfile ??
        (async () => ({
          id: "comercial-1",
          role: "comercial",
          is_active: true,
        })),
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
          for (const row of creations.values()) {
            if (row.idempotency_key === idempotencyKey) {
              return {
                error: "duplicate key",
                uniqueViolation: true,
              }
            }
          }
          const id = `creation-${nextId++}`
          creations.set(id, {
            id,
            idempotency_key: idempotencyKey,
            actor_profile_id: actorProfileId,
            indicator_profile_id: null,
            auth_user_id: null,
            status: "pending",
          })
          return { id }
        }),
      updateCreation:
        overrides.updateCreation ??
        (async ({ id, status, indicatorProfileId, authUserId }) => {
          if (updateFailures.has(`${id}:${status ?? ""}:${authUserId ?? ""}`)) {
            return { ok: false as const, message: "forced_update_fail" }
          }
          if (updateFailures.has(id) && authUserId) {
            return { ok: false as const, message: "forced_ownership_fail" }
          }
          const row = creations.get(id)
          if (!row) return { ok: false as const, message: "missing" }
          if (status !== undefined) row.status = status
          if (indicatorProfileId !== undefined) {
            row.indicator_profile_id = indicatorProfileId
          }
          if (authUserId !== undefined) {
            row.auth_user_id = authUserId
          }
          creations.set(id, row)
          return { ok: true as const }
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
          createUserCalls += 1
          deps.createUserCalls = createUserCalls
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

  it("1) normal create", async () => {
    const deps = makeDeps()
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.replayed, false)
    assert.equal(result.temporaryPassword, "TempPass!2345678")
    assert.equal(result.mustChangePassword, true)
    const profile = deps.profiles.get(result.indicator.id)!
    assert.equal(profile.role, "indicador")
    assert.equal(profile.must_change_password, true)
    const creation = [...deps.creations.values()][0]!
    assert.equal(creation.auth_user_id, result.indicator.id)
    assert.equal(creation.status, "created")
  })

  it("admin_master permitido; demais roles negados; anônimo negado", async () => {
    const admin = makeDeps({
      getUser: async () => ({ id: "admin-1" }),
      getActorProfile: async () => ({
        id: "admin-1",
        role: "admin_master",
        is_active: true,
      }),
    })
    assert.equal((await createAssistedIndicator(admin, baseBody())).ok, true)

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

    const anon = makeDeps({ getUser: async () => null })
    const r = await createAssistedIndicator(anon, baseBody())
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.status, 401)
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

  it("2) pending sem auth id permite continuar create", async () => {
    const deps = makeDeps()
    deps.creations.set("c1", {
      id: "c1",
      idempotency_key: KEY_A,
      actor_profile_id: "comercial-1",
      indicator_profile_id: null,
      auth_user_id: null,
      status: "pending",
    })
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.replayed, false)
    assert.equal(deps.createUserCalls, 1)
  })

  it("3) createUser success → auth_user_id persistido", async () => {
    const deps = makeDeps()
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, true)
    if (!result.ok) return
    const row = [...deps.creations.values()][0]!
    assert.equal(row.auth_user_id, result.indicator.id)
  })

  it("4) falha ao persistir auth_user_id → delete somente user novo", async () => {
    const deps = makeDeps()
    deps.updateCreation = async ({ id, status, indicatorProfileId, authUserId }) => {
      if (authUserId && status === "pending") {
        return { ok: false as const, message: "ownership fail" }
      }
      const row = deps.creations.get(id)
      if (!row) return { ok: false as const, message: "missing" }
      if (status !== undefined) row.status = status
      if (indicatorProfileId !== undefined) {
        row.indicator_profile_id = indicatorProfileId
      }
      if (authUserId !== undefined) row.auth_user_id = authUserId
      return { ok: true as const }
    }
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    assert.equal(deps.deletedUsers.length, 1)
    assert.equal(deps.createdUsers[0], deps.deletedUsers[0])
  })

  it("5-9) pending + auth_user_id → recovery sem createUser / senha null", async () => {
    const deps = makeDeps()
    const first = await createAssistedIndicator(deps, baseBody())
    assert.equal(first.ok, true)
    if (!first.ok) return

    // Simula timeout após ownership: volta para pending com auth_user_id.
    const row = [...deps.creations.values()][0]!
    row.status = "pending"
    row.indicator_profile_id = null
    deps.creations.set(row.id, row)

    const beforeCalls = deps.createUserCalls
    const second = await createAssistedIndicator(deps, baseBody())
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.equal(second.replayed, true)
    assert.equal(second.temporaryPassword, null)
    assert.equal(second.passwordAlreadyIssued, true)
    assert.equal(deps.createUserCalls, beforeCalls)
    assert.equal(second.indicator.id, first.indicator.id)
    const after = [...deps.creations.values()][0]!
    assert.equal(after.status, "created")
    assert.equal(after.indicator_profile_id, first.indicator.id)
  })

  it("10-11) email existente sem ownership → não adota / não delete", async () => {
    const deps = makeDeps()
    deps.creations.set("c1", {
      id: "c1",
      idempotency_key: KEY_A,
      actor_profile_id: "comercial-1",
      indicator_profile_id: null,
      auth_user_id: null,
      status: "pending",
    })
    deps.profiles.set("preexisting", {
      id: "preexisting",
      full_name: "Outro",
      email: "joao.novo@example.com",
      phone: "11999999999",
      cpf: "39053344705",
      role: "indicador",
      is_active: true,
      must_change_password: false,
    })
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 409)
    assert.equal(deps.deletedUsers.length, 0)
    assert.equal(deps.createUserCalls, 0)
    assert.ok(deps.profiles.has("preexisting"))
  })

  it("12) update status created falha → não falso sucesso", async () => {
    const deps = makeDeps()
    let ownershipDone = false
    deps.updateCreation = async ({ id, status, indicatorProfileId, authUserId }) => {
      const row = deps.creations.get(id)
      if (!row) return { ok: false as const, message: "missing" }
      if (authUserId && status === "pending") {
        row.auth_user_id = authUserId
        ownershipDone = true
        return { ok: true as const }
      }
      if (status === "created" && ownershipDone) {
        return { ok: false as const, message: "finalize fail" }
      }
      if (status !== undefined) row.status = status
      if (indicatorProfileId !== undefined) {
        row.indicator_profile_id = indicatorProfileId
      }
      if (authUserId !== undefined) row.auth_user_id = authUserId
      return { ok: true as const }
    }
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 500)
    assert.equal(deps.createdUsers.length, 1)
    // Ownership permanece; conta não é apagada neste ponto (retry recupera).
    assert.equal(deps.deletedUsers.length, 0)
  })

  it("13) concorrência mesma key → unique → recovery/replay", async () => {
    const deps = makeDeps()
    const first = await createAssistedIndicator(deps, baseBody())
    assert.equal(first.ok, true)
    const second = await createAssistedIndicator(deps, baseBody())
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) return
    assert.equal(second.replayed, true)
    assert.equal(deps.createdUsers.length, 1)
  })

  it("14) replay created sem senha", async () => {
    const deps = makeDeps()
    const first = await createAssistedIndicator(deps, baseBody())
    const second = await createAssistedIndicator(deps, baseBody())
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.equal(second.temporaryPassword, null)
    assert.equal(second.passwordAlreadyIssued, true)
  })

  it("15) failed state exige nova key", async () => {
    const deps = makeDeps()
    deps.creations.set("c1", {
      id: "c1",
      idempotency_key: KEY_A,
      actor_profile_id: "comercial-1",
      indicator_profile_id: null,
      auth_user_id: null,
      status: "failed",
    })
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 409)
    assert.equal(deps.createUserCalls, 0)
  })

  it("16) nenhuma senha em audit/metadata", async () => {
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

  it("createUser failure marca failed sem delete", async () => {
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

  it("profile failure compensa deleteUser do user novo", async () => {
    const deps = makeDeps({
      waitForProfile: async () => null,
      findProfileById: async () => null,
    })
    deps.createAuthUser = async ({ password }) => {
      deps.passwordsSeen.push(password)
      return { ok: true, userId: "orphan-user" }
    }
    deps.deleteAuthUser = async (userId) => {
      deps.deletedUsers.push(userId)
      return { ok: true }
    }
    const result = await createAssistedIndicator(deps, baseBody())
    assert.equal(result.ok, false)
    assert.deepEqual(deps.deletedUsers, ["orphan-user"])
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
  })

  it("recoverPendingOwnedCreation exportável e sem senha", async () => {
    const deps = makeDeps()
    const first = await createAssistedIndicator(deps, baseBody())
    assert.equal(first.ok, true)
    if (!first.ok) return
    const creation = [...deps.creations.values()][0]!
    creation.status = "pending"
    creation.indicator_profile_id = null
    const recovered = await recoverPendingOwnedCreation(
      deps,
      creation,
      {
        idempotencyKey: KEY_A,
        fullName: "João Indicador",
        cpf: VALID_CPF,
        phone: "11987654321",
        email: "joao.novo@example.com",
        pixKeyType: "aleatoria",
        pixKeyValue: VALID_PIX,
      },
      "comercial-1"
    )
    assert.equal(recovered.ok, true)
    if (!recovered.ok) return
    assert.equal(recovered.replayed, true)
    assert.equal(recovered.temporaryPassword, null)
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
