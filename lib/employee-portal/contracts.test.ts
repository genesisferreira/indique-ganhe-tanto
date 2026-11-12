import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  classifyRpcError,
  competenceToParam,
  money,
  parseCompensationListQuery,
  parseCompetenceParam,
  parseOpportunityId,
  parseSalesQuery,
  PORTAL_ERROR_STATUS,
  toCompensationSummaryResponse,
  toCompetenceDetailResponse,
  toDashboardResponse,
  toSaleDetailResponse,
  toSalesListResponse,
} from "@/lib/employee-portal/contracts"

const qs = (s: string) => new URLSearchParams(s)

describe("3.1F-J2 query validation (F)", () => {
  it("defaults", () => {
    const r = parseSalesQuery(qs(""))
    assert.equal(r.ok, true)
    if (r.ok) assert.deepEqual(r.value, { limit: 20, offset: 0, sort: "created_desc", from: null, to: null, stage: null, status: null, commission: null })
  })
  it("page -> offset; filtros allowlist", () => {
    const r = parseSalesQuery(qs("limit=10&page=3&sort=updated_desc&stage=negociacao&status=em_andamento&commission=pending_evidence&from=2026-01-01&to=2026-01-31"))
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.value.offset, 20)
      assert.equal(r.value.sort, "updated_desc")
      assert.equal(r.value.stage, "negociacao")
    }
  })
  for (const bad of ["limit=0", "limit=51", "limit=-1", "limit=1e3", "offset=10001", "sort=referred_phone", "sort=created_desc;drop", "stage=x", "status=PAGA", "commission=available", "from=2026-02-30", "from=2026-1-1", "from=2026-03-01&to=2026-02-01", "from=1999-01-01", "page=0"]) {
    it(`rejeita ${bad}`, () => assert.equal(parseSalesQuery(qs(bad)).ok, false))
  }
  for (const k of ["employee_id", "employeeId", "profile_id", "profileId", "user_id", "uid"]) {
    it(`nunca aceita identidade do cliente: ${k}`, () => {
      assert.equal(parseSalesQuery(qs(`${k}=x`)).ok, false)
      assert.equal(parseCompensationListQuery(qs(`${k}=x`)).ok, false)
    })
  }
  it("strict rejeita parâmetro desconhecido", () => {
    assert.equal(parseSalesQuery(qs("foo=1"), { strict: true }).ok, false)
    assert.equal(parseSalesQuery(qs("foo=1")).ok, true)
  })
  it("id de oportunidade somente UUID", () => {
    assert.equal(parseOpportunityId("not-a-uuid"), null)
    assert.equal(parseOpportunityId("' or 1=1 --"), null)
    assert.equal(parseOpportunityId("00000000-0000-4000-8000-000000000999"), "00000000-0000-4000-8000-000000000999")
  })
  it("competência YYYY-MM", () => {
    assert.equal(parseCompetenceParam("2026-11"), "2026-11-01")
    assert.equal(parseCompetenceParam("2026-13"), null)
    assert.equal(parseCompetenceParam("2026-11-01"), null)
    assert.equal(parseCompetenceParam("1999-01"), null)
    assert.equal(competenceToParam("2026-11-01"), "2026-11")
  })
  it("paginação de competências limitada", () => {
    assert.equal(parseCompensationListQuery(qs("limit=25")).ok, false)
    assert.equal(parseCompensationListQuery(qs("limit=24")).ok, true)
  })
})

