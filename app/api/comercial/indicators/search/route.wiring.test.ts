import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const routeSrc = readFileSync(join(here, "route.ts"), "utf8")
const pageSrc = readFileSync(
  join(here, "../../../../comercial/nova-indicacao/page.tsx"),
  "utf8"
)

describe("indicators/search route wiring (hotfix service-role)", () => {
  it("10) createAdminClient não é usado", () => {
    assert.equal(routeSrc.includes("createAdminClient"), false)
  })

  it("8/25) auth usa createClient; privilegiado usa createServiceRoleClient lazy", () => {
    assert.match(routeSrc, /createClient/)
    assert.match(routeSrc, /createServiceRoleClient/)
    assert.match(routeSrc, /getPrivileged/)
    const getUserIdx = routeSrc.indexOf("getUser:")
    const searchIdx = routeSrc.indexOf("searchIndicatorRows:")
    const getPrivCallInSearch = routeSrc.indexOf("getPrivileged()", searchIdx)
    assert.equal(getUserIdx >= 0 && searchIdx > getUserIdx, true)
    assert.equal(getPrivCallInSearch > searchIdx, true)
  })

  it("getUser/getActorProfile não usam service role; audit permanece na sessão", () => {
    const getUserBlock = routeSrc.slice(
      routeSrc.indexOf("getUser:"),
      routeSrc.indexOf("getActorProfile:")
    )
    const actorBlock = routeSrc.slice(
      routeSrc.indexOf("getActorProfile:"),
      routeSrc.indexOf("searchIndicatorRows:")
    )
    const auditBlock = routeSrc.slice(routeSrc.indexOf("insertSearchAudit:"))
    assert.match(getUserBlock, /supabase\.auth\.getUser/)
    assert.equal(getUserBlock.includes("getPrivileged"), false)
    assert.equal(actorBlock.includes("getPrivileged"), false)
    assert.match(auditBlock, /supabase as unknown/)
    assert.equal(auditBlock.includes("getPrivileged"), false)
  })

  it("query privilegiada restringe role=indicador e is_active=true", () => {
    const searchBlock = routeSrc.slice(
      routeSrc.indexOf("searchIndicatorRows:"),
      routeSrc.indexOf("insertSearchAudit:")
    )
    assert.match(searchBlock, /\.eq\("role", "indicador"\)/)
    assert.match(searchBlock, /\.eq\("is_active", true\)/)
    assert.match(
      searchBlock,
      /\.select\("id, full_name, phone, email, cpf, is_active, role"\)/
    )
    assert.equal(searchBlock.toLowerCase().includes("pix"), false)
    assert.equal(searchBlock.toLowerCase().includes("wallet"), false)
    assert.equal(searchBlock.toLowerCase().includes("reward"), false)
  })

  it("contrato UI: search → selected.id → assisted-referrals", () => {
    assert.match(
      pageSrc,
      /\/api\/comercial\/indicators\/search\?q=/
    )
    assert.match(pageSrc, /\/api\/comercial\/assisted-referrals/)
    assert.match(pageSrc, /indicator_profile_id:\s*selected\.id/)
  })
})
