import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isAssistedIdempotencyKey,
  isUniqueViolationError,
  normalizeAssistedIdempotencyKey,
} from "./idempotency"
import {
  createAssistedReferral,
  type AssistedReferralInsertRow,
  type CreateAssistedReferralDeps,
} from "./create-assisted-referral"
import {
  COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
} from "./constants"

const VALID_CPF = "529.982.247-25"
const KEY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const KEY_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    assisted_idempotency_key: KEY_A,
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
    created_by_profile_id: "hacker",
    commercial_profile_id: "other-comercial",
    source: "hacked",
    erp_lead_source: "Pré-cadastro Web",
    reward_eligible: false,
    public_offer_price: 1,
    ...overrides,
  }
}

type Stored = {
  id: string
  indicator_profile_id: string
  created_by_profile_id: string | null
  commercial_profile_id: string | null
  referred_name: string
  source: string | null
  reward_eligible: boolean | null
  assisted_idempotency_key: string
}

describe("idempotency helpers", () => {
  it("normaliza UUID válido", () => {
    assert.equal(isAssistedIdempotencyKey(KEY_A), true)
    assert.equal(
      normalizeAssistedIdempotencyKey(KEY_A.toUpperCase()),
      KEY_A.toLowerCase()
    )
  })

  it("rejeita key inválida", () => {
    assert.equal(normalizeAssistedIdempotencyKey("not-a-uuid"), null)
    assert.equal(normalizeAssistedIdempotencyKey(""), null)
  })

  it("detecta unique violation (constraint / partial index)", () => {
    assert.equal(isUniqueViolationError({ code: "23505" }), true)
    assert.equal(
      isUniqueViolationError({
        message: "duplicate key value violates unique constraint",
      }),
      true
    )
    assert.equal(
      isUniqueViolationError({
        message: "referrals_assisted_idempotency_key_uidx",
      }),
      true
    )
    assert.equal(isUniqueViolationError({ code: "23503" }), false)
  })
})

