import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const service = readFileSync(new URL("./check-first-invoice.service.ts", import.meta.url), "utf8")
const sql = readFileSync(
  new URL("../../supabase/patch-controllr-automation-3-1f-j15d.sql", import.meta.url),
  "utf8"
)

describe("ativação controlada do reward", () => {
  it("o crédito usa a regra e a chave determinística, sem valor da fatura", () => {
    assert.match(service, /p_amount:\s*null/)
    assert.match(service, /buildIndicatorFirstInvoiceCreditKey/)
    assert.doesNotMatch(service, /p_amount:\s*infoResult|p_amount:\s*invoicePaidAmount/)
    assert.match(sql, /current_user = 'service_role'/)
    assert.match(sql, /origin_kind in \('employee', 'partner_merchant'\)/)
    assert.match(sql, /v_sync and \(v_amount is null or v_amount <= 0\)/)
    assert.match(sql, /notify_first_automatic_indicator_reward/)
    assert.match(sql, /v_credit_amount := v_ref.reward_amount/)
    assert.doesNotMatch(sql, /v_credit_amount := p_amount/)
    assert.doesNotMatch(sql, /pix_transfer|bank_split|invoice_amount_paid/)
  })
})
