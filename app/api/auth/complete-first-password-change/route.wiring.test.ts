import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const routeSrc = readFileSync(join(here, "route.ts"), "utf8")
const pageSrc = readFileSync(
  join(here, "../../../../app/primeiro-acesso/page.tsx"),
  "utf8"
)
const migrationSrc = readFileSync(
  join(
    here,
    "../../../../supabase/patch-assisted-indicator-account-foundation.sql"
  ),
  "utf8"
)

describe("complete-first-password-change route wiring", () => {
  it("13) createAdminClient não é usado", () => {
    assert.equal(routeSrc.includes("createAdminClient"), false)
  })

  it("14) createServiceRoleClient só após auth na arquitetura do route", () => {
    assert.match(routeSrc, /createClient/)
    assert.match(routeSrc, /createServiceRoleClient/)
    assert.match(routeSrc, /getUser/)
    const getUserIdx = routeSrc.indexOf("getUser:")
    const getPrivIdx = routeSrc.indexOf("getPrivilegedDb:")
    assert.equal(getUserIdx >= 0 && getPrivIdx > getUserIdx, true)
    assert.match(routeSrc, /getPrivileged\(\)/)
  })

  it("binding: SELECT/UPDATE usam id da sessão, sem body", () => {
    assert.equal(routeSrc.includes("request.json"), false)
    assert.equal(routeSrc.includes("NextRequest"), false)
    assert.match(routeSrc, /\.eq\("id", id\)/)
    assert.match(pageSrc, /auth\.updateUser\(\{\s*password/)
    assert.match(
      pageSrc,
      /fetch\("\/api\/auth\/complete-first-password-change"/
    )
    // Ordem no client: updateUser antes do POST
    const upd = pageSrc.indexOf("updateUser")
    const post = pageSrc.indexOf("/api/auth/complete-first-password-change")
    assert.equal(upd >= 0 && post > upd, true)
  })

  it("15-16) migration RLS intacta; sem policy nova no hotfix", () => {
    assert.match(
      migrationSrc,
      /current_user_password_change_completed/
    )
    assert.match(
      migrationSrc,
      /profiles_update_policy/
    )
    // Route não adiciona SQL/policies
    assert.equal(routeSrc.includes("create policy"), false)
  })

  it("17) browser não limpa flag diretamente — só via API após updateUser", () => {
    assert.equal(pageSrc.includes("must_change_password"), false)
    assert.equal(pageSrc.includes('.update({ must_change_password'), false)
  })

  it("18-19) route não recebe nem altera senha Auth", () => {
    // Remover comentários para não confundir com a doc da ordem client→API.
    const codeOnly = routeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    assert.equal(codeOnly.includes("updateUser"), false)
    assert.equal(codeOnly.includes("auth.admin"), false)
    assert.equal(/\bpassword\s*:/.test(codeOnly), false)
    assert.equal(codeOnly.includes("request.json"), false)
    assert.equal(codeOnly.includes("createAdminClient"), false)
  })
})