describe("createAssistedReferral idempotência", () => {
  function makeStoreDeps(opts?: {
    raceOnSecondInsert?: boolean
  }): CreateAssistedReferralDeps & {
    store: Map<string, Stored>
    insertedRows: AssistedReferralInsertRow[]
    controllrCalls: unknown[]
  } {
    const store = new Map<string, Stored>()
    const insertedRows: AssistedReferralInsertRow[] = []
    const controllrCalls: unknown[] = []
    let insertAttempts = 0

    const deps: CreateAssistedReferralDeps & {
      store: Map<string, Stored>
      insertedRows: AssistedReferralInsertRow[]
      controllrCalls: unknown[]
    } = {
      store,
      insertedRows,
      controllrCalls,
      getUser: async () => ({ id: "comercial-1" }),
      getActorProfile: async () => ({
        id: "comercial-1",
        role: "comercial",
        is_active: true,
        full_name: "Maria Comercial",
      }),
      loadIndicatorProfile: async () => ({
        id: "indicator-1",
        role: "indicador",
        is_active: true,
        full_name: "João Indicador",
      }),
      listPlanRows: async () => [
        {
          id: "plan-500",
          name: "500 Mega",
          speed_label: "500 Mega",
          is_active: true,
        },
      ],
      resolvePlanEnv: () => ({
        plan500Id: "plan-500",
        plan1000Id: "plan-1000",
        baseCrmPlanId: "plan-500",
      }),
      findReferralByIdempotencyKey: async (key) => store.get(key) ?? null,
      insertReferral: async (row) => {
        insertAttempts += 1
        if (store.has(row.assisted_idempotency_key)) {
          return {
            error: "duplicate key value violates unique constraint",
            code: "23505",
            uniqueViolation: true,
          }
        }
        // Simula corrida: 1º insert grava; 2º concorrente vê unique.
        if (opts?.raceOnSecondInsert && insertAttempts > 1) {
          return {
            error: "duplicate key",
            code: "23505",
            uniqueViolation: true,
          }
        }
        const id = `ref-${store.size + 1}`
        const stored: Stored = {
          id,
          indicator_profile_id: row.indicator_profile_id,
          created_by_profile_id: row.created_by_profile_id,
          commercial_profile_id: row.commercial_profile_id,
          referred_name: row.referred_name,
          source: row.source,
          reward_eligible: row.reward_eligible,
          assisted_idempotency_key: row.assisted_idempotency_key,
        }
        store.set(row.assisted_idempotency_key, stored)
        insertedRows.push(row)
        return { id }
      },
      insertReferralHistory: async () => undefined,
      insertAudit: async () => undefined,
      createControllrInterest: async (input) => {
        controllrCalls.push(input)
        return { ok: true }
      },
      nowIso: "2026-01-01T00:00:00.000Z",
    }
    return deps
  }

  async function withValidOffer(
    deps: CreateAssistedReferralDeps,
    extra: Record<string, unknown> = {}
  ) {
    const { listOffersForModality } = await import(
      "@/lib/commercial-offers/catalog"
    )
    const offers = listOffersForModality("tanto_vantagens", {
      channel: "indicator",
    })
    assert.ok(offers.length > 0)
    return createAssistedReferral(
      deps,
      baseBody({
        public_offer_code: offers[0]!.code,
        ...extra,
      })
    )
  }

  it("1) primeira request cria 1 referral", async () => {
    const deps = makeStoreDeps()
    const result = await withValidOffer(deps)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.replayed, false)
    assert.equal(deps.insertedRows.length, 1)
    assert.equal(deps.store.size, 1)
    assert.equal(deps.controllrCalls.length, 1)
  })

  it("2) segunda request mesma key não cria outra", async () => {
    const deps = makeStoreDeps()
    const first = await withValidOffer(deps)
    assert.equal(first.ok, true)
    if (!first.ok) return
    const second = await withValidOffer(deps)
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.equal(second.replayed, true)
    assert.equal(second.referralId, first.referralId)
    assert.equal(deps.insertedRows.length, 1)
    assert.equal(deps.controllrCalls.length, 1)
  })

  it("3) requests concorrentes mesma key resultam em 1 referral", async () => {
    // Documentação: concorrência real é garantida pelo unique partial index
    // referrals_assisted_idempotency_key_uidx. Aqui simulamos a janela:
    // ambos passam o pre-check (store vazio), 1º insert grava, 2º recebe 23505
    // e faz replay via findReferralByIdempotencyKey.
    const store = new Map<string, Stored>()
    const insertedRows: AssistedReferralInsertRow[] = []
    let gate: Promise<void> | null = null
    let releaseGate: (() => void) | null = null
    let insertCount = 0

    const deps: CreateAssistedReferralDeps = {
      getUser: async () => ({ id: "comercial-1" }),
      getActorProfile: async () => ({
        id: "comercial-1",
        role: "comercial",
        is_active: true,
        full_name: "Maria",
      }),
      loadIndicatorProfile: async () => ({
        id: "indicator-1",
        role: "indicador",
        is_active: true,
        full_name: "João",
      }),
      listPlanRows: async () => [
        { id: "plan-500", name: "500", speed_label: "500", is_active: true },
      ],
      resolvePlanEnv: () => ({
        plan500Id: "plan-500",
        plan1000Id: "plan-1000",
        baseCrmPlanId: "plan-500",
      }),
      findReferralByIdempotencyKey: async (key) => store.get(key) ?? null,
      insertReferral: async (row) => {
        insertCount += 1
        if (insertCount === 1) {
          gate = new Promise<void>((resolve) => {
            releaseGate = resolve
          })
          const id = "ref-race-1"
          const stored: Stored = {
            id,
            indicator_profile_id: row.indicator_profile_id,
            created_by_profile_id: row.created_by_profile_id,
            commercial_profile_id: row.commercial_profile_id,
            referred_name: row.referred_name,
            source: row.source,
            reward_eligible: row.reward_eligible,
            assisted_idempotency_key: row.assisted_idempotency_key,
          }
          store.set(row.assisted_idempotency_key, stored)
          insertedRows.push(row)
          // libera o 2º após gravar
          releaseGate?.()
          return { id }
        }
        await gate
        return {
          error: "duplicate key",
          code: "23505",
          uniqueViolation: true,
        }
      },
      insertReferralHistory: async () => undefined,
      insertAudit: async () => undefined,
      createControllrInterest: async () => ({ ok: true }),
      nowIso: "2026-01-01T00:00:00.000Z",
    }

    const [a, b] = await Promise.all([
      withValidOffer(deps),
      withValidOffer(deps),
    ])
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    if (!a.ok || !b.ok) return
    assert.equal(a.referralId, b.referralId)
    assert.equal(insertedRows.length, 1)
    assert.equal(store.size, 1)
    assert.ok(a.replayed || b.replayed)
  })

  it("4) nova key pode criar nova operação", async () => {
    const deps = makeStoreDeps()
    const first = await withValidOffer(deps, {
      assisted_idempotency_key: KEY_A,
    })
    const second = await withValidOffer(deps, {
      assisted_idempotency_key: KEY_B,
      referred_name: "Outro Indicado",
    })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) return
    assert.notEqual(first.referralId, second.referralId)
    assert.equal(deps.insertedRows.length, 2)
  })

  it("5-9) idempotency key não altera indicator/commercial/created_by/reward/source", async () => {
    const deps = makeStoreDeps()
    const result = await withValidOffer(deps, {
      assisted_idempotency_key: KEY_A,
      indicator_profile_id: "indicator-1",
      created_by_profile_id: "hacker",
      commercial_profile_id: "spoof",
      source: "hacked",
      reward_eligible: false,
    })
    assert.equal(result.ok, true)
    const row = deps.insertedRows[0]!
    assert.equal(row.indicator_profile_id, "indicator-1")
    assert.equal(row.commercial_profile_id, "comercial-1")
    assert.equal(row.created_by_profile_id, "comercial-1")
    assert.equal(row.reward_eligible, true)
    assert.equal(row.source, COMMERCIAL_ASSISTED_REFERRAL_SOURCE)
    assert.equal(row.assisted_idempotency_key, KEY_A)

    const replay = await withValidOffer(deps, {
      assisted_idempotency_key: KEY_A,
      indicator_profile_id: "indicator-OTHER",
      created_by_profile_id: "hacker2",
      commercial_profile_id: "spoof2",
      source: "hacked2",
      reward_eligible: false,
    })
    assert.equal(replay.ok, true)
    if (!replay.ok) return
    assert.equal(replay.replayed, true)
    assert.equal(deps.insertedRows.length, 1)
    assert.equal(deps.store.get(KEY_A)?.indicator_profile_id, "indicator-1")
    assert.equal(deps.store.get(KEY_A)?.created_by_profile_id, "comercial-1")
    assert.equal(deps.store.get(KEY_A)?.commercial_profile_id, "comercial-1")
    assert.equal(deps.store.get(KEY_A)?.source, COMMERCIAL_ASSISTED_REFERRAL_SOURCE)
    assert.equal(deps.store.get(KEY_A)?.reward_eligible, true)
  })

  it("10) retry após falha de resposta encontra criação original", async () => {
    const deps = makeStoreDeps()
    // 1ª tentativa: cria (simula timeout no client — servidor já persistiu)
    const first = await withValidOffer(deps)
    assert.equal(first.ok, true)
    if (!first.ok) return
    // Retry com mesma key (client reutiliza): replay sem novo insert/Controllr
    const retry = await withValidOffer(deps)
    assert.equal(retry.ok, true)
    if (!retry.ok) return
    assert.equal(retry.replayed, true)
    assert.equal(retry.referralId, first.referralId)
    assert.equal(deps.insertedRows.length, 1)
    assert.equal(deps.controllrCalls.length, 1)
  })
})
