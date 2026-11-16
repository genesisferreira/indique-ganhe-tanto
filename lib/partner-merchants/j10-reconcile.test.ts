import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const sql = readFileSync("supabase/patch-partner-fixed-commission-reconcile-3-1f-j10.sql", "utf8")
const route = readFileSync("app/api/admin/parceiros/[id]/reconciliar/route.ts", "utf8")

describe("3.1F-J10 partner fixed reconcile", () => {
  it("só libera a comissão fixa pela reconciliação e mantém o bloqueio direto", () => {
    assert.match(sql, /^begin;/m)
    assert.match(sql, /^commit;\s*$/m)
    assert.match(sql, /partner_entitlements_withheld_this_release/)
    assert.match(sql, /function public\.admin_reconcile_partner_commissions/)
    assert.match(sql, /partner_invoice_generated_evidence/)
    assert.match(sql, /kind = 'fixed_amount'/)
    assert.match(sql, /erpRequests', 0/)
    assert.match(sql, /revoke all on function public\.admin_reconcile_partner_commissions\(jsonb\) from public, anon, authenticated, service_role/)
    assert.doesNotMatch(sql, /grant execute on function public\.admin_reconcile_partner_commissions\(jsonb\) to service_role/)
    assert.doesNotMatch(sql, /admin_reconcile_employee_commissions|commission_j6_method_activatable|net\.http|brbyte_sync/)
    assert.equal(/\bdrop\s+table\b|\btruncate\b/i.test(sql.replace(/--[^\n]*/g, "")), false)
  })
  it("a rota usa a sessão e não a service role", () => {
    assert.match(route, /admin_reconcile_partner_commissions/)
    assert.doesNotMatch(route, /service_role|createServiceRoleClient/)
  })
})
