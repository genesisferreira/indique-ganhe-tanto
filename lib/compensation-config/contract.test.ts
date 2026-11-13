import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DRAFT_BANNERS,
  METHOD_TRIGGER,
  UI_SUGGESTION,
  fractionToPercentLabel,
  mapWriteResult,
  parseArchivePayload,
  parseMoneyInput,
  parseProfilePayload,
  parseRulePayload,
  percentToFraction,
  toEmployeeDetail,
  toEmployeePreview,
  toRulesList,
  todaySaoPaulo,
  newIdempotencyKey,
} from "@/lib/compensation-config/contract"

const KEY = "cc_0123456789abcdef0123456789abcdef"
const EMP = "11111111-2222-4333-8444-555555555555"
const rule = (o: Record<string, unknown> = {}) => ({ idempotencyKey: KEY, name: "Técnico", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "31.50", effectiveFrom: "2026-12-01", reason: "Configuração inicial", ...o })
const prof = (o: Record<string, unknown> = {}) => ({ idempotencyKey: KEY, employeeId: EMP, validFrom: "2026-12-01", reason: "Contratação", ...o })

describe("3.1F-J4 contrato: valores sem float", () => {
  it("dinheiro BR/US normalizado com 2 casas; zero/negativo/3 casas rejeitados", () => {
    assert.equal(parseMoneyInput("2.500,00"), "2500.00")
    assert.equal(parseMoneyInput("2500,5"), "2500.50")
    assert.equal(parseMoneyInput("R$ 22"), "22.00")
    assert.equal(parseMoneyInput("0012.30"), "12.30")
    for (const bad of ["", "0", "0,00", "-5", "10,005", "abc", "123456789"]) assert.equal(parseMoneyInput(bad), null, bad)
  })
  it("percentual -> fração exata (6 casas), sem arredondar", () => {
    assert.equal(percentToFraction("2"), "0.020000")
    assert.equal(percentToFraction("2,5"), "0.025000")
    assert.equal(percentToFraction("12.3456"), "0.123456")
    assert.equal(percentToFraction("100"), "1.000000")
    for (const bad of ["0", "12.34567", "100.0001", "150", "-1", "x"]) assert.equal(percentToFraction(bad), null, bad)
    assert.equal(fractionToPercentLabel("0.123456"), "12,3456%")
    assert.equal(fractionToPercentLabel("0.020000"), "2%")
    assert.equal(fractionToPercentLabel("1.000000"), "100%")
  })
  it("chave de idempotência e data de São Paulo", () => {
    assert.match(newIdempotencyKey(), /^cc_[0-9a-f]{32}$/)
    assert.equal(todaySaoPaulo(new Date("2026-11-14T02:30:00Z")), "2026-11-13")
  })
})

describe("3.1F-J4 contrato: regra", () => {
  it("valor fixo válido; gatilho nunca enviado (derivado)", () => {
    const r = parseRulePayload(rule())
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual(Object.keys(r.value).sort(), ["attributionRole", "effectiveFrom", "fixedAmount", "idempotencyKey", "method", "name", "reason"])
    assert.equal(METHOD_TRIGGER.first_invoice_value, "first_valid_invoice_fully_paid")
    assert.equal(METHOD_TRIGGER.fixed_amount, "first_valid_invoice_generated")
  })
  it("campos desconhecidos rejeitados (active/retroactive/trigger/status)", () => {
    for (const k of ["active", "retroactive", "triggerKind", "status", "sectorId"]) {
      const r = parseRulePayload({ ...rule(), [k]: true })
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.code, "unknown_field")
    }
  })
  it("motivo obrigatório, Vendedor Interno desabilitado, base percentual não comprovada", () => {
    const a = parseRulePayload(rule({ reason: " " })); assert.ok(!a.ok && a.code === "reason_required")
    const b = parseRulePayload(rule({ attributionRole: "internal_sales_responsible" })); assert.ok(!b.ok && b.code === "role_disabled")
    const c = parseRulePayload(rule({ method: "percentage", fixedAmount: undefined, percentageRate: "0.02", percentageBase: "monthly_plan" })); assert.ok(!c.ok && c.code === "percentage_base_not_proven")
  })
  it("percentual preserva precisão; > 6 casas rejeitado", () => {
    const ok = parseRulePayload(rule({ method: "percentage", fixedAmount: undefined, percentageRate: "0.123456" }))
    assert.ok(ok.ok && ok.value.percentageRate === "0.123456")
    const bad = parseRulePayload(rule({ method: "percentage", fixedAmount: undefined, percentageRate: "0.1234567" }))
    assert.ok(!bad.ok && bad.code === "invalid_percentage_rate")
  })
  it("primeira fatura sem valores; valor fixo com taxa rejeitado; período invertido rejeitado", () => {
    assert.ok(parseRulePayload(rule({ method: "first_invoice_value", fixedAmount: undefined })).ok)
    const a = parseRulePayload(rule({ method: "first_invoice_value" })); assert.ok(!a.ok && a.code === "invalid_method_values")
    const b = parseRulePayload(rule({ percentageRate: "0.01" })); assert.ok(!b.ok && b.code === "invalid_method_values")
    const c = parseRulePayload(rule({ effectiveUntil: "2026-11-30" })); assert.ok(!c.ok && c.code === "invalid_period")
  })
  it("nova versão dispensa papel (imutável); criação exige papel", () => {
    assert.ok(parseRulePayload(rule({ attributionRole: undefined, previousRuleId: EMP })).ok)
    const r = parseRulePayload(rule({ attributionRole: undefined })); assert.ok(!r.ok && r.code === "invalid_role")
  })
})

