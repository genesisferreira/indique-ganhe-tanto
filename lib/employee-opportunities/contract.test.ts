import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  OPPORTUNITY_PAYLOAD_KEYS,
  SUBMIT_ERROR_CODES,
  SUBMIT_ERROR_STATUS,
  errorOutcome,
  isValidCnpjDigits,
  isValidCpfDigits,
  mapSubmitResult,
  newIdempotencyKey,
  normalizeOpportunityPhone,
  parseOpportunityPayload,
  toFormContext,
  toRpcPayload,
} from "@/lib/employee-opportunities/contract"
import { normalizeReferralPhone } from "@/lib/referral-field-normalize"

const PLAN = "0b3c1f7e-5d2a-4c1b-9e8f-1a2b3c4d5e6f"
const OPP = "11111111-2222-4333-8444-555555555555"
const valid = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: "eo_0123456789abcdef0123", planId: PLAN, name: "  Maria   da Silva ", phone: "+55 (31) 99876-0001",
  zipcode: "30.140-071", street: "Rua A", number: "10", neighborhood: "Centro", city: "Belo Horizonte", consent: true, ...over,
})

describe("3.1F-J3 contrato: normalização e validação", () => {
  it("payload válido é normalizado", () => {
    const r = parseOpportunityPayload(valid({ document: "529.982.247-25", complement: " ", observation: "  ok  " }))
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.name, "Maria da Silva")
    assert.equal(r.value.phone, "31998760001")
    assert.equal(r.value.zipcode, "30140071")
    assert.equal(r.value.document, "52998224725")
    assert.equal(r.value.complement, null)
    assert.equal(r.value.observation, "ok")
    assert.equal(r.value.attributionRole, null)
    assert.equal(r.value.confirmRecentDuplicate, false)
  })
  it("telefone: mesmo algoritmo do normalizador do Indique e Ganhe (e da função SQL)", () => {
    for (const raw of ["+55 (31) 99876-0001", "31998760001", "3132220000", "553132220000", "0031998760001", "12345678", "123"]) {
      const ref = normalizeReferralPhone(raw)
      const mine = normalizeOpportunityPhone(raw)
      if (mine !== null) assert.equal(mine, ref, raw)
      else assert.ok(ref === null || ref.length < 10, raw)
    }
  })
  it("CPF/CNPJ com dígitos verificadores", () => {
    assert.equal(isValidCpfDigits("52998224725"), true)
    assert.equal(isValidCpfDigits("52998224724"), false)
    assert.equal(isValidCpfDigits("11111111111"), false)
    assert.equal(isValidCnpjDigits("11222333000181"), true)
    assert.equal(isValidCnpjDigits("11222333000180"), false)
    assert.equal(parseOpportunityPayload(valid({ document: "11.222.333/0001-81" })).ok, true)
  })
  const bad: Array<[string, Record<string, unknown>, string, string?]> = [
    ["employeeId", { employeeId: "x" }, "unknown_field"],
    ["profileId", { profileId: "x" }, "unknown_field"],
    ["sectorId", { sectorId: "x" }, "unknown_field"],
    ["commission", { commissionAmount: 10 }, "unknown_field"],
    ["rewardEligible", { rewardEligible: true }, "unknown_field"],
    ["originKind", { originKind: "indicator" }, "unknown_field"],
    ["indicatorProfileId", { indicatorProfileId: "x" }, "unknown_field"],
    ["chave curta", { idempotencyKey: "abc" }, "invalid_payload", "idempotencyKey"],
    ["chave com espaço", { idempotencyKey: "abc def ghi jkl mno p" }, "invalid_payload", "idempotencyKey"],
    ["papel arbitrário", { attributionRole: "internal_sales_responsible" }, "invalid_payload", "attributionRole"],
    ["papel admin", { attributionRole: "admin_master" }, "invalid_payload", "attributionRole"],
    ["plano não-uuid", { planId: "1" }, "invalid_payload", "planId"],
    ["nome curto", { name: "Al" }, "invalid_payload", "name"],
    ["nome número", { name: 123 }, "invalid_payload", "name"],
    ["telefone curto", { phone: "9999-999" }, "invalid_payload", "phone"],
    ["documento inválido", { document: "123.456.789-00" }, "invalid_payload", "document"],
    ["CEP curto", { zipcode: "3014" }, "invalid_payload", "zipcode"],
    ["CEP com letras", { zipcode: "30140O71x" }, "invalid_payload", "zipcode"],
    ["sem endereço", { street: "" }, "invalid_payload", "street"],
    ["sem número", { number: "  " }, "invalid_payload", "number"],
    ["sem bairro", { neighborhood: undefined }, "invalid_payload", "neighborhood"],
    ["sem cidade", { city: null }, "invalid_payload", "city"],
    ["observação longa", { observation: "x".repeat(501) }, "invalid_payload", "observation"],
    ["sem consentimento", { consent: false }, "invalid_payload", "consent"],
    ["consentimento string", { consent: "true" }, "invalid_payload", "consent"],
    ["confirm não-bool", { confirmRecentDuplicate: "yes" }, "invalid_payload"],
  ]
  for (const [n, over, code, field] of bad) {
    it(`rejeita: ${n}`, () => {
      const r = parseOpportunityPayload(valid(over))
      assert.equal(r.ok, false)
      if (r.ok) return
      assert.equal(r.code, code)
      if (field) assert.equal(r.field, field)
    })
  }
  it("rejeita corpo não-objeto", () => {
    for (const b of [null, [], "x", 1]) assert.equal(parseOpportunityPayload(b).ok, false)
  })
  it("toRpcPayload envia somente chaves allowlisted e omite opcionais vazias", () => {
    const r = parseOpportunityPayload(valid({ attributionRole: "external_sales_originator", confirmRecentDuplicate: true }))
    assert.ok(r.ok)
    if (!r.ok) return
    const p = toRpcPayload(r.value)
    for (const k of Object.keys(p)) assert.ok((OPPORTUNITY_PAYLOAD_KEYS as readonly string[]).includes(k), k)
    assert.equal("document" in p, false)
    assert.equal("complement" in p, false)
    assert.equal(p.attributionRole, "external_sales_originator")
    assert.equal(p.confirmRecentDuplicate, true)
  })
})

