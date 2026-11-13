import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { calculateCommission, percentageAmount } from "./calc"
import { isMethodActivatable, FINANCIAL_EVIDENCE_PAID, FIRST_INVOICE_ORDER_PROVEN, DAILY_SCHEDULER_ENABLED, PARTIAL_PAYMENT_DISTINGUISHED, distinguishPartialPayment } from "./evidence"
import { parsePayPayload, parseRuleActivatePayload, parseReconcilePayload } from "./contract"

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const SQL = read("supabase/patch-employee-commission-activation-3-1f-j6.sql")
const CODE = SQL.replace(/--[^\n]*/g, "")
const WRITE_RPCS = [
  "admin_approve_commission_rule",
  "admin_activate_commission_rule",
  "admin_approve_commission_entitlement",
  "admin_include_commission_in_payroll",
  "admin_reconcile_employee_commissions",
  "admin_register_payroll_payment",
  "admin_reverse_payroll_payment",
]
const FILES = [
  "lib/commission-activation/evidence.ts",
  "lib/commission-activation/calc.ts",
  "lib/commission-activation/contract.ts",
  "lib/commission-activation/handlers.ts",
  "lib/commission-activation/service.ts",
  "lib/commission-activation/client.ts",
  "app/admin/remuneracao/comissao/page.tsx",
  "app/api/admin/remuneracao/regras/publicar/route.ts",
  "app/api/admin/remuneracao/competencias/pagar/route.ts",
  "docs/employee-commission-daily-scheduler.md",
]

describe("3.1F-J6 migração", () => {
  it("transacional e reaplicável", () => {
    assert.match(SQL, /^begin;/m)
    assert.match(SQL, /^commit;\s*$/m)
  })
  it("não toca rewards/wallet/pix/cron", () => {
    assert.equal(/insert\s+into\s+public\.(rewards|wallet_transactions|payments)\b/i.test(CODE), false)
    assert.doesNotMatch(SQL, /pg_cron|vercel\.json|\/api\/cron/)
    assert.doesNotMatch(read("vercel.json"), /comissao|commission|payroll/)
  })
  it("RPCs: security definer, search_path, grants authenticated", () => {
    for (const fn of WRITE_RPCS) {
      const i = CODE.indexOf(`function public.${fn}(`)
      assert.ok(i > 0, fn)
      const body = CODE.slice(i, CODE.indexOf("$$;", CODE.indexOf("as $$", i)))
      assert.match(body, /security definer/, fn)
      assert.match(body, /set search_path = public, pg_temp/, fn)
      assert.match(body, /finance_admin_actor_role/, fn)
      assert.match(CODE, new RegExp(`revoke all on function public\\.${fn}\\(jsonb\\) from public, anon, authenticated, service_role;`))
      assert.match(CODE, new RegExp(`grant execute on function public\\.${fn}\\(jsonb\\) to authenticated;`))
    }
  })
  it("GATE 1 bloqueia as três modalidades; reconciliador não chama ERP", () => {
    assert.match(CODE, /commission_j6_method_activatable/)
    assert.match(CODE, /select false/)
    assert.match(CODE, /erp_requests integer not null default 0/)
    assert.match(CODE, /employee_commission_reconcile_runs_erp_zero_chk/)
    assert.doesNotMatch(CODE, /invoice\/list|oper\s*7|listContractInvoices/)
  })
  it("arquivos existem e frontend não usa service_role", () => {
    for (const f of FILES) assert.equal(existsSync(join(root, f)), true, f)
    const src = FILES.map((f) => read(f)).join("\n")
    assert.doesNotMatch(src, /service_role|SERVICE_ROLE|createServiceRoleClient/)
  })
})

describe("3.1F-J6 evidência e cálculo", () => {
  it("parcial distinto; scheduler off; ordem e pagamento ainda não comprovados", () => {
    assert.equal(isMethodActivatable("percentage"), false)
    assert.equal(isMethodActivatable("first_invoice_value"), false)
    assert.equal(FINANCIAL_EVIDENCE_PAID, false)
    assert.equal(FIRST_INVOICE_ORDER_PROVEN, false)
    assert.equal(PARTIAL_PAYMENT_DISTINGUISHED, true)
    assert.equal(DAILY_SCHEDULER_ENABLED, false)
    assert.equal(distinguishPartialPayment("100.00", "40.00").fullyPaid, false)
  })
  it("cálculo sem float: fixo, percentual round half away, primeira fatura = documento", () => {
    assert.deepEqual(calculateCommission({ method: "fixed_amount", fixedAmount: "30.00" }), { ok: true, amount: "30.00" })
    assert.equal(percentageAmount("0.25", "0.020000"), "0.01")
    assert.equal(percentageAmount("10.25", "0.500000"), "5.13")
    assert.deepEqual(calculateCommission({ method: "first_invoice_value", invoiceDocumentAmount: "199.90" }), { ok: true, amount: "199.90" })
    assert.equal(calculateCommission({ method: "percentage", percentageRate: "0.02" }).ok, false)
  })
  it("pagamento exige confirmação e motivo 20; reconciliação rejeita chave extra", () => {
    const pay = parsePayPayload({
      idempotencyKey: "abcdefghijklmnop",
      competenceId: "11111111-1111-4111-8111-111111111111",
      paidOn: "2026-11-13",
      method: "bank_transfer",
      reason: "Registro manual da competencia fechada.",
      confirmed: true,
    })
    assert.equal(pay.ok, true)
    const noConf = parsePayPayload({
      idempotencyKey: "abcdefghijklmnop",
      competenceId: "11111111-1111-4111-8111-111111111111",
      paidOn: "2026-11-13",
      method: "bank_transfer",
      reason: "Registro manual da competencia fechada.",
      confirmed: false,
    })
    assert.equal(noConf.ok, false)
    const act = parseRuleActivatePayload({
      idempotencyKey: "abcdefghijklmnop",
      ruleId: "11111111-1111-4111-8111-111111111111",
      reason: "curto",
    })
    assert.equal(act.ok, false)
    const rec = parseReconcilePayload({ idempotencyKey: "abcdefghijklmnop", erp: true })
    assert.equal(rec.ok, false)
  })
})
