import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
}

describe("3.1E-R password recovery architecture", () => {
  const callback = read("app/auth/callback/route.ts")
  const updatePage = read("app/atualizar-senha/page.tsx")
  const recoverPage = read("app/recuperar-senha/page.tsx")
  const firstAccess = read("app/primeiro-acesso/page.tsx")
  const employeeCreate = read("lib/employees/create-employee-account.ts")
  const indicatorCreate = read("lib/commercial-assisted/create-assisted-indicator.ts")
  const login = read("app/login/page.tsx")

  it("I) updateUser só após getUser na página", () => {
    assert.match(updatePage, /getUser\(\)/)
    assert.match(updatePage, /updateUser\(\{\s*password/)
    const getUserIdx = updatePage.indexOf("auth.getUser()")
    const updateIdx = updatePage.indexOf("auth.updateUser")
    assert.equal(getUserIdx >= 0 && updateIdx > getUserIdx, true)
  })

  it("K) senha não vai para logs", () => {
    assert.equal(updatePage.includes("console.log"), false)
    assert.equal(updatePage.includes("console.error"), false)
    assert.equal(callback.includes("console."), false)
    assert.equal(callback.includes("error.message"), false)
    assert.match(callback, /resolvePasswordRecoveryCallback/)
  })

  it("L/M) recovery normaliza e-mail e não enumera conta", () => {
    assert.match(recoverPage, /normalizeRecoveryEmail/)
    assert.match(recoverPage, /resetPasswordForEmail/)
    assert.match(recoverPage, /const \{ error \}/)
    assert.match(recoverPage, /passwordResetPublicMessage/)
  })

  it("N) sucesso chama complete-first-password-change", () => {
    assert.match(updatePage, /\/api\/auth\/complete-first-password-change/)
    assert.match(updatePage, /performClientLogout/)
  })

  it("O) primeiro-acesso inalterado neste fix", () => {
    assert.match(firstAccess, /complete-first-password-change/)
    assert.match(firstAccess, /updateUser\(\{\s*password/)
  })

  it("P/Q) indicador e funcionário não usam recovery callback", () => {
    assert.equal(employeeCreate.includes("resetPasswordForEmail"), false)
    assert.equal(indicatorCreate.includes("resetPasswordForEmail"), false)
    assert.match(employeeCreate, /generateAssistedTemporaryPassword/)
    assert.match(indicatorCreate, /generateAssistedTemporaryPassword/)
  })

  it("R) login continua com signInWithPassword", () => {
    assert.match(login, /signInWithPassword/)
    assert.match(login, /normalizeLoginEmail/)
  })

  it("UI de erro não mostra inputs de senha", () => {
    assert.match(updatePage, /RECOVERY_INVALID_LINK_TITLE/)
    assert.match(updatePage, /Solicitar novo link/)
    assert.match(updatePage, /view === "blocked"/)
  })
})