describe("3.1F-J3 contrato: resultado da RPC -> HTTP", () => {
  it("sucesso 201; replay 200; resposta fechada", () => {
    const ok = mapSubmitResult({ ok: true, idempotent: false, opportunityId: OPP, protocol: "11111111", attributionRole: "technician_originator", stage: "novo", referred_phone: "31999", indicator_profile_id: null })
    assert.equal(ok.status, 201)
    assert.deepEqual(Object.keys(ok.body).sort(), ["attributionRole", "idempotent", "ok", "opportunityId", "protocol", "stage"])
    assert.equal(mapSubmitResult({ ok: true, idempotent: true, opportunityId: OPP, protocol: "11111111", attributionRole: "external_sales_originator", stage: "novo" }).status, 200)
  })
  it("formato inesperado => 503 fechado", () => {
    for (const raw of [null, "x", { ok: true }, { ok: true, opportunityId: OPP, protocol: "zz", attributionRole: "technician_originator", stage: "novo" }, { ok: true, opportunityId: OPP, protocol: "11111111", attributionRole: "internal_sales_responsible", stage: "novo" }, { ok: false, code: "weird" }]) {
      assert.equal(mapSubmitResult(raw).status, 503, JSON.stringify(raw))
    }
  })
  it("mapa de status", () => {
    const expect: Record<string, number> = {
      unauthenticated: 401, forbidden: 403, employee_not_active: 403, no_eligible_role: 403, role_not_eligible: 403,
      role_choice_required: 422, invalid_payload: 400, unknown_field: 400, invalid_idempotency_key: 400, consent_required: 400,
      idempotency_conflict: 409, duplicate_open: 409, duplicate_recent_closed: 409, unavailable: 503,
    }
    assert.deepEqual(SUBMIT_ERROR_STATUS, expect)
    for (const c of SUBMIT_ERROR_CODES) assert.equal(mapSubmitResult({ ok: false, code: c }).status, expect[c])
  })
  it("duplicidade recente exige confirmação; aberta não revela o outro cadastro", () => {
    assert.equal(mapSubmitResult({ ok: false, code: "duplicate_recent_closed", requiresConfirmation: true }).body.requiresConfirmation, true)
    const open = mapSubmitResult({ ok: false, code: "duplicate_open", opportunityId: OPP, name: "X" })
    assert.deepEqual(Object.keys(open.body).sort(), ["code", "message", "ok"])
  })
  it("campo inválido só é repassado se for chave conhecida", () => {
    assert.equal(errorOutcome("invalid_payload", "phone").body.field, "phone")
    assert.equal(errorOutcome("invalid_payload", "referred_phone").body.field, undefined)
  })
  it("mensagens não citam recompensa/carteira/saque", () => {
    for (const c of SUBMIT_ERROR_CODES) assert.equal(/carteira|saque|pix|saldo/i.test(String(errorOutcome(c).body.message)), false, c)
  })
})

describe("3.1F-J3 contrato: contexto do formulário e chave", () => {
  it("contexto fechado; papéis fora da allowlist descartados", () => {
    const c = toFormContext({ employeeStatus: "active", canCreate: true, eligibleRoles: ["technician_originator", "internal_sales_responsible", "x"], roleChoiceRequired: true, plans: [{ id: PLAN, name: "P", price: 1 }, { id: "bad", name: "Q" }] })
    assert.deepEqual(c, { employeeStatus: "active", canCreate: true, eligibleRoles: ["technician_originator"], roleChoiceRequired: false, plans: [{ id: PLAN, name: "P" }] })
    assert.equal(toFormContext({ canCreate: true, eligibleRoles: [] })?.canCreate, false)
    assert.equal(toFormContext({ canCreate: true, eligibleRoles: ["technician_originator", "external_sales_originator"] })?.roleChoiceRequired, true)
    assert.equal(toFormContext(null), null)
  })
  it("chave de idempotência compatível com a RPC e única por chamada", () => {
    const a = newIdempotencyKey(), b = newIdempotencyKey()
    assert.match(a, /^[A-Za-z0-9_-]{16,128}$/)
    assert.notEqual(a, b)
  })
})
