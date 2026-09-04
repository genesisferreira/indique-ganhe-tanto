import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { logAssistedReferralDbError } from "@/lib/commercial-assisted/assisted-referral-db-log"

const here = dirname(fileURLToPath(import.meta.url))
const routeSrc = readFileSync(join(here, "route.ts"), "utf8")

describe("assisted-referrals route wiring (hotfix service-role)", () => {
  it("createAdminClient não é usado", () => {
    assert.equal(routeSrc.includes("createAdminClient"), false)
  })

  it("auth usa createClient; privilegiado usa createServiceRoleClient lazy", () => {
    assert.match(routeSrc, /createClient/)
    assert.match(routeSrc, /createServiceRoleClient/)
    assert.match(routeSrc, /getPrivileged/)
    const getUserIdx = routeSrc.indexOf("getUser:")
    const loadIdx = routeSrc.indexOf("loadIndicatorProfile:")
    assert.equal(getUserIdx >= 0 && loadIdx > getUserIdx, true)
  })

  it("lookup/idempotency/insert/plans usam getPrivilegedDb", () => {
    for (const label of [
      "loadIndicatorProfile:",
      "findReferralByIdempotencyKey:",
      "insertReferral:",
      "listPlanRows:",
      "insertReferralHistory:",
    ]) {
      const start = routeSrc.indexOf(label)
      assert.ok(start >= 0, label)
      const slice = routeSrc.slice(start, start + 400)
      assert.match(slice, /getPrivilegedDb\(\)/)
    }
  })

  it("getUser/getActorProfile não usam service role; audit permanece na sessão", () => {
    const getUserBlock = routeSrc.slice(
      routeSrc.indexOf("getUser:"),
      routeSrc.indexOf("getActorProfile:")
    )
    const actorBlock = routeSrc.slice(
      routeSrc.indexOf("getActorProfile:"),
      routeSrc.indexOf("loadIndicatorProfile:")
    )
    const auditBlock = routeSrc.slice(routeSrc.indexOf("insertAudit:"))
    assert.match(getUserBlock, /supabase\.auth\.getUser/)
    assert.equal(getUserBlock.includes("getPrivileged"), false)
    assert.equal(actorBlock.includes("getPrivileged"), false)
    assert.match(auditBlock, /supabase as unknown as AnyDb/)
    assert.equal(auditBlock.includes("getPrivileged"), false)
  })

  it("log sanitizado redige e-mail/doc/JWT", () => {
    const lines: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      lines.push(args)
    }
    try {
      logAssistedReferralDbError({
        stage: "indicator_lookup",
        operation: "select",
        error: {
          code: "42501",
          message:
            "denied user@secret.com cpf 52998224725 cnpj 11222333000181 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
        },
        idempotencyKeyPrefix: "aaaaaaaa",
      })
    } finally {
      console.error = original
    }
    const payload = JSON.stringify(lines)
    assert.equal(payload.includes("user@secret.com"), false)
    assert.equal(payload.includes("52998224725"), false)
    assert.equal(payload.includes("11222333000181"), false)
    assert.match(payload, /\[redacted-email\]/)
    assert.match(payload, /indicator_lookup/)
  })
})
