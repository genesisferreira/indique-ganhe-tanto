import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  INDICATOR_BENEFICIARY_ROLES,
  isIndicatorRewardContextAllowed,
  isReferralRewardEligible,
} from "@/lib/referral-reward-eligibility"
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

const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, "")
const FINALIZE = read("supabase/patch-employee-origin-hardening-finalize-3-1f-h1b.sql")
const ctx = (origin_kind: string, indicator_role: string) =>
  isIndicatorRewardContextAllowed({ origin_kind, indicator_role, indicator_profile_id: "x", reward_eligible: true })

describe("3.1F-H1b context-confusion defense (origin prevails over role)", () => {
  it("beneficiary roles are exactly indicador/comercial/admin_master", () => {
    assert.deepEqual([...INDICATOR_BENEFICIARY_ROLES], ["indicador", "comercial", "admin_master"])
  })
  it("E1 comercial + indicator origin allowed", () => {
    assert.equal(ctx("indicator", "comercial"), true)
    assert.equal(ctx("assisted_indicator", "comercial"), true)
  })
  it("E2 comercial + employee origin blocked", () => assert.equal(ctx("employee", "comercial"), false))
  it("E3 admin_master + indicator origin allowed", () => {
    assert.equal(ctx("indicator", "admin_master"), true)
    assert.equal(ctx("assisted_indicator", "admin_master"), true)
  })
  it("E4 admin_master + employee origin blocked", () => assert.equal(ctx("employee", "admin_master"), false))
  it("E5 admin_financeiro + indicator origin blocked", () => assert.equal(ctx("indicator", "admin_financeiro"), false))
  it("E6 funcionario + indicator origin blocked", () => assert.equal(ctx("indicator", "funcionario"), false))
  it("E7 indicador + employee origin blocked", () => assert.equal(ctx("employee", "indicador"), false))
  it("web/neutral never eligible regardless of role", () => {
    for (const r of INDICATOR_BENEFICIARY_ROLES) {
      assert.equal(ctx("web_preregistration", r), false)
      assert.equal(ctx("neutral_network", r), false)
    }
    assert.equal(isReferralRewardEligible({ origin_kind: "web_preregistration", reward_eligible: true, indicator_profile_id: "x" }), false)
    assert.equal(isReferralRewardEligible({ origin_kind: "neutral_network", reward_eligible: true, indicator_profile_id: "x" }), false)
  })
  it("legacy preserves previous rule (no exclusive role denial)", () => {
    assert.equal(ctx("legacy", "comercial"), true)
    assert.equal(ctx("legacy", "admin_master"), true)
    assert.equal(isReferralRewardEligible({ origin_kind: "legacy", reward_eligible: true, indicator_profile_id: "x" }), true)
    assert.equal(isReferralRewardEligible({ origin_kind: "legacy", reward_eligible: false, indicator_profile_id: "x" }), false)
  })
})

describe("3.1F-H1b expand/finalize migrations (static)", () => {
  it("expand uses metadata default and never UPDATEs referrals", () => {
    assert.match(SQL, /add column if not exists origin_kind text not null default 'legacy'/)
    assert.doesNotMatch(stripSqlComments(SQL), /update\s+public\.referrals\s+set/i)
    assert.doesNotMatch(stripSqlComments(SQL), /disable\s+trigger|session_replication_role/i)
    assert.doesNotMatch(stripSqlComments(SQL), /origin_kind\s+set\s+default\s+null|origin_kind\s+drop\s+default/i)
  })
  it("expand removed the exclusive 'indicador' rule", () => {
    assert.doesNotMatch(SQL, /is distinct from 'indicador'/)
    assert.match(SQL, /not in \('indicador', 'comercial', 'admin_master'\)/)
  })
  it("finalize drops default, fails closed, never writes rows", () => {
    assert.match(FINALIZE, /alter column origin_kind drop default/)
    assert.match(FINALIZE, /raise exception 'h1b_finalize_abort/)
    assert.doesNotMatch(stripSqlComments(FINALIZE), /update\s+public\.(referrals|rewards)|delete\s+from|disable\s+trigger|session_replication_role/i)
  })
  it("public pre-registration sends explicit origin", () => {
    assert.match(read("lib/public-pre-registration/service.ts"), /origin_kind:\s*\n?\s*channelMeta\.source === NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE/)
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
