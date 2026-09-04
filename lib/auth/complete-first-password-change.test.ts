import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  completeFirstPasswordChange,
  type CompleteFirstPasswordChangeDeps,
  type FirstPasswordChangeProfile,
} from "./complete-first-password-change"
import { logFirstPasswordChangeDbError } from "./password-change-db-log"

const USER_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const USER_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"

function makeDeps(
  overrides: Partial<{
    getUser: CompleteFirstPasswordChangeDeps["getUser"]
    profile: FirstPasswordChangeProfile | null
    profileError: { code?: string; message?: string } | null
    updateResult: FirstPasswordChangeProfile | null
    updateError: { code?: string; message?: string } | null
    findIds: string[]
    clearIds: string[]
    privilegedCreatedBeforeAuth: boolean
  }> = {}
): CompleteFirstPasswordChangeDeps & {
  findIds: string[]
  clearIds: string[]
  privilegedCalls: number
  logs: unknown[]
} {
  const findIds: string[] = overrides.findIds ?? []
  const clearIds: string[] = overrides.clearIds ?? []
  let privilegedCalls = 0
  const logs: unknown[] = []
  let profile: FirstPasswordChangeProfile | null =
    overrides.profile !== undefined
      ? overrides.profile
      : {
          id: USER_A,
          must_change_password: true,
        }

  const deps: CompleteFirstPasswordChangeDeps & {
    findIds: string[]
    clearIds: string[]
    privilegedCalls: number
    logs: unknown[]
  } = {
    findIds,
    clearIds,
    privilegedCalls: 0,
    logs,
    getUser:
      overrides.getUser ??
      (async () => ({ id: USER_A })),
    getPrivilegedDb: () => {
      privilegedCalls += 1
      deps.privilegedCalls = privilegedCalls
      return {
        findProfileById: async (id: string) => {
          findIds.push(id)
          if (overrides.profileError) {
            return { data: null, error: overrides.profileError }
          }
          return { data: profile, error: null }
        },
        clearMustChangePassword: async (id: string) => {
          clearIds.push(id)
          if (overrides.updateError) {
            return { data: null, error: overrides.updateError }
          }
          if (overrides.updateResult !== undefined) {
            return { data: overrides.updateResult, error: null }
          }
          profile = { id, must_change_password: false }
          return { data: profile, error: null }
        },
      }
    },
    logError: (input) => {
      logs.push(input)
    },
  }
  return deps
}

describe("completeFirstPasswordChange", () => {
  it("1) sem sessão → 401", async () => {
    const deps = makeDeps({ getUser: async () => null })
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.status, 401)
      assert.match(r.message, /Sessão/)
    }
    assert.equal(deps.privilegedCalls, 0)
    assert.equal(deps.findIds.length, 0)
  })

  it("2) autenticado com flag true → limpa false", async () => {
    const deps = makeDeps()
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.alreadyCleared, false)
    assert.equal(deps.clearIds[0], USER_A)
  })

  it("3-4) service role só após getUser; falha getUser → zero privilegiadas", async () => {
    let privilegedBeforeReturn = false
    const deps = makeDeps({
      getUser: async () => {
        // getPrivilegedDb ainda não deveria ter sido chamado
        privilegedBeforeReturn = deps.privilegedCalls > 0
        return null
      },
    })
    await completeFirstPasswordChange(deps)
    assert.equal(privilegedBeforeReturn, false)
    assert.equal(deps.privilegedCalls, 0)
  })

  it("5-6) SELECT e UPDATE bound ao ID de auth.getUser", async () => {
    const deps = makeDeps()
    await completeFirstPasswordChange(deps)
    assert.deepEqual(deps.findIds, [USER_A])
    assert.deepEqual(deps.clearIds, [USER_A])
  })

  it("7) nenhum userId/profileId externo controla o alvo", async () => {
    const deps = makeDeps({
      getUser: async () => ({ id: USER_A }),
    })
    // Tentativa de injeção: profile “errado” retornado pelo DB com outro id
    // (simula bug de binding) → deve falhar, não limpar USER_B.
    deps.getPrivilegedDb = () => {
      deps.privilegedCalls += 1
      return {
        findProfileById: async (id: string) => {
          deps.findIds.push(id)
          assert.equal(id, USER_A)
          return {
            data: { id: USER_B, must_change_password: true },
            error: null,
          }
        },
        clearMustChangePassword: async (id: string) => {
          deps.clearIds.push(id)
          return {
            data: { id, must_change_password: false },
            error: null,
          }
        },
      }
    }
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.status, 500)
    assert.equal(deps.clearIds.length, 0)
  })

  it("8) must_change_password=true → limpa", async () => {
    const deps = makeDeps({
      profile: { id: USER_A, must_change_password: true },
    })
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.alreadyCleared, false)
  })

  it("9) alreadyCleared quando flag já false", async () => {
    const deps = makeDeps({
      profile: { id: USER_A, must_change_password: false },
    })
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.alreadyCleared, true)
    assert.equal(deps.clearIds.length, 0)
  })

  it("10) profile inexistente → 404", async () => {
    const deps = makeDeps({ profile: null })
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.status, 404)
      assert.match(r.message, /Perfil/)
    }
  })

  it("11) UPDATE falha → 500 genérico", async () => {
    const deps = makeDeps({
      updateError: { code: "42501", message: "permission denied for user@x.com" },
    })
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.status, 500)
      assert.equal(r.message, "Não foi possível concluir a troca de senha.")
    }
    assert.equal(deps.logs.length > 0, true)
  })

  it("12) confirmação falha se flag não ficou false", async () => {
    const deps = makeDeps({
      updateResult: { id: USER_A, must_change_password: true },
    })
    const r = await completeFirstPasswordChange(deps)
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.status, 500)
      assert.match(r.message, /confirmar a limpeza/)
    }
  })

  it("18-20) endpoint/serviço não recebe nem altera senha", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("./complete-first-password-change.ts", import.meta.url),
        "utf8"
      )
    )
    assert.equal(/\bpassword\s*:/.test(src), false)
    assert.equal(src.includes("updateUser"), false)
    assert.equal(src.includes("admin.updateUser"), false)
    assert.equal(src.includes("encrypted_password"), false)
    const deps = makeDeps()
    await completeFirstPasswordChange(deps)
    const logText = JSON.stringify(deps.logs).toLowerCase()
    assert.equal(logText.includes("senha"), false)
    assert.equal(/\bpassword\b/.test(logText.replaceAll("must_change_password", "")), false)
  })
})

describe("logFirstPasswordChangeDbError", () => {
  it("sanitiza e-mail/CPF/JWT; não loga senha", () => {
    const lines: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      lines.push(args)
    }
    try {
      logFirstPasswordChangeDbError({
        stage: "clear_must_change_password",
        operation: "update",
        error: {
          code: "42501",
          message:
            "denied user@secret.com cpf 52998224725 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb password=Secret123!",
        },
        userIdPrefix: "aaaaaaaa",
      })
    } finally {
      console.error = original
    }
    const payload = JSON.stringify(lines)
    assert.equal(payload.includes("user@secret.com"), false)
    assert.equal(payload.includes("52998224725"), false)
    assert.equal(payload.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), false)
    assert.match(payload, /\[redacted-email\]/)
    assert.match(payload, /clear_must_change_password/)
  })
})
