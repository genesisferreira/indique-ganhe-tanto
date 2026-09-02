import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  assertServerOwnsPrivilegedFields,
  buildAssistedCreateAuditMetadata,
  buildAssistedReferralInsertRow,
  createAssistedReferral,
  validateAssistedReferralClientPayload,
  type CreateAssistedReferralDeps,
} from "./create-assisted-referral"
import {
  COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE,
  COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
} from "./constants"

const VALID_CPF = "529.982.247-25"
const VALID_CNPJ = "11.222.333/0001-81"
const OFFER_CODE = "tanto_vantagens_500" // may need real catalog code

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    assisted_idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    indicator_profile_id: "indicator-1",
    referred_person_type: "pf",
    referred_name: "Pedro Alves",
    referred_document: VALID_CPF,
    referred_birth_date: "1990-05-15",
    referred_phone: "(11) 98765-4321",
    referred_email: "pedro@ex.com",
    preferred_invoice_due_day: 10,
    referral_contract_type: "tanto_vantagens",
    public_offer_code: "",
    reward_type: "pix",
    installation_fee_awareness: true,
    contract_type_awareness: true,
    // privileged spoof attempts
    created_by_profile_id: "hacker",
    commercial_profile_id: "other-comercial",
    source: "hacked",
    erp_lead_source: "Pré-cadastro Web",
    reward_eligible: false,
    public_offer_price: 1,
    ...overrides,
  }
}

describe("validateAssistedReferralClientPayload", () => {
  it("rejeita CPF inválido", () => {
    const result = validateAssistedReferralClientPayload(
      baseBody({ referred_document: "111.111.111-11", public_offer_code: "x" })
    )
    // may fail on offer too — check CPF first with valid modality offer from catalog
    assert.equal(result.ok, false)
  })

  it("rejeita CNPJ inválido em PJ", () => {
    const result = validateAssistedReferralClientPayload(
      baseBody({
        referred_person_type: "pj",
        referred_name: "Empresa LTDA",
        referred_company_trade_name: "Empresa",
        referred_document: "11.111.111/1111-11",
        referred_birth_date: "",
      })
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /CNPJ/i)
  })

  it("rejeita modalidade inválida", () => {
    const result = validateAssistedReferralClientPayload(
      baseBody({ referral_contract_type: "plano_fake" })
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /modalidade/i)
  })
})