describe("3.1F-J2 contratos fechados", () => {
  it("dashboard descarta chaves extras e mantém zeros reais", () => {
    const r = toDashboardResponse({ competenceMonth: "2026-11-01", employeeStatus: "active", readOnly: false, opportunitiesInMonth: 0, salesInProgress: 0, provenConversions: 0, commissionsAwaitingEvidence: 0, commissionAccruedInCompetence: 0, currentCompetence: null, recent: [], salary: 999, employee_id: "x" })
    assert.deepEqual(Object.keys(r).sort(), ["commissionAccruedInCompetence", "commissionsAwaitingEvidence", "competenceMonth", "currentCompetence", "employeeStatus", "opportunitiesInMonth", "provenConversions", "readOnly", "recent", "salesInProgress"])
    assert.equal(r.commissionAccruedInCompetence, "0.00")
    assert.equal(r.currentCompetence, null)
  })
  it("lista de vendas: somente campos sanitizados", () => {
    const r = toSalesListResponse({ items: [{ id: "i", reference: "R", createdAt: "c", interested: "Fulano S.", plan: "P", stage: "novo", status: "pendente", role: "technician_originator", commissionStatus: "weird", updatedAt: "u", referred_phone: "1199", brbyte_contract_pk: "1", notes: "x" }], total: 1, limit: 20, offset: 0, sort: "created_desc" })
    assert.deepEqual(Object.keys(r.items[0]).sort(), ["commissionStatus", "createdAt", "id", "interested", "plan", "reference", "role", "stage", "status", "updatedAt"])
    assert.equal(r.items[0].commissionStatus, "none")
  })
  it("detalhe: timeline sem notas/autor; comissão sem contract/invoice", () => {
    const r = toSaleDetailResponse({ id: "i", timeline: [{ at: "a", from: "pendente", to: "em_andamento", action_note: "segredo", actor: "x" }], commissions: [{ status: "pending_evidence", competenceMonth: null, amount: null, triggering_invoice_pk: "1" }] })
    assert.deepEqual(Object.keys(r.timeline[0]).sort(), ["at", "from", "to"])
    assert.deepEqual(Object.keys(r.commissions[0]).sort(), ["competenceMonth", "status"])
    assert.equal(JSON.stringify(r).includes("segredo"), false)
  })
  it("perfil: componente oculto/desabilitado é OMITIDO (nunca zero)", () => {
    const r = toCompensationSummaryResponse({ employeeStatus: "active", readOnly: false, profile: { validFrom: "2026-01-01", meal: { dailyAmount: "22.00" } }, competences: [], total: 0, limit: 12, offset: 0 })
    assert.ok(r.profile)
    assert.equal("salary" in (r.profile ?? {}), false)
    assert.equal("transport" in (r.profile ?? {}), false)
    assert.equal("fuel" in (r.profile ?? {}), false)
    assert.equal(r.profile?.meal?.dailyAmount, "22.00")
    assert.equal(toCompensationSummaryResponse({ profile: null }).profile, null)
  })
  it("competência: somente componentes presentes; chaves desconhecidas descartadas", () => {
    const r = toCompetenceDetailResponse({ competenceMonth: "2026-11-01", status: "draft", version: 1, components: { commission: "30.00", meal: 22, base_salary: "4321.09", hidden: 1 }, total: { kind: "expected", amount: "52.00" }, lines: [] })
    assert.deepEqual(Object.keys(r.components).sort(), ["commission", "meal"])
    assert.equal(JSON.stringify(r).includes("4321"), false)
    assert.equal(r.total.kind, "expected")
  })
  it("dinheiro como string decimal; lixo vira 0.00", () => {
    assert.equal(money("12.5"), "12.50")
    assert.equal(money(7), "7.00")
    assert.equal(money("-5"), "-5.00")
    assert.equal(money("abc"), "0.00")
  })
})

describe("3.1F-J2 erros sanitizados", () => {
  it("mapeia mensagens estáveis para status", () => {
    assert.equal(PORTAL_ERROR_STATUS[classifyRpcError({ message: "employee_portal_unauthenticated" })], 401)
    assert.equal(PORTAL_ERROR_STATUS[classifyRpcError({ message: "employee_portal_forbidden" })], 403)
    assert.equal(PORTAL_ERROR_STATUS[classifyRpcError({ message: "employee_portal_not_found" })], 404)
    assert.equal(PORTAL_ERROR_STATUS[classifyRpcError({ message: "employee_portal_invalid_parameter" })], 400)
    assert.equal(PORTAL_ERROR_STATUS[classifyRpcError({ message: "permission denied for function", code: "42501" })], 403)
    assert.equal(PORTAL_ERROR_STATUS[classifyRpcError({ message: "connection reset" })], 503)
  })
})
