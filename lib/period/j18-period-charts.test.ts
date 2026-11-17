import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { FINANCE_CONFIRMATION, canHardDelete, classifyDeletion, type ReferralGateInput } from "@/lib/admin-deletion/contract"
import { pageWindow, referralPageQuery } from "@/lib/admin-lists/referral-page"
import { CHART_COLORS, chartTooltip, contrastRatio, pieSlices } from "@/lib/charts/theme"
import { currentMonthKey, monthBounds, parsePeriod, previousMonthKey, saoPauloMidnightUtc } from "@/lib/period/range"

const sql = readFileSync("supabase/patch-admin-master-cleanup-3-1f-j18.sql", "utf8")
const clean: ReferralGateInput = {
  rewards: 0, wallet: 0, payments: 0, withdrawals: 0, entitlements: 0, competences: 0,
  financialAttributions: 0, contractOrInvoice: 0, pendingFinancial: 0, financeAudit: 0, sharedDependency: 0,
  externalPayment: false, testRecord: true,
}

describe("3.1F-J18 período, paginação, purga e contraste", () => {
  it("abre no mês atual de São Paulo e cobre virada de mês e de ano", () => {
    const november = new Date("2026-11-17T15:00:00.000Z")
    assert.equal(currentMonthKey(november), "2026-11")
    assert.equal(previousMonthKey(november), "2026-10")
    const bounds = monthBounds("2026-11")
    assert.equal(bounds?.from.toISOString(), "2026-11-01T03:00:00.000Z")
    assert.equal(bounds?.to.toISOString(), "2026-12-01T03:00:00.000Z")
    assert.equal(saoPauloMidnightUtc(2026, 11, 1).toISOString() > "2026-11-01T02:59:00.000Z", true)
    const year = monthBounds("2026-12")
    assert.equal(year?.to.toISOString(), "2027-01-01T03:00:00.000Z")
    const parsed = parsePeriod(new URLSearchParams(), november)
    assert.equal(parsed.label, "2026-11")
    assert.equal(parsePeriod(new URLSearchParams("period=all"), november).from, null)
  })

  it("pagina no servidor e combina busca, status e período", () => {
    const query = referralPageQuery(new URLSearchParams("month=2026-11&page=2&pageSize=50&status=pendente&q=ana&origin=site"), new Date("2026-11-17T15:00:00.000Z"))
    assert.equal(query.page, 2)
    assert.equal(query.pageSize, 50)
    assert.equal(query.status, "pendente")
    assert.equal(query.search, "ana")
    assert.equal(query.from, "2026-11-01T03:00:00.000Z")
    assert.deepEqual(pageWindow(120, 2, 20), { from: 21, to: 40, pages: 6 })
    assert.equal(referralPageQuery(new URLSearchParams("pageSize=1000")).pageSize, 20)
  })

  it("classifica financeiro interno e protege pagamento externo", () => {
    assert.equal(classifyDeletion(clean), "TESTE_SEM_FINANCEIRO")
    assert.equal(classifyDeletion({ ...clean, rewards: 1, wallet: 1 }), "TESTE_COM_FINANCEIRO_INTERNO")
    assert.equal(canHardDelete({ ...clean, rewards: 1 }, "Cadastro sintético inválido e sem histórico financeiro.", FINANCE_CONFIRMATION), true)
    assert.equal(canHardDelete({ ...clean, rewards: 1 }, "Cadastro sintético inválido e sem histórico financeiro.", "ERRADO"), false)
    assert.equal(canHardDelete({ ...clean, externalPayment: true }, "Cadastro sintético inválido e sem histórico financeiro.", FINANCE_CONFIRMATION), false)
    assert.equal(classifyDeletion({ ...clean, testRecord: false }), "REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO")
  })

  it("recalcula o ledger e não apaga folha, entitlement ou Controllr", () => {
    assert.match(sql, /admin_recalculate_wallet_ledger/)
    assert.match(sql, /currentBalanceLabel', 'Saldo atual'/)
    assert.match(sql, /EXCLUIR HISTORICO FINANCEIRO DE TESTE/)
    assert.match(sql, /delete from public.rewards/)
    assert.match(sql, /delete from public.wallet_transactions/)
    assert.doesNotMatch(sql, /delete from public.employee_commission_entitlements/)
    assert.doesNotMatch(sql, /delete from public.partner_commission_entitlements/)
    assert.doesNotMatch(sql, /delete from public.payroll_competences/)
    assert.doesNotMatch(sql, /net\.http|erp\.tantotelecom|sync_execute|create_reward/i)
  })

  it("mantém contraste AA e omite rótulos de valor zero", () => {
    for (const color of CHART_COLORS) assert.equal(contrastRatio(color, "#0f172a") >= 3, true)
    assert.equal(contrastRatio(chartTooltip.contentStyle.color, chartTooltip.contentStyle.backgroundColor) >= 4.5, true)
    assert.equal(contrastRatio("#cbd5e1", "#0f172a") >= 4.5, true)
    assert.deepEqual(pieSlices([{ name: "Zero", value: 0 }, { name: "Um", value: 1 }]).map((row) => row.name), ["Um"])
    assert.equal(CHART_COLORS.includes("#000000" as never), false)
  })
})
