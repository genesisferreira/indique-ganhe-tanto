/**
 * Arquitetura — Sprint 1.2R-B: trigger aprovada ignora ERP converted.
 *
 * Teste textual/puro: não conecta em banco.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")

const PATCH = "supabase/patch-trg-aprovada-skip-erp-converted.sql"
const ORIGINAL_TRIGGER_PATCH =
  "supabase/patch-commercial-lead-distribution.sql"
const CONVERSION_SERVICE = "lib/brbyte/check-conversion.service.ts"
const FIRST_INVOICE_SERVICE = "lib/brbyte/check-first-invoice.service.ts"
const AUTO_CREDIT_GATE = "lib/brbyte/first-invoice-auto-credit-gate.ts"

function stripSqlComments(src: string): string {
  return src
    .replace(/--[^\n]*/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
}

describe("patch trg_referrals_assign_commercial_on_aprovada skip ERP converted", () => {
  const patchCode = readFileSync(join(repoRoot, PATCH), "utf8")
  const patchNorm = stripSqlComments(patchCode).toLowerCase()
  const original = readFileSync(join(repoRoot, ORIGINAL_TRIGGER_PATCH), "utf8")
  const conversionSrc = readFileSync(join(repoRoot, CONVERSION_SERVICE), "utf8")
  const firstInvoiceSrc = readFileSync(
    join(repoRoot, FIRST_INVOICE_SERVICE),
    "utf8"
  )
  const autoCreditSrc = readFileSync(join(repoRoot, AUTO_CREDIT_GATE), "utf8")

  it("1) alvo correto: CREATE OR REPLACE da função do trigger", () => {
    assert.match(
      patchNorm,
      /create or replace function public\.trg_referrals_assign_commercial_on_aprovada\(\)/
    )
    assert.match(patchNorm, /returns trigger/)
    assert.match(patchNorm, /security definer/)
    assert.match(patchNorm, /set search_path = public/)
  })

  it("2) skip ERP converted RETORNA antes da atribuição", () => {
    const skipIdx = patchNorm.indexOf(
      "if new.brbyte_sync_status = 'converted' then"
    )
    assert.ok(skipIdx >= 0, "condição NEW.brbyte_sync_status = converted")

    const returnIdx = patchNorm.indexOf("return new;", skipIdx)
    const assignIdx = patchNorm.indexOf(
      "assign_referral_to_next_commercial(new.id)",
      skipIdx
    )
    assert.ok(returnIdx > skipIdx, "RETURN NEW no ramo converted")
    assert.ok(assignIdx > returnIdx, "assign só depois do skip/return")
  })

  it("3) comportamento não-ERP de aprovada ainda existe", () => {
    assert.match(
      patchNorm,
      /if new\.status = 'aprovada'::public\.referral_status/
    )
    assert.match(patchNorm, /old\.status is distinct from new\.status/)
    assert.match(patchNorm, /new\.commercial_profile_id is null then/)
    assert.match(
      patchNorm,
      /perform public\.assign_referral_to_next_commercial\(new\.id\)/
    )
  })

  it("4) não DROP TRIGGER / não desabilita trigger", () => {
    assert.equal(/\bdrop\s+trigger\b/i.test(patchNorm), false)
    assert.equal(/\bdisable\s+trigger\b/i.test(patchNorm), false)
    assert.equal(/session_replication_role/i.test(patchNorm), false)
  })

  it("5) nenhum GRANT novo", () => {
    assert.equal(/\bgrant\b/i.test(patchNorm), false)
    assert.equal(/\brevoke\b/i.test(patchNorm), false)
  })

  it("6) nenhuma alteração financeira / RLS", () => {
    assert.equal(/\benable\s+row\s+level\s+security\b/i.test(patchNorm), false)
    assert.equal(/\bcreate\s+policy\b/i.test(patchNorm), false)
    assert.equal(/\bmark_first_invoice_paid/i.test(patchNorm), false)
    assert.equal(/\bensurereward/i.test(patchNorm), false)
    assert.equal(/\bwallet\b/i.test(patchNorm), false)
    assert.equal(/\brewards\b/i.test(patchNorm), false)
    assert.equal(/\binsert\s+into\b/i.test(patchNorm), false)
    assert.equal(/\bupdate\s+public\./i.test(patchNorm), false)
    assert.equal(/\bdelete\s+from\b/i.test(patchNorm), false)
  })

  it("7) patch é idempotente e transacional", () => {
    const beginIdx = patchNorm.search(/^\s*begin\s*;/im)
    const commitIdx = patchNorm.search(/^\s*commit\s*;/im)
    assert.ok(beginIdx >= 0, "BEGIN;")
    assert.ok(commitIdx > beginIdx, "COMMIT; depois de BEGIN;")
    assert.match(patchCode, /idempotente/i)
    assert.equal(/\bdrop\s+function\b/i.test(patchNorm), false)
  })

  it("8) definição original do trigger permanece no histórico versionado", () => {
    assert.match(
      original,
      /create or replace function public\.trg_referrals_assign_commercial_on_aprovada\(\)/i
    )
    assert.match(
      original,
      /perform public\.assign_referral_to_next_commercial\(NEW\.id\)/
    )
    assert.equal(
      /brbyte_sync_status = 'converted'/i.test(original),
      false,
      "patch original não deve já conter o skip (fica no aditivo)"
    )
  })

  it("9) conversão não chama efeitos financeiros da 1.2R-C", () => {
    assert.equal(conversionSrc.includes("ensureRewardForReferral"), false)
    assert.equal(conversionSrc.includes("mark_first_invoice_paid_from_sync"), false)
    assert.equal(conversionSrc.includes("first-invoice-auto-credit-gate"), false)
    assert.equal(conversionSrc.includes("canAutoCreditFirstInvoiceReward"), false)
    assert.match(conversionSrc, /deriveCommercialStateFromErpConversion/)
    assert.match(firstInvoiceSrc, /canAutoCreditFirstInvoiceReward/)
    assert.match(autoCreditSrc, /export function canAutoCreditFirstInvoiceReward/)
  })
})
