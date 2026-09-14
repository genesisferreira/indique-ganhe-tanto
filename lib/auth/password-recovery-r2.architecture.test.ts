import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
}

describe("3.1E-R2 recovery token_hash architecture", () => {
  const landing = read("app/auth/recuperar-confirmacao/page.tsx")
  const confirm = read("app/auth/confirm/route.ts")
  const callback = read("app/auth/callback/route.ts")
  const updatePage = read("app/atualizar-senha/page.tsx")
  const recoverPage = read("app/recuperar-senha/page.tsx")
  const firstAccess = read("app/primeiro-acesso/page.tsx")
  const employeeCreate = read("lib/employees/create-employee-account.ts")
  const indicatorCreate = read(
    "lib/commercial-assisted/create-assisted-indicator.ts"
  )
  const fragment = read("lib/auth/recovery-token-fragment.ts")
  const layout = read("app/layout.tsx")
  const middleware = read("middleware.ts")

  it("F) GET landing não chama verifyOtp nem Auth", () => {
    assert.equal(landing.includes("verifyOtp"), false)
    assert.equal(landing.includes("getSupabaseClient"), false)
    assert.equal(landing.includes("exchangeCodeForSession"), false)
    assert.match(landing, /parseRecoveryFragment/)
    assert.match(landing, /history\.replaceState/)
    assert.match(landing, /Continuar recuperação/)
  })

  it("O) double submit protegido no frontend", () => {
    assert.match(landing, /createRecoveryConfirmSingleFlight/)
    assert.match(landing, /disabled=\{busy\}/)
    assert.match(landing, /submitRecoveryConfirmation/)
  })

  it("POST confirm usa verifyOtp recovery e não mistura PKCE", () => {
    assert.match(confirm, /export async function POST/)
    assert.equal(/\bexport async function GET\b/.test(confirm), false)
    assert.match(confirm, /verifyOtp/)
    assert.match(confirm, /type: "recovery"|type: 'recovery'/)
    assert.equal(confirm.includes("exchangeCodeForSession"), false)
    assert.match(confirm, /executeRecoveryConfirm/)
    assert.equal(confirm.includes("NextResponse.redirect"), false)
    assert.equal(confirm.includes("303"), false)
  })

  it("Q) /auth/callback PKCE permanece intacto", () => {
    assert.match(callback, /resolvePasswordRecoveryCallback/)
    assert.match(callback, /exchangeCodeForSession/)
    assert.equal(callback.includes("verifyOtp"), false)
  })

  it("L) /atualizar-senha reusa gate e sessão", () => {
    assert.match(updatePage, /getUser\(\)/)
    assert.match(updatePage, /updateUser\(\{\s*password/)
    assert.match(updatePage, /complete-first-password-change/)
    assert.match(updatePage, /performClientLogout/)
  })

  it("M) URL final de sucesso não inclui token", () => {
    assert.match(landing, /recoverySuccessDestination/)
    assert.equal(confirm.includes("token_hash="), false)
    assert.equal(confirm.includes("searchParams.set(\"token_hash\""), false)
    assert.equal(landing.includes("redirect: \"manual\""), false)
    assert.match(landing, /window\.location\.assign/)
  })

  it("N) token não é logado", () => {
    for (const src of [landing, confirm, fragment, callback]) {
      assert.equal(src.includes("console.log"), false)
      assert.equal(src.includes("console.error"), false)
      assert.equal(src.includes("console.info"), false)
    }
    assert.equal(landing.includes("localStorage"), false)
    assert.equal(landing.includes("sessionStorage"), false)
  })

  it("token_hash não vai para query string criada pelo CRM", () => {
    assert.equal(recoverPage.includes("token_hash="), false)
    assert.match(recoverPage, /buildPasswordRecoveryRedirectTo/)
    assert.match(fragment, /parseRecoveryFragment/)
    assert.equal(landing.includes("?token_hash"), false)
  })

  it("R) primeiro acesso permanece intacto", () => {
    assert.match(firstAccess, /complete-first-password-change/)
    assert.match(firstAccess, /updateUser\(\{\s*password/)
    assert.equal(firstAccess.includes("verifyOtp"), false)
  })

  it("S) indicador permanece intacto", () => {
    assert.match(indicatorCreate, /generateAssistedTemporaryPassword/)
    assert.equal(indicatorCreate.includes("resetPasswordForEmail"), false)
    assert.equal(indicatorCreate.includes("verifyOtp"), false)
  })

  it("T) funcionário permanece intacto", () => {
    assert.match(employeeCreate, /generateAssistedTemporaryPassword/)
    assert.equal(employeeCreate.includes("resetPasswordForEmail"), false)
    assert.equal(employeeCreate.includes("verifyOtp"), false)
  })

  it("Analytics global não recebe hash manualmente", () => {
    assert.match(layout, /Analytics/)
    assert.equal(landing.includes("location.href"), false)
    assert.equal(landing.includes("window.location.hash"), true)
    assert.equal(landing.includes("analytics"), false)
  })

  it("rotas /auth recebem no-store no middleware", () => {
    assert.match(middleware, /pathname\.startsWith\("\/auth\/"\)/)
    assert.match(middleware, /applyNoStoreHeaders/)
  })
})
