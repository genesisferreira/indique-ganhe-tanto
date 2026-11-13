import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  DAILY_SCHEDULER_ENABLED,
  FINANCIAL_EVIDENCE_GENERATED,
  FINANCIAL_EVIDENCE_PAID,
  FIRST_INVOICE_ORDER_PROVEN,
  FIXED_AMOUNT_ACTIVATABLE_COPY,
  isMethodActivatable,
  METHOD_BLOCK_REASON,
} from "./evidence"
import { FIRST_INVOICE_NOT_ACTIVATABLE, PERCENTAGE_BASE_UNPROVEN } from "../compensation-config/contract"

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const SQL = read("supabase/patch-employee-fixed-commission-activation-3-1f-j7.sql")
const CODE = SQL.replace(/--[^\n]*/g, "")
const FILES = [
  "lib/commission-activation/evidence.ts",
  "components/compensation-config/rules-configurator.tsx",
  "supabase/patch-employee-fixed-commission-activation-3-1f-j7.sql",
  "supabase/preflight-employee-fixed-commission-activation-3-1f-j7.sql",
  "supabase/verify-employee-fixed-commission-activation-3-1f-j7.sql",
  "scripts/j7-fixed-commission-lab.mjs",
  "docs/employee-commission-daily-scheduler.md",
]

describe("3.1F-J7 migração", () => {
  it("transacional, reaplicável, sem rewards/wallet/cron/invoice-list", () => {
    assert.match(SQL, /^begin;/m)
    assert.match(SQL, /^commit;\s*$/m)
    assert.equal(/insert\s+into\s+public\.(rewards|wallet_transactions|payments)\b/i.test(CODE), false)
    assert.doesNotMatch(SQL, /pg_cron|vercel\.json|\/api\/cron/)
    assert.doesNotMatch(CODE, /invoice\/list|oper\s*7|listContractInvoices/)
    assert.doesNotMatch(read("vercel.json"), /comissao|commission|payroll/)
    assert.doesNotMatch(read("docs/employee-commission-daily-scheduler.md"), /DAILY_SCHEDULER=ENABLED/)
  })
  it("gate SQL: só fixed_amount; percentage e first_invoice_value recusadas", () => {
    assert.match(CODE, /select p_method = 'fixed_amount'/)
    assert.match(CODE, /when 'percentage' then 'percentage_base_not_proven'/)
    assert.match(CODE, /when 'first_invoice_value' then 'full_payment_unproven'/)
    assert.match(CODE, /commission_j7_employee_invoice_evidence/)
    assert.match(CODE, /origin_kind = 'employee'/)
    assert.match(CODE, /brbyte_first_invoice_pk/)
    assert.match(CODE, /invoice_deleted/)
    assert.doesNotMatch(CODE, /document_amount|invoice_amount_paid|paid_amount/)
  })
  it("reconciliador: entitlement único, valor da regra, sem valor da fatura, erp 0", () => {
    const i = CODE.indexOf("function public.admin_reconcile_employee_commissions(")
    assert.ok(i > 0)
    const body = CODE.slice(i, CODE.indexOf("$$;", CODE.indexOf("as $$", i)))
    assert.match(body, /security definer/)
    assert.match(body, /set search_path = public, pg_temp/)
    assert.match(body, /finance_admin_actor_role/)
    assert.match(body, /method = 'fixed_amount'/)
    assert.match(body, /unique_violation/)
    assert.match(body, /erpRequests', 0/)
    assert.match(body, /evidenceKind', 'crm_persisted'/)
    assert.doesNotMatch(body, /documentAmount|paidAmount/)
    assert.match(SQL, /grant execute on function public\.admin_reconcile_employee_commissions\(jsonb\) to authenticated;/)
    assert.match(SQL, /revoke all on function public\.commission_j7_employee_invoice_evidence\(uuid\) from public, anon, authenticated, service_role;/)
  })
  it("arquivos existem e frontend não usa service_role", () => {
    for (const f of FILES) assert.equal(existsSync(join(root, f)), true, f)
    const src = FILES.filter((f) => /\.(ts|tsx|mjs)$/.test(f)).map((f) => read(f)).join("\n")
    assert.doesNotMatch(src, /createServiceRoleClient|SERVICE_ROLE_KEY/)
  })
})

describe("3.1F-J7 evidência e UI", () => {
  it("fixed_amount ativável; percentage e first_invoice_value bloqueadas; scheduler off", () => {
    assert.equal(FINANCIAL_EVIDENCE_GENERATED, true)
    assert.equal(isMethodActivatable("fixed_amount"), true)
    assert.equal(isMethodActivatable("percentage"), false)
    assert.equal(isMethodActivatable("first_invoice_value"), false)
    assert.equal(FINANCIAL_EVIDENCE_PAID, false)
    assert.equal(FIRST_INVOICE_ORDER_PROVEN, false)
    assert.equal(DAILY_SCHEDULER_ENABLED, false)
    assert.equal(FIXED_AMOUNT_ACTIVATABLE_COPY, "Comissão fixa liberada por evidência de fatura gerada.")
    assert.equal(METHOD_BLOCK_REASON.percentage, "Bloqueada: base percentual não comprovada.")
    assert.equal(METHOD_BLOCK_REASON.first_invoice_value, "Bloqueada: pagamento integral e ordem não comprovados.")
    assert.equal(PERCENTAGE_BASE_UNPROVEN, METHOD_BLOCK_REASON.percentage)
    assert.equal(FIRST_INVOICE_NOT_ACTIVATABLE, METHOD_BLOCK_REASON.first_invoice_value)
  })
  it("botão Ativar só para regra fixa; textos de bloqueio visíveis", () => {
    const ui = read("components/compensation-config/rules-configurator.tsx")
    assert.match(ui, /canActivate = isMethodActivatable\(cur\.method\)/)
    assert.match(ui, /cur\.status === "approved" && canActivate/)
    assert.match(ui, /FIXED_AMOUNT_ACTIVATABLE_COPY/)
    assert.match(ui, /PERCENTAGE_BASE_UNPROVEN/)
    assert.match(ui, /FIRST_INVOICE_NOT_ACTIVATABLE/)
    assert.match(ui, /ActivateDisabled/)
    assert.match(ui, />Ativar</)
  })
})
