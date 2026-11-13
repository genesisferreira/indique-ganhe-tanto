import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { periodEnd, parseApprovePayload, parseManualPayload, parseWorkedDaysPayload } from "./contract"

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const SQL = read("supabase/patch-employee-payroll-competence-3-1f-j5.sql")
const CODE = SQL.replace(/--[^\n]*/g, "")
const WRITE_RPCS = [
  "admin_approve_employee_compensation",
  "admin_save_employee_worked_days",
  "admin_open_payroll_competence",
  "admin_calculate_payroll_competence",
  "admin_review_payroll_competence",
  "admin_add_payroll_manual_line",
  "admin_close_payroll_competence",
  "admin_reopen_payroll_competence",
]
const LEGACY = [
  "create_commission_rule_draft",
  "version_commission_rule_draft",
  "configure_employee_compensation_draft",
  "record_employee_worked_day",
  "open_payroll_competence_draft",
  "add_manual_payroll_adjustment",
]
const FILES = [
  "lib/payroll-competence/contract.ts",
  "lib/payroll-competence/handlers.ts",
  "lib/payroll-competence/service.ts",
  "lib/payroll-competence/client.ts",
  "components/payroll-competence/worked-days-board.tsx",
  "components/payroll-competence/competence-board.tsx",
  "app/admin/remuneracao/dias-trabalhados/page.tsx",
  "app/admin/remuneracao/competencias/page.tsx",
  "app/api/admin/remuneracao/funcionarios/aprovar/route.ts",
  "app/api/admin/remuneracao/dias-trabalhados/route.ts",
  "app/api/admin/remuneracao/competencias/route.ts",
  "app/funcionario/remuneracao/page.tsx",
]

describe("3.1F-J5 migração", () => {
  it("transacional e reaplicável", () => {
    assert.match(SQL, /^begin;/m)
    assert.match(SQL, /^commit;\s*$/m)
  })
  it("não dropa tabela/coluna/função/policy; sem backfill de rewards/wallet", () => {
    assert.equal(/\bdrop\s+(table|column|function|policy|type)\b/i.test(CODE), false)
    assert.equal(/\bdelete\s+from\b|\btruncate\b/i.test(CODE), false)
    assert.equal(/insert\s+into\s+public\.(rewards|wallet_transactions|payments|referrals|employee_commission_entitlements|collection_\w+)\b/i.test(CODE), false)
  })
  it("RPCs novas: security definer, search_path, jsonb, grants authenticated", () => {
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
  it("RPCs I1 permanecem revogadas (sem regrant)", () => {
    for (const fn of LEGACY) {
      assert.match(CODE, new RegExp(`revoke all on function public\\.${fn}\\(`))
      assert.equal(new RegExp(`grant execute on function public\\.${fn}\\(`).test(CODE), false, fn)
    }
  })
  it("não ativa comissão, não paga, sem default 22", () => {
    assert.doesNotMatch(CODE, /set\s+status\s*=\s*'paid'|set\s+status\s*=\s*'active'|active\s*=\s*true/)
    assert.doesNotMatch(CODE, /\b22\.00\b/)
    assert.match(CODE, /payroll_competences_foundation_no_pay_chk/)
    assert.match(CODE, /status is distinct from 'paid'/)
  })
  it("arquivos da entrega existem e páginas são server-side", () => {
    for (const f of FILES) assert.equal(existsSync(join(root, f)), true, f)
    const days = read("app/admin/remuneracao/dias-trabalhados/page.tsx")
    const comps = read("app/admin/remuneracao/competencias/page.tsx")
    assert.match(days, /requireAdminRemuneracaoPage/)
    assert.match(comps, /requireAdminRemuneracaoPage/)
    assert.doesNotMatch(days, /createBrowserClient|getSession\(/)
    assert.doesNotMatch(comps, /createBrowserClient|getSession\(/)
  })
  it("frontend não usa service_role", () => {
    const src = FILES.map((f) => read(f)).join("\n")
    assert.doesNotMatch(src, /service_role|SERVICE_ROLE/)
  })
})

describe("3.1F-J5 contrato", () => {
  it("fevereiro comum e bissexto, virada dez/jan", () => {
    assert.equal(periodEnd("2023-02-01"), "2023-02-28")
    assert.equal(periodEnd("2024-02-01"), "2024-02-29")
    assert.equal(periodEnd("2025-12-01"), "2025-12-31")
    assert.equal(periodEnd("2026-01-01"), "2026-01-31")
  })
  it("aprovação e ajuste rejeitam chaves extras e motivo curto", () => {
    assert.equal(parseApprovePayload({ idempotencyKey: "abcdefghijklmnop", profileId: "11111111-1111-4111-8111-111111111111", active: true }).ok, false)
    const short = parseManualPayload({
      idempotencyKey: "abcdefghijklmnop",
      competenceId: "11111111-1111-4111-8111-111111111111",
      lineType: "discount",
      amount: "10.00",
      reason: "curto",
      visibleToEmployee: true,
    })
    assert.equal(short.ok, false)
    if (!short.ok) assert.equal(short.code, "reason_required")
  })
  it("dias fora do formato são rejeitados", () => {
    const r = parseWorkedDaysPayload({
      idempotencyKey: "abcdefghijklmnop",
      employeeId: "11111111-1111-4111-8111-111111111111",
      competenceMonth: "2026-01-15",
      days: [],
    })
    assert.equal(r.ok, false)
  })
})
