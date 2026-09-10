/**
 * Arquitetura — Sprint 1.2R-D: hardening financeiro / RPC / reward_eligible.
 * Teste textual/puro: não conecta em banco.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")
const PATCH = "supabase/patch-financial-reward-eligibility-hardening.sql"
const CONVERSION_SERVICE = "lib/brbyte/check-conversion.service.ts"
const AUTO_CREDIT_GATE = "lib/brbyte/first-invoice-auto-credit-gate.ts"
const MANUAL_CALLER = "lib/services/supabase-data.service.ts"
const HISTORICAL_MANUAL_GRANT =
  "supabase/patch-mark-first-invoice-notify-indicator.sql"

function stripSqlComments(src: string): string {
  return src
    .replace(/--[^\n]*/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
}

describe("patch financial reward eligibility hardening", () => {
  const patchCode = readFileSync(join(repoRoot, PATCH), "utf8")
  const patchNorm = stripSqlComments(patchCode).toLowerCase()
  const conversionSrc = readFileSync(join(repoRoot, CONVERSION_SERVICE), "utf8")
  const autoCreditSrc = readFileSync(join(repoRoot, AUTO_CREDIT_GATE), "utf8")
  const callerSrc = readFileSync(join(repoRoot, MANUAL_CALLER), "utf8")
  const historicalGrant = readFileSync(
    join(repoRoot, HISTORICAL_MANUAL_GRANT),
    "utf8"
  )

  it("1) helper + search_path + begin/commit", () => {
    assert.match(patchNorm, /^\s*begin\s*;/m)
    assert.match(patchNorm, /^\s*commit\s*;/m)
    assert.match(
      patchNorm,
      /create or replace function public\.referral_is_financially_eligible/
    )
    assert.match(patchNorm, /set search_path = public/)
  })

  it("2) bloqueia public e Rede Neutra e reward_eligible=false", () => {
    assert.match(patchCode, /public_pre_registration/)
    assert.match(patchCode, /neutral_network_pre_registration/)
    assert.match(patchCode, /Pré-cadastro Web/)
    assert.match(patchCode, /Pré-cadastro Rede Neutra/)
    assert.match(patchNorm, /reward_eligible/)
  })

  it("3) ambas RPCs consultam o helper ANTES do crédito", () => {
    const helper = "referral_is_financially_eligible(v_ref)"
    const first = patchNorm.indexOf(helper)
    const second = patchNorm.indexOf(helper, first + 1)
    assert.ok(first >= 0 && second > first, "helper nas duas RPCs")

    const manualCredit = patchNorm.indexOf(
      "insert into public.wallet_transactions",
      patchNorm.indexOf("mark_first_invoice_paid(p_referral_id uuid)")
    )
    const manualGuard = patchNorm.indexOf(
      helper,
      patchNorm.indexOf("mark_first_invoice_paid(p_referral_id uuid)")
    )
    assert.ok(manualGuard > 0 && manualGuard < manualCredit)

    const syncStart = patchNorm.indexOf(
      "mark_first_invoice_paid_from_sync("
    )
    const syncGuard = patchNorm.indexOf(helper, syncStart)
    const syncCredit = patchNorm.lastIndexOf(
      "insert into public.wallet_transactions"
    )
    assert.ok(syncGuard > syncStart && syncGuard < syncCredit)
  })

  it("4) trigger em rewards força beneficiário = indicator_profile_id", () => {
    assert.match(
      patchNorm,
      /create or replace function public\.trg_rewards_enforce_financial_eligibility/
    )
    assert.match(patchNorm, /security definer/)
    assert.match(
      patchNorm,
      /new\.indicator_profile_id := v_ref\.indicator_profile_id/
    )
    assert.match(
      patchNorm,
      /before insert or update of referral_id, indicator_profile_id/
    )
  })

  it("5) mark_first_invoice_paid preserva auth.uid + role + comercial", () => {
    assert.match(patchNorm, /p\.id = auth\.uid\(\)/)
    assert.match(patchNorm, /'admin_financeiro', 'admin_master', 'comercial'/)
    assert.match(
      patchNorm,
      /v_role = 'comercial' and v_ref\.commercial_profile_id is distinct from auth\.uid\(\)/
    )
  })

  it("6) idempotência unique_violation + crédito usa amount do DB", () => {
    assert.match(patchNorm, /when unique_violation then/)
    assert.match(patchNorm, /v_ref\.indicator_profile_id/)
    assert.match(patchNorm, /v_reward\.amount/)
    assert.equal(/p_amount/.test(patchNorm.split("mark_first_invoice_paid(p_referral_id uuid)")[1]?.slice(0, 800) ?? ""), false)
  })

  it("7) NÃO altera GRANT de mark_first_invoice_paid", () => {
    assert.equal(
      /grant\s+execute\s+on\s+function\s+public\.mark_first_invoice_paid\s*\(\s*uuid\s*\)/i.test(
        patchCode
      ),
      false
    )
    assert.equal(
      /revoke\s+all\s+on\s+function\s+public\.mark_first_invoice_paid\s*\(\s*uuid\s*\)/i.test(
        patchCode
      ),
      false
    )
    assert.match(
      historicalGrant,
      /grant execute on function public\.mark_first_invoice_paid\(uuid\) to authenticated/
    )
  })

  it("8) NÃO concede from_sync a authenticated/anon", () => {
    assert.equal(
      /grant\s+execute\s+on\s+function\s+public\.mark_first_invoice_paid_from_sync[\s\S]{0,80}to\s+authenticated/i.test(
        patchCode
      ),
      false
    )
    assert.equal(
      /grant\s+execute\s+on\s+function\s+public\.mark_first_invoice_paid_from_sync[\s\S]{0,80}to\s+anon/i.test(
        patchCode
      ),
      false
    )
  })

  it("9) sem DISABLE TRIGGER / session_replication_role / RLS policy", () => {
    assert.equal(/\bdisable\s+trigger\b/i.test(patchNorm), false)
    assert.equal(/session_replication_role/i.test(patchNorm), false)
    assert.equal(/\bcreate\s+policy\b/i.test(patchNorm), false)
    assert.equal(/\benable\s+row\s+level\s+security\b/i.test(patchNorm), false)
  })

  it("10) conversão ERP e gate 1.2R-C permanecem separados", () => {
    assert.equal(conversionSrc.includes("ensureRewardForReferral"), false)
    assert.equal(conversionSrc.includes("mark_first_invoice_paid_from_sync"), false)
    assert.match(autoCreditSrc, /export function canAutoCreditFirstInvoiceReward/)
    assert.match(callerSrc, /rpc\("mark_first_invoice_paid"/)
  })
})
