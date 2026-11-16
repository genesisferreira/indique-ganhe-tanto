import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const sql = readFileSync("supabase/patch-referral-share-links-3-1f-j11.sql", "utf8")
const card = readFileSync("components/referral-share/share-card.tsx", "utf8")
const form = readFileSync("components/referral-share/public-form.tsx", "utf8")
const route = readFileSync("app/api/public/indicacao/submit/route.ts", "utf8")

describe("3.1F-J11 referral share links", () => {
  it("guarda o token só como hash e não libera origem forjada", () => {
    assert.match(sql, /^begin;/m)
    assert.match(sql, /^commit;\s*$/m)
    assert.match(sql, /token_hash text not null/)
    assert.equal(/\btoken text\b/.test(sql), false)
    assert.match(sql, /unknown_field/)
    assert.match(sql, /origin_kind/)
    assert.match(sql, /reward_eligible/)
    assert.match(sql, /referral_share_link_immutable/)
    assert.doesNotMatch(sql, /net\.http|brbyte_sync|admin_reconcile_partner_commissions|admin_reconcile_employee_commissions/)
  })

  it("a rota pública não repassa campos de origem", () => {
    assert.match(route, /ALLOWED/)
    assert.doesNotMatch(route, /origin_kind|originatorId|reward_eligible|service_role|createServiceRoleClient/)
  })

  it("o cartão copia, compartilha, abre WhatsApp e baixa QR sem comissão", () => {
    assert.match(card, /navigator\.clipboard/)
    assert.match(card, /navigator\.share/)
    assert.match(card, /wa\.me/)
    assert.match(card, /Baixar QR PNG/)
    assert.match(card, /Baixar QR SVG/)
    assert.match(card, /Confirmar rotação/)
    assert.doesNotMatch(card, /R\$|comissao|comissão|reward/i)
    assert.match(form, /Link indisponível/)
    assert.match(form, /htmlFor=/)
  })
})
