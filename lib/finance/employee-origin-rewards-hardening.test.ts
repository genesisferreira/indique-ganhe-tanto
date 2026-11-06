import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { isReferralRewardEligible } from "@/lib/referral-reward-eligibility"
import {
  EMPLOYEE_EVIDENCE_MAX_ROWS,
  EMPLOYEE_EVIDENCE_MAX_TIMEOUT_MS,
  buildEmployeeEvidenceFormFields,
  clampEmployeeEvidenceTimeoutMs,
  parseEmployeeEvidenceContractPk,
  summarizeEmployeeEvidence,
} from "@/lib/brbyte/employee-commission-invoice-evidence-result"

const read = (p: string) => readFileSync(p, "utf8")
const SQL = read("supabase/patch-employee-origin-and-rewards-hardening-3-1f-h1.sql")

describe("3.1F-H1 eligibility (app layer)", () => {
  it("employee origin never eligible even with tampered payload", () => {
    assert.equal(isReferralRewardEligible({ origin_kind: "employee", reward_eligible: true, indicator_profile_id: "x" }), false)
    assert.equal(isReferralRewardEligible({ source: "employee_sales_opportunity", reward_eligible: true, indicator_profile_id: "x" }), false)
  })
  it("valid indicator keeps behavior", () => {
    assert.equal(isReferralRewardEligible({ origin_kind: "indicator", reward_eligible: true, indicator_profile_id: "x" }), true)
    assert.equal(isReferralRewardEligible({ reward_eligible: true, indicator_profile_id: "x" }), true)
  })
  it("reward_eligible=false and null indicator block", () => {
    assert.equal(isReferralRewardEligible({ reward_eligible: false, indicator_profile_id: "x" }), false)
    assert.equal(isReferralRewardEligible({ reward_eligible: true, indicator_profile_id: null }), false)
  })
})

