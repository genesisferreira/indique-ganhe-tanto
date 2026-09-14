import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
}

describe("3.1E-FIX provisioning compartilhado Indicador x Funcionário", () => {
  const helper = read("lib/auth/create-confirmed-auth-user.ts")
  const indicatorRoute = read("app/api/comercial/assisted-indicators/route.ts")
  const employeeRoute = read("app/api/admin/employees/create/route.ts")
  const indicatorService = read("lib/commercial-assisted/create-assisted-indicator.ts")
  const employeeService = read("lib/employees/create-employee-account.ts")
  const generator = read("lib/commercial-assisted/temporary-password.ts")
  const novo = read("app/admin/funcionarios/novo/page.tsx")
  const login = read("app/login/page.tsx")
  const firstAccess = read("app/primeiro-acesso/page.tsx")

  it("A/H) Indicador e Funcionário usam o mesmo helper de createUser", () => {
    assert.match(helper, /email_confirm: true/)
    assert.match(helper, /admin\.createUser/)
    assert.match(indicatorRoute, /createConfirmedAuthUserWithPassword/)
    assert.match(employeeRoute, /createConfirmedAuthUserWithPassword/)
    assert.equal(indicatorRoute.includes("inviteUserByEmail"), false)
    assert.equal(employeeRoute.includes("inviteUserByEmail"), false)
  })

  it("B) mesmo gerador de senha temporária", () => {
    assert.match(indicatorService, /generateAssistedTemporaryPassword/)
    assert.match(employeeService, /generateAssistedTemporaryPassword/)
    assert.match(generator, /ASSISTED_TEMP_PASSWORD_LENGTH = 16/)
  })

  it("C) senha createUser === resposta (serviço funcionário)", () => {
    assert.match(employeeService, /password: temporaryPassword/)
    assert.match(
      employeeService,
      /temporaryPassword: input\.replayed \? null : input\.temporaryPassword/
    )
  })

  it("D) retry não reexibe senha", () => {
    assert.match(employeeService, /temporaryPassword: null/)
    assert.match(indicatorService, /temporaryPassword: null/)
  })

  it("E) must_change_password permanece no fluxo funcionário", () => {
    assert.match(employeeService, /mustChangePassword: true/)
    assert.match(employeeRoute, /must_change_password: true/)
  })

  it("F) login único e primeiro-acesso", () => {
    assert.match(login, /signInWithPassword/)
    assert.match(login, /normalizeLoginEmail/)
    assert.equal(login.includes("password.trim"), false)
    assert.match(firstAccess, /updateUser\(\{\s*password/)
  })

  it("I) funcionário não vira comercial no create", () => {
    assert.equal(employeeRoute.includes('role: "comercial"'), false)
    assert.equal(employeeService.includes('role: "comercial"'), false)
  })

  it("entrega de senha do funcionário reutiliza clipboard do indicador", () => {
    assert.match(novo, /buildTemporaryAccessClipboardText/)
    assert.match(novo, /font-mono/)
    assert.match(novo, /Copiar login e senha/)
  })
})
