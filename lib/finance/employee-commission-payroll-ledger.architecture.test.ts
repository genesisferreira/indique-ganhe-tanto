// 3.1F-I1 — static guarantees of the inactive commission/payroll ledger foundation.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

const root = process.cwd()
const SQL_PATH = "supabase/patch-employee-commission-payroll-ledger-foundation-3-1f-i1.sql"
const raw = readFileSync(join(root, SQL_PATH), "utf8")
const code = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .toLowerCase()

const NEW_TABLES = [
  "finance_audit_events",
  "employee_commission_rules",
  "employee_commission_entitlements",
  "employee_compensation_profiles",
  "employee_worked_days",
  "payroll_competences",
  "payroll_competence_lines",
]

test("migration is transactional", () => {
  assert.match(code, /^\s*begin;/m)
  assert.match(code, /^\s*commit;\s*$/m)
})

test("no cascade, no drop table, no truncate/delete of data", () => {
  assert.doesNotMatch(code, /cascade/)
  assert.doesNotMatch(code, /drop\s+table/)
  assert.doesNotMatch(code, /^\s*delete\s+from/m)
  assert.doesNotMatch(code, /^\s*truncate\s/m)
})

test("does not touch rewards, wallet, withdrawals or collections", () => {
  assert.doesNotMatch(code, /(alter|update|insert\s+into|delete\s+from)\s+(table\s+)?public\.(rewards|wallet_transactions|pix_withdrawal|withdrawal)/)
  assert.doesNotMatch(code, /public\.collection_/)
})

test("no seeded financial rows (no default rules, entitlements, payroll)", () => {
  for (const t of NEW_TABLES) {
    const inserts = code.match(new RegExp(`insert\\s+into\\s+public\\.${t}\\b`, "g")) ?? []
    // Only inside RPC bodies (each table has at most its owning RPC insert).
    assert.ok(inserts.length <= 2, `${t} inserts=${inserts.length}`)
  }
  assert.doesNotMatch(code, /insert\s+into\s+public\.employee_commission_entitlements/)
  assert.doesNotMatch(code, /insert\s+into\s+public\.employee_commission_rules[^;]*select/)
})

test("every new table has RLS and client grants revoked", () => {
  for (const t of NEW_TABLES) assert.match(code, new RegExp(`'${t}'`))
  assert.match(code, /enable row level security/)
  assert.match(code, /revoke all on table public\.%i from public, anon, authenticated, service_role/)
  assert.doesNotMatch(code, /create\s+policy/)
})

test("foundation gates present", () => {
  assert.match(code, /employee_commission_rules_foundation_inactive_chk check \(\s*active = false and status is distinct from 'active'/)
  assert.match(code, /employee_commission_rules_no_retroactive_chk check \(retroactive = false\)/)
  assert.match(code, /percentage_rate > 0 and percentage_rate <= 1\.00/)
  assert.match(code, /method = 'first_invoice_value' and trigger_kind = 'first_valid_invoice_fully_paid'/)
  assert.match(code, /raise exception 'financial_rules_inactive'/)
  assert.match(code, /payroll_competences_foundation_no_close_pay_chk/)
  assert.match(code, /employee_compensation_profiles_foundation_inactive_chk/)
})

test("percentage_base is free nullable text, no assumed ERP base enum", () => {
  assert.match(code, /percentage_base text,/)
  assert.doesNotMatch(code, /percentage_base\s+in\s*\(/)
  assert.doesNotMatch(code, /monthly_plan/)
})

test("forbidden RPCs are not implemented", () => {
  for (const f of [
    "activate_commission_rule",
    "evaluate_invoice_commission",
    "mark_entitlement_paid",
    "close_payroll",
    "pay_payroll",
    "cron.schedule",
    "net.http",
  ]) assert.ok(!code.includes(f), f)
})

test("security definer RPCs fix search_path and grant only authenticated", () => {
  const defs = code.match(/security definer\s+set search_path = ([^\n]+)/g) ?? []
  assert.ok(defs.length >= 9)
  for (const d of defs) assert.match(d, /set search_path = public, pg_temp/)
  assert.match(code, /revoke all on function %s from public, anon, authenticated, service_role/)
  assert.match(code, /grant execute on function %s to authenticated/)
})

test("attribution: existing one-per-role unique kept, proven role name reused", () => {
  assert.doesNotMatch(code, /drop constraint if exists sales_opportunity_attributions_role_uq/)
  assert.doesNotMatch(code, /'internal_responsible'/)
  assert.match(code, /'internal_sales_responsible'/)
})

test("invoice_pk is never used as temporal order", () => {
  assert.doesNotMatch(code, /order\s+by[^;]*invoice_pk/)
})