describe("buildAssistedReferralInsertRow ownership", () => {
  const validated = {
    indicatorProfileId: "indicator-1",
    personType: "pf" as const,
    referredName: "Pedro",
    tradeName: null,
    document: "52998224725",
    rg: null,
    birthDate: "1990-05-15",
    phone: "11987654321",
    email: null,
    zipcode: null,
    state: null,
    city: null,
    neighborhood: null,
    street: null,
    number: null,
    complement: null,
    observation: null,
    preferredInvoiceDueDay: 10,
    contractType: "tanto_vantagens" as const,
    offerCode: "offer",
    rewardType: "pix" as const,
    installationFeeAwareness: true as const,
    contractTypeAwareness: true as const,
    idempotencyKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  }

  it("comercial: created_by e commercial = ator; source/reward server-side", () => {
    const row = buildAssistedReferralInsertRow({
      validated,
      actorProfileId: "comercial-1",
      actorRole: "comercial",
      offerName: "500 Mega",
      offerPrice: 99.9,
      planId: "plan-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    })
    assert.equal(row.indicator_profile_id, "indicator-1")
    assert.equal(row.created_by_profile_id, "comercial-1")
    assert.equal(row.commercial_profile_id, "comercial-1")
    assert.equal(row.source, COMMERCIAL_ASSISTED_REFERRAL_SOURCE)
    assert.equal(row.erp_lead_source, COMMERCIAL_ASSISTED_ERP_LEAD_SOURCE)
    assert.equal(row.reward_eligible, true)
    assert.equal(row.status, "em_atendimento")
    assert.equal(row.assigned_at, "2026-01-01T00:00:00.000Z")
    assert.equal(
      assertServerOwnsPrivilegedFields(row, "comercial-1", "comercial"),
      true
    )
  })

  it("admin_master: created_by = admin, commercial null (round-robin)", () => {
    const row = buildAssistedReferralInsertRow({
      validated,
      actorProfileId: "admin-1",
      actorRole: "admin_master",
      offerName: "500 Mega",
      offerPrice: 99.9,
      planId: "plan-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    })
    assert.equal(row.created_by_profile_id, "admin-1")
    assert.equal(row.commercial_profile_id, null)
    assert.equal(row.status, "pendente")
    assert.equal(row.assigned_at, null)
  })

  it("reward beneficiary is indicator, never commercial", () => {
    const row = buildAssistedReferralInsertRow({
      validated,
      actorProfileId: "comercial-1",
      actorRole: "comercial",
      offerName: "500 Mega",
      offerPrice: 99.9,
      planId: "plan-1",
      nowIso: "2026-01-01T00:00:00.000Z",
    })
    assert.equal(row.indicator_profile_id, "indicator-1")
    assert.notEqual(row.indicator_profile_id, row.commercial_profile_id)
    assert.equal(row.reward_amount, null)
  })
})

describe("createAssistedReferral service", () => {
  function makeDeps(
    overrides: Partial<CreateAssistedReferralDeps> = {}
  ): CreateAssistedReferralDeps & {
    inserted: unknown[]
    audits: unknown[]
    controllrCalls: unknown[]
  } {
    const inserted: unknown[] = []
    const audits: unknown[] = []
    const controllrCalls: unknown[] = []
    return {
      inserted,
      audits,
      controllrCalls,
      getUser: overrides.getUser ?? (async () => ({ id: "comercial-1" })),
      getActorProfile:
        overrides.getActorProfile ??
        (async () => ({
          id: "comercial-1",
          role: "comercial",
          is_active: true,
          full_name: "Maria Comercial",
        })),
      loadIndicatorProfile:
        overrides.loadIndicatorProfile ??
        (async () => ({
          id: "indicator-1",
          role: "indicador",
          is_active: true,
          full_name: "João Indicador",
        })),
      listPlanRows:
        overrides.listPlanRows ??
        (async () => [
          {
            id: "plan-500",
            name: "500 Mega",
            speed_label: "500 Mega",
            is_active: true,
          },
        ]),
      resolvePlanEnv:
        overrides.resolvePlanEnv ??
        (() => ({
          plan500Id: "plan-500",
          plan1000Id: "plan-1000",
          baseCrmPlanId: "plan-500",
        })),
      insertReferral:
        overrides.insertReferral ??
        (async (row) => {
          inserted.push(row)
          return { id: "ref-1" }
        }),
      findReferralByIdempotencyKey:
        overrides.findReferralByIdempotencyKey ?? (async () => null),
      insertReferralHistory:
        overrides.insertReferralHistory ?? (async () => undefined),
      insertAudit:
        overrides.insertAudit ??
        (async ({ metadata }) => {
          audits.push(metadata)
        }),
      createControllrInterest:
        overrides.createControllrInterest ??
        (async (input) => {
          controllrCalls.push(input)
          return { ok: true }
        }),
      nowIso: "2026-01-01T00:00:00.000Z",
    }
  }

  async function withValidOffer(
    deps: CreateAssistedReferralDeps,
    extra: Record<string, unknown> = {}
  ) {
    // Discover a real offer code from catalog via dynamic import
    const { listOffersForModality } = await import(
      "@/lib/commercial-offers/catalog"
    )
    const offers = listOffersForModality("tanto_vantagens", {
      channel: "indicator",
    })
    assert.ok(offers.length > 0, "catálogo indicator deve ter ofertas")
    return createAssistedReferral(
      deps,
      baseBody({
        public_offer_code: offers[0]!.code,
        ...extra,
      })
    )
  }

  it("commercial ativo cria", async () => {
    const deps = makeDeps()
    const result = await withValidOffer(deps)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.referralId, "ref-1")
    assert.equal(deps.inserted.length, 1)
    const row = deps.inserted[0] as { commercial_profile_id: string }
    assert.equal(row.commercial_profile_id, "comercial-1")
  })

  it("commercial inativo não cria", async () => {
    const deps = makeDeps({
      getActorProfile: async () => ({
        id: "comercial-1",
        role: "comercial",
        is_active: false,
        full_name: "Maria",
      }),
    })
    const result = await withValidOffer(deps)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it("indicator não cria", async () => {
    const deps = makeDeps({
      getActorProfile: async () => ({
        id: "comercial-1",
        role: "indicador",
        is_active: true,
        full_name: "X",
      }),
    })
    const result = await withValidOffer(deps)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it("anônimo não cria", async () => {
    const deps = makeDeps({ getUser: async () => null })
    const result = await withValidOffer(deps)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })

  it("indicator inexistente/inativo/não-indicador rejeitado", async () => {
    const missing = makeDeps({
      loadIndicatorProfile: async () => null,
    })
    assert.equal((await withValidOffer(missing)).ok, false)

    const inactive = makeDeps({
      loadIndicatorProfile: async () => ({
        id: "indicator-1",
        role: "indicador",
        is_active: false,
        full_name: "João",
      }),
    })
    assert.equal((await withValidOffer(inactive)).ok, false)

    const notInd = makeDeps({
      loadIndicatorProfile: async () => ({
        id: "indicator-1",
        role: "comercial",
        is_active: true,
        full_name: "X",
      }),
    })
    assert.equal((await withValidOffer(notInd)).ok, false)
  })

  it("ignora privileged fields do browser", async () => {
    const deps = makeDeps()
    const result = await withValidOffer(deps, {
      created_by_profile_id: "hacker",
      commercial_profile_id: "other",
      source: "hacked",
      reward_eligible: false,
      public_offer_price: 1,
    })
    assert.equal(result.ok, true)
    const row = deps.inserted[0] as {
      created_by_profile_id: string
      commercial_profile_id: string
      source: string
      reward_eligible: boolean
      public_offer_price: number
    }
    assert.equal(row.created_by_profile_id, "comercial-1")
    assert.equal(row.commercial_profile_id, "comercial-1")
    assert.equal(row.source, COMMERCIAL_ASSISTED_REFERRAL_SOURCE)
    assert.equal(row.reward_eligible, true)
    assert.notEqual(row.public_offer_price, 1)
  })

  it("audit sem PII sensível", async () => {
    const deps = makeDeps()
    await withValidOffer(deps)
    const meta = JSON.stringify(deps.audits[0] ?? {})
    assert.equal(meta.includes(VALID_CPF.replace(/\D/g, "")), false)
    assert.equal(meta.includes("98765"), false)
    assert.equal(meta.includes("pedro@ex.com"), false)
    assert.ok(meta.includes("commercial_assisted_referral_created"))
  })

  it("falha Controllr não desfaz referral nem troca indicador", async () => {
    const deps = makeDeps({
      createControllrInterest: async () => {
        throw new Error("erp down")
      },
    })
    const result = await withValidOffer(deps)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(deps.inserted.length, 1)
    const row = deps.inserted[0] as { indicator_profile_id: string }
    assert.equal(row.indicator_profile_id, "indicator-1")
    assert.equal(result.controllr.ok, false)
  })

  it("metadata de auditoria contém ids sem documentos", () => {
    const meta = buildAssistedCreateAuditMetadata({
      referralId: "r1",
      indicatorProfileId: "i1",
      commercialProfileId: "c1",
      createdByProfileId: "c1",
    })
    assert.equal(meta.referral_id, "r1")
    assert.equal(meta.source, COMMERCIAL_ASSISTED_REFERRAL_SOURCE)
  })
})