describe("3.1F-J4 contrato: remuneração individual", () => {
  it("todos os componentes opcionais; salário opcional; sem defaults", () => {
    const r = parseProfilePayload(prof())
    assert.ok(r.ok)
    if (r.ok) {
      assert.equal(r.value.salaryAmount, undefined)
      assert.equal(r.value.mealDailyAmount, undefined)
      assert.deepEqual([r.value.showSalary, r.value.showMeal, r.value.showTransport, r.value.showFuel], [false, false, false, false])
    }
  })
  it("visibilidade exige componente; forma exige valor e vice-versa", () => {
    const a = parseProfilePayload(prof({ showMeal: true })); assert.ok(!a.ok && a.code === "visibility_without_component")
    const b = parseProfilePayload(prof({ transportAmount: "10.00" })); assert.ok(!b.ok && b.code === "invalid_method")
    const c = parseProfilePayload(prof({ fuelMethod: "monthly_fixed" })); assert.ok(!c.ok && c.code === "invalid_method")
    assert.ok(parseProfilePayload(prof({ transportAmount: "180.00", transportMethod: "monthly_fixed", showTransport: true })).ok)
  })
  it("valor zero/negativo/float JSON rejeitado; campo desconhecido rejeitado", () => {
    for (const v of ["0.00", "-1.00", 10, "10.5"]) { const r = parseProfilePayload(prof({ salaryAmount: v })); assert.ok(!r.ok && r.code === "invalid_amount", String(v)) }
    const u = parseProfilePayload({ ...prof(), status: "active" }); assert.ok(!u.ok && u.code === "unknown_field")
  })
  it("arquivamento exige motivo e id", () => {
    assert.ok(parseArchivePayload({ idempotencyKey: KEY, ruleId: EMP, reason: "Não utilizado" }, "ruleId").ok)
    const r = parseArchivePayload({ idempotencyKey: KEY, ruleId: EMP }, "ruleId"); assert.ok(!r.ok && r.code === "reason_required")
    const x = parseArchivePayload({ idempotencyKey: KEY, profileId: EMP, reason: "abc", extra: 1 }, "profileId"); assert.ok(!x.ok && x.code === "unknown_field")
  })
})

describe("3.1F-J4 contrato: respostas", () => {
  it("escrita: resposta fechada sem valores; conflitos => 409; consulta => 403", () => {
    const ok = mapWriteResult({ ok: true, idempotent: false, ruleId: EMP, version: 2, status: "draft", fixedAmount: "31.50" })
    assert.equal(ok.status, 201)
    assert.equal("fixedAmount" in ok.body, false)
    assert.equal(mapWriteResult({ ok: true, idempotent: true, ruleId: EMP }).status, 200)
    for (const code of ["idempotency_conflict", "stale_version", "overlapping_rule"]) assert.equal(mapWriteResult({ ok: false, code }).status, 409)
    assert.equal(mapWriteResult({ ok: false, code: "forbidden" }).status, 403)
    assert.equal(mapWriteResult({ ok: false, code: "retroactive_forbidden" }).status, 422)
    assert.equal(mapWriteResult({ ok: false, code: "weird" }).status, 503)
    assert.equal(mapWriteResult(null).status, 503)
  })
  it("prévia: componente ausente/inválido OMITIDO (nunca zero); total só se mensal", () => {
    const p = toEmployeePreview({ competenceMonth: "2026-11-01", configured: true, components: { salary: { amount: "2500.00" }, meal: { dailyAmount: null }, fuel: { amount: "0.00", method: "monthly_fixed" } }, commission: { status: "not_calculated" }, estimatedTotal: "2500.00" })
    assert.ok(p)
    assert.deepEqual(Object.keys(p!.components), ["salary"])
    assert.equal(p!.estimatedTotal, "2500.00")
    const e = toEmployeePreview({ competenceMonth: "2026-11-01", configured: false, components: {}, commission: null, estimatedTotal: null })
    assert.deepEqual(e!.components, {})
    assert.equal(e!.estimatedTotal, null)
    assert.equal(e!.commission, null)
    assert.equal(toEmployeePreview({}), null)
  })
  it("regras agrupadas por família, versão mais recente primeiro", () => {
    const fam = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    const r = (id: string, version: number, status: string) => ({ id, familyId: fam, version, attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "31.50", effectiveFrom: "2026-12-01", status, createdAt: "2026-11-13T12:00:00Z" })
    const l = toRulesList({ rules: [r(EMP, 1, "superseded"), r("99999999-2222-4333-8444-555555555555", 2, "draft")], activeRuleCount: 0 })
    assert.equal(l.families.length, 1)
    assert.equal(l.families[0].current.version, 2)
    assert.equal(l.activeRuleCount, 0)
  })
  it("detalhe: rascunho vigente = versão draft; setores mapeados para função", () => {
    const d = toEmployeeDetail({ employee: { employeeId: EMP, name: "Ana", status: "active", sectors: [{ code: "technician", name: "Técnico" }] }, versions: [{ profileId: EMP, version: 1, status: "draft", validFrom: "2026-12-01" }] })
    assert.equal(d!.current!.version, 1)
    assert.deepEqual(d!.employee.roles, ["technician_originator"])
  })
  it("sugestões são constantes de UI e avisos fixos presentes", () => {
    assert.equal(UI_SUGGESTION.mealDaily, "22.00")
    assert.deepEqual([...DRAFT_BANNERS], ["Configuração em rascunho", "Nenhuma regra financeira está ativa", "Nenhuma comissão será calculada nesta etapa"])
  })
})
