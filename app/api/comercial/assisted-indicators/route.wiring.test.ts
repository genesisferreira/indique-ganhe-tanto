import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { logAssistedIndicatorDbError } from "@/lib/commercial-assisted/assisted-indicator-db-log"

const here = dirname(fileURLToPath(import.meta.url))
const routeSrc = readFileSync(join(here, "route.ts"), "utf8")
const migrationSrc = readFileSync(
  join(
    here,
    "../../../../supabase/patch-assisted-indicator-account-foundation.sql"
  ),
  "utf8"
)

describe("assisted-indicators route wiring (hotfix service-role)", () => {
  it("não usa createAdminClient (SSR/cookies) para ops privilegiadas", () => {
    assert.equal(routeSrc.includes("createAdminClient"), false)
    assert.equal(routeSrc.includes('from "@/lib/supabase/server"'), true)
    assert.match(routeSrc, /createClient/)
  })

  it("ops de assisted_indicator_creations usam createServiceRoleClient", () => {
    assert.match(routeSrc, /createServiceRoleClient/)
    assert.match(routeSrc, /getPrivileged/)
    const findBlock = routeSrc.slice(
      routeSrc.indexOf("findCreationByKey:"),
      routeSrc.indexOf("insertCreationPending:")
    )
    const insertBlock = routeSrc.slice(
      routeSrc.indexOf("insertCreationPending:"),
      routeSrc.indexOf("updateCreation:")
    )
    const updateBlock = routeSrc.slice(
      routeSrc.indexOf("updateCreation:"),
      routeSrc.indexOf("findProfileByEmail:")
    )
    assert.match(findBlock, /getPrivilegedDb\(\)/)
    assert.match(insertBlock, /getPrivilegedDb\(\)/)
    assert.match(updateBlock, /getPrivilegedDb\(\)/)
  })

  it("auth de sessão usa createClient + getUser/getActorProfile (não service role)", () => {
    const getUserBlock = routeSrc.slice(
      routeSrc.indexOf("getUser:"),
      routeSrc.indexOf("getActorProfile:")
    )
    const actorBlock = routeSrc.slice(
      routeSrc.indexOf("getActorProfile:"),
      routeSrc.indexOf("findCreationByKey:")
    )
    assert.match(getUserBlock, /supabase\.auth\.getUser/)
    assert.match(actorBlock, /supabase[\s\S]*?\.from\("profiles"\)/)
    assert.equal(getUserBlock.includes("getPrivileged"), false)
    assert.equal(actorBlock.includes("getPrivileged"), false)
  })

  it("createUser só via auth.admin no cliente privilegiado", () => {
    assert.match(routeSrc, /getPrivileged\(\)\.auth\.admin\.createUser/)
  })

  it("profiles/pix privilegiados usam service role; audit permanece na sessão", () => {
    const profileEmail = routeSrc.slice(
      routeSrc.indexOf("findProfileByEmail:"),
      routeSrc.indexOf("findProfileByCpf:")
    )
    const pixBlock = routeSrc.slice(
      routeSrc.indexOf("findPixOwnerProfileId:"),
      routeSrc.indexOf("findProfileById:")
    )
    const auditBlock = routeSrc.slice(routeSrc.indexOf("insertAudit:"))
    assert.match(profileEmail, /getPrivilegedDb\(\)/)
    assert.match(pixBlock, /getPrivilegedDb\(\)/)
    assert.match(auditBlock, /supabase as unknown as AnyDb/)
    assert.equal(auditBlock.includes("getPrivileged"), false)
  })

  it("log sanitizado não vazaria e-mail/CPF/JWT no diagnóstico", () => {
    const lines: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      lines.push(args)
    }
    try {
      logAssistedIndicatorDbError({
        stage: "idempotency_insert_pending",
        operation: "insert",
        error: {
          code: "42501",
          message:
            "new row violates for user@secret.com cpf 52998224725 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
        },
        idempotencyKeyPrefix: "aaaaaaaa",
      })
    } finally {
      console.error = original
    }
    const payload = JSON.stringify(lines)
    assert.equal(payload.includes("user@secret.com"), false)
    assert.equal(payload.includes("52998224725"), false)
    assert.equal(payload.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), false)
    assert.match(payload, /idempotency_insert_pending/)
    assert.match(payload, /42501/)
    assert.match(payload, /\[redacted-email\]/)
  })
})

describe("assisted_indicator_creations RLS (migration declarativa)", () => {
  it("RLS permanece habilitada", () => {
    assert.match(
      migrationSrc,
      /alter table public\.assisted_indicator_creations enable row level security/
    )
  })

  it("nenhuma policy permissiva na tabela de criações", () => {
    assert.equal(
      /create policy[\s\S]*on public\.assisted_indicator_creations/i.test(
        migrationSrc
      ),
      false
    )
    assert.match(
      migrationSrc,
      /Sem policies para roles autenticados: somente service role/
    )
  })

  it("comentário da tabela exige acesso via service role", () => {
    assert.match(migrationSrc, /Acesso via service role/)
  })
})
