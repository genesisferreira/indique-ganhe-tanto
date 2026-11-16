import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const sql = readFileSync("supabase/patch-partner-merchant-referral-3-1f-j9.sql", "utf8")
const code = sql.replace(/--[^\n]*/g, "")

describe("3.1F-J9 migration", () => {
  it("é transacional, aditiva e não cria regra nem entitlement", () => {
    assert.match(sql, /^begin;/m)
    assert.match(sql, /^commit;\s*$/m)
    assert.match(sql, /partner_entitlements_withheld_this_release/)
    assert.equal(/\bdrop\s+table\b|\btruncate\b/i.test(code), false)
  })
  it("token é hash, RPC pública não recebe partner_id e reward fica falso", () => {
    const submit = sql.slice(sql.indexOf("function public.submit_partner_merchant_referral"), sql.indexOf("function public.list_partner_opportunity_origins"))
    const allowed = submit.slice(submit.indexOf("c_allowed"), submit.indexOf("];"))
    assert.match(sql, /token_hash text not null/)
    assert.equal(/\btoken text\b/.test(sql), false)
    assert.match(sql, /partner_random_token\(\)/)
    assert.match(sql, /gen_random_bytes/)
    assert.match(sql, /%s\(32\)/)
    assert.match(sql, /origin_kind', 'partner_merchant', 'reward_eligible', false/)
    assert.match(submit, /false, 'partner_merchant_referral', 'Comércio Parceiro', 'partner_merchant'/)
    assert.doesNotMatch(allowed, /partnerId|reward_eligible|indicatorProfileId|origin_kind/)
    assert.doesNotMatch(readFileSync("app/api/public/parceiro/submit/route.ts", "utf8"), /service_role|createServiceRoleClient/)
  })
  it("fixed_amount é configurável e as outras modalidades nascem bloqueadas", () => {
    assert.match(sql, /full_payment_unproven/)
    assert.match(sql, /percentage_base_not_proven/)
    assert.match(sql, /invoice_generated/)
    assert.equal(/fixed_amount_cents\s+integer\s+not\s+null\s+default\s+(3000|5000)/.test(sql), false)
    assert.match(sql, /partner_commission_entitlements_fixed_once_uidx/)
  })
  it("grants públicos são só o formulário", () => {
    assert.match(sql, /grant execute on function public\.submit_partner_merchant_referral\(text, text, jsonb\) to anon, authenticated/)
    assert.match(sql, /revoke all on function public\.admin_issue_partner_link\(jsonb\) from public, anon, authenticated, service_role/)
    assert.match(sql, /set search_path = public, pg_temp/)
  })
})