describe("3.1F-H1 architecture", () => {
  it("ensureRewardForReferralFromSupabase uses RPC, no direct rewards insert", () => {
    const src = read("lib/services/supabase-data.service.ts")
    const start = src.indexOf("export async function ensureRewardForReferralFromSupabase(")
    const end = src.indexOf("\nexport ", start + 10)
    const body = src.slice(start, end)
    assert.match(body, /rpc\("ensure_referral_reward"/)
    assert.doesNotMatch(body, /\.from\("rewards"\)\s*\.insert/)
  })
  it("no browser/client file inserts/updates/deletes rewards directly", () => {
    for (const f of ["lib/services/supabase-data.service.ts", "app/admin/indicacoes/[id]/page.tsx", "app/comercial/leads/[id]/page.tsx"]) {
      assert.doesNotMatch(read(f), /\.from\("rewards"\)\s*\.(insert|update|delete|upsert)\(/, f)
    }
  })
  it("createReferral sets explicit indicator origin; assisted sets assisted_indicator", () => {
    assert.match(read("lib/services/supabase-data.service.ts"), /origin_kind: "indicator" as const/)
    assert.match(read("lib/commercial-assisted/create-assisted-referral.ts"), /origin_kind: COMMERCIAL_ASSISTED_ORIGIN_KIND/)
  })
  it("employee path does not reuse indicator creation paths nor service role", () => {
    const src = read("lib/employee-opportunities/create-employee-sales-opportunity.ts").split("\n").filter((l) => !/^\s*(\*|\/\*\*|\/\/)/.test(l)).join("\n")
    assert.doesNotMatch(src, /createReferral|createAssistedReferral|createServiceRoleClient|service_role_key/i)
    assert.match(src, /create_employee_sales_opportunity/)
  })
  it("migration drops unsafe policies and revokes DML/TRUNCATE", () => {
    for (const p of ["dev_insert_rewards", "commercial_insert_rewards", "rewards_insert_policy", "rewards_update_policy", "rewards_delete_policy"]) {
      assert.match(SQL, new RegExp(`drop policy if exists ${p} on public.rewards`))
    }
    assert.match(SQL, /revoke insert, update, delete, truncate, references, trigger on table public\.rewards from authenticated/)
    assert.match(SQL, /revoke insert, update, delete, truncate, references, trigger on table public\.rewards from anon/)
    assert.match(SQL, /revoke all on function public\.mark_first_invoice_paid\(uuid\) from anon/)
    assert.doesNotMatch(SQL, /create policy [a-z_]+\s+on public\.rewards\s+for (insert|update|delete)/)
    assert.match(SQL, /unique \(opportunity_id, attribution_role\)/)
    assert.match(SQL, /set search_path = public/)
  })
  it("probe evidence module does not import write/sync/persistence modules", () => {
    for (const f of ["lib/brbyte/employee-commission-invoice-evidence.ts", "lib/brbyte/employee-commission-invoice-evidence-result.ts"]) {
      const src = read(f)
      assert.doesNotMatch(src, /supabase|collections\/(sync|discovery|batch|store)|check-first-invoice|invoice_info|createServiceRole|\.insert\(|\.update\(|\.rpc\(/, f)
      assert.doesNotMatch(src, /console\.log\([^)]*contractPk/, f)
    }
  })
  it("route requires admin_master for the new mode", () => {
    const src = read("app/api/admin/collections/invoice-list-probe/route.ts")
    assert.match(src, /EMPLOYEE_COMMISSION_INVOICE_EVIDENCE_MODE[\s\S]{0,200}role !== "admin_master"/)
    assert.match(src, /export const maxDuration = (\d+)/)
    assert.ok(Number(/maxDuration = (\d+)/.exec(src)![1]) * 1000 > EMPLOYEE_EVIDENCE_MAX_TIMEOUT_MS)
  })
})

describe("3.1F-H1 sanitized evidence (pure)", () => {
  it("validates contractPk and builds one bounded form", () => {
    assert.equal(parseEmployeeEvidenceContractPk("abc"), null)
    assert.equal(parseEmployeeEvidenceContractPk("0"), null)
    const f = buildEmployeeEvidenceFormFields("123")
    assert.equal(f.limit, String(EMPLOYEE_EVIDENCE_MAX_ROWS))
    assert.equal(f.dir, "ASC")
    assert.match(f.where, /"invoice_deleted","oper":7,"value":false/)
    assert.equal(clampEmployeeEvidenceTimeoutMs(999_999), 70_000)
  })
  it("never returns IDs, values or PII", () => {
    const json = { total: 2, data: [
      { invoice_pk: 987654, contract_pk: 4242, invoice_amount: 133.77, invoice_amount_paid: 50.11, invoice_msg: "paid", invoice_date_credit: "2026-01-02", client_name: "Fulano Secreto", invoice_deleted: false },
      { invoice_pk: 987655, contract_pk: 4242, invoice_amount: 133.77, invoice_amount_paid: 133.77, invoice_msg: "open", invoice_date_credit: null, invoice_deleted: false },
    ] }
    const r = summarizeEmployeeEvidence({ contractPk: "4242", timeoutMs: 70000, durationMs: 10, httpStatus: 200, json, transport: "ok" })
    const out = JSON.stringify(r)
    for (const leak of ["987654", "4242", "133.77", "50.11", "Fulano"]) assert.ok(!out.includes(leak), leak)
    assert.equal(r.partialPaymentCount, 1)
    assert.equal(r.contractIdConsistent, true)
    assert.equal(r.firstInvoiceOrderProven, false)
    assert.equal(r.absenceTreatedAsPayment, false)
  })
  it("timeout is inconclusive, not absence", () => {
    const r = summarizeEmployeeEvidence({ contractPk: "1", timeoutMs: 70000, durationMs: 70000, httpStatus: null, json: null, transport: "timeout" })
    assert.equal(r.classification, "ERP_TIMEOUT_INCONCLUSIVE")
    assert.equal(r.retryExecuted, false)
    assert.equal(r.attempts, 1)
  })
})
