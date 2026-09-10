import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ERP_CONVERTED_BRBYTE_SYNC_STATUS,
  ERP_CONVERTED_CRM_PIPELINE_STAGE,
  ERP_CONVERTED_CRM_STATUS,
  ERP_CONVERSION_COMMERCIAL_HISTORY_ACTION,
  assertNoForbiddenReferralKeys,
  buildCommercialConversionHistoryInsert,
  buildCommercialRepairUpdate,
  buildConvertedReferralUpdate,
  classifyErpConversionCheck,
  deriveCommercialStateFromErpConversion,
  projectErpConvertedAfterTrigger,
  shouldAssignCommercialOnAprovadaTrigger,
} from "@/lib/brbyte/erp-conversion-commercial-sync"
import { canAutoCreditFirstInvoiceReward } from "@/lib/brbyte/first-invoice-auto-credit-gate"
import {
  COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
  NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
  PUBLIC_PRE_REGISTRATION_SOURCE,
  isReferralRewardEligible,
} from "@/lib/referral-reward-eligibility"
import { normalizeBrbyteSyncStatus } from "@/types/referral"

const LIST_ENDPOINT = "/list-client-interest"

function convertedUpdate(overrides?: {
  currentStatus?: string | null
  currentPipelineStage?: string | null
  erpConverted?: boolean
  currentWonAt?: string | null
}) {
  const commercial = deriveCommercialStateFromErpConversion({
    erpConverted: overrides?.erpConverted ?? true,
    currentStatus: overrides?.currentStatus ?? "em_atendimento",
    currentPipelineStage: overrides?.currentPipelineStage ?? "tentativa_contato",
  })
  const update = buildConvertedReferralUpdate({
    commercial,
    clientPk: "client-1",
    resolution: { interestPk: "int-1", clientPk: "client-1" },
    payload: { ok: true },
    syncRunId: "run-1",
    httpStatus: 200,
    syncedAtIso: "2026-09-10T15:00:00.000Z",
    listClientInterestEndpoint: LIST_ENDPOINT,
    currentWonAt: overrides?.currentWonAt ?? null,
  })
  return { commercial, update }
}

describe("A) ERP não converted → estado comercial não muda", () => {
  it("não aplica sync comercial nem histórico", () => {
    const plan = deriveCommercialStateFromErpConversion({
      erpConverted: false,
      currentStatus: "em_atendimento",
      currentPipelineStage: "tentativa_contato",
    })
    assert.equal(plan.applyCommercialSync, false)
    assert.equal(plan.needsCommercialUpdate, false)
    assert.equal(plan.writeCommercialHistory, false)
    assert.equal(plan.targetStatus, null)
    assert.equal(plan.targetPipelineStage, null)
    assert.equal(plan.createsReward, false)

    const gate = classifyErpConversionCheck({
      brbyteIdInteressado: "int-1",
      brbyteClientPk: null,
      brbyteSyncStatus: "created",
      currentStatus: "em_atendimento",
      currentPipelineStage: "tentativa_contato",
      normalizeSyncStatus: normalizeBrbyteSyncStatus,
    })
    assert.equal(gate.kind, "controllr_check")
  })
})

describe("B) ERP converted + em_atendimento → aprovada/ativado", () => {
  it("mapeia status e pipeline", () => {
    const plan = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "em_atendimento",
      currentPipelineStage: "tentativa_contato",
    })
    assert.equal(plan.targetStatus, ERP_CONVERTED_CRM_STATUS)
    assert.equal(plan.targetPipelineStage, ERP_CONVERTED_CRM_PIPELINE_STAGE)
    assert.equal(plan.needsCommercialUpdate, true)
    assert.equal(plan.statusChanged, true)
    assert.equal(plan.pipelineChanged, true)
    assert.equal(plan.brbyteSyncStatus, ERP_CONVERTED_BRBYTE_SYNC_STATUS)

    const { update } = convertedUpdate()
    assert.equal(update.status, "aprovada")
    assert.equal(update.pipeline_stage, "ativado")
    assert.equal(update.brbyte_sync_status, "converted")
  })
})

describe("C) ERP converted + já aprovada → idempotente no status", () => {
  it("alinha pipeline se necessário e não reabre", () => {
    const aligned = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "aprovada",
      currentPipelineStage: "ativado",
    })
    assert.equal(aligned.needsCommercialUpdate, false)
    assert.equal(aligned.writeCommercialHistory, false)
    assert.equal(aligned.targetStatus, "aprovada")
    assert.equal(aligned.targetPipelineStage, "ativado")

    const pipelineOnly = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "aprovada",
      currentPipelineStage: "negociacao",
    })
    assert.equal(pipelineOnly.statusChanged, false)
    assert.equal(pipelineOnly.pipelineChanged, true)
    assert.equal(pipelineOnly.targetStatus, "aprovada")
    assert.equal(pipelineOnly.targetPipelineStage, "ativado")
  })
})

describe("D) ERP converted + paga → preserva paga e ativa pipeline", () => {
  it("nunca regride paga para aprovada", () => {
    const plan = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "paga",
      currentPipelineStage: "instalacao",
    })
    assert.equal(plan.targetStatus, "paga")
    assert.equal(plan.targetPipelineStage, "ativado")
    assert.equal(plan.statusChanged, false)
    assert.equal(plan.pipelineChanged, true)

    const { update } = convertedUpdate({
      currentStatus: "paga",
      currentPipelineStage: "instalacao",
    })
    assert.equal(Object.prototype.hasOwnProperty.call(update, "status"), false)
    assert.equal(update.pipeline_stage, "ativado")
  })
})

describe("E) ERP converted + commercial_profile_id NULL → trigger não reabre", () => {
  it("resultado final continua converted/aprovada/ativado", () => {
    const projected = projectErpConvertedAfterTrigger({
      previousStatus: "em_atendimento",
      previousPipelineStage: "tentativa_contato",
      commercialProfileId: null,
    })
    assert.equal(projected.assignCommercialTriggered, false)
    assert.equal(projected.status, "aprovada")
    assert.equal(projected.pipelineStage, "ativado")
    assert.equal(projected.commercialProfileId, null)

    const shouldAssign = shouldAssignCommercialOnAprovadaTrigger({
      oldStatus: "em_atendimento",
      newStatus: "aprovada",
      commercialProfileId: null,
      brbyteSyncStatus: "converted",
    })
    assert.equal(shouldAssign, false)
  })

  it("aprovação comercial normal sem converted ainda atribui", () => {
    const shouldAssign = shouldAssignCommercialOnAprovadaTrigger({
      oldStatus: "em_atendimento",
      newStatus: "aprovada",
      commercialProfileId: null,
      brbyteSyncStatus: "created",
    })
    assert.equal(shouldAssign, true)
  })
})

describe("F) ERP converted + commercial existente → responsável preservado", () => {
  it("não dispara atribuição e mantém o comercial", () => {
    const projected = projectErpConvertedAfterTrigger({
      previousStatus: "em_negociacao",
      previousPipelineStage: "negociacao",
      commercialProfileId: "com-123",
    })
    assert.equal(projected.assignCommercialTriggered, false)
    assert.equal(projected.commercialProfileId, "com-123")
    assert.equal(projected.status, "aprovada")

    const { update } = convertedUpdate({
      currentStatus: "em_negociacao",
      currentPipelineStage: "negociacao",
    })
    assert.equal(
      Object.prototype.hasOwnProperty.call(update, "commercial_profile_id"),
      false
    )
  })
})

describe("G) commercial_assisted_referral → IDs preservados", () => {
  it("não substitui indicador, ator original nem responsável", () => {
    const projected = projectErpConvertedAfterTrigger({
      previousStatus: "em_atendimento",
      previousPipelineStage: "tentativa_contato",
      commercialProfileId: "com-9",
      indicatorProfileId: "ind-1",
      createdByProfileId: "com-9",
    })
    assert.equal(projected.indicatorProfileId, "ind-1")
    assert.equal(projected.createdByProfileId, "com-9")
    assert.equal(projected.commercialProfileId, "com-9")
    assert.equal(projected.createsReward, false)

    const { update } = convertedUpdate()
    assert.deepEqual(assertNoForbiddenReferralKeys(update), [])

    assert.equal(
      isReferralRewardEligible({
        source: COMMERCIAL_ASSISTED_REFERRAL_SOURCE,
        reward_eligible: true,
        indicator_profile_id: "ind-1",
      }),
      true
    )
  })
})

describe("H) reexecução da conversão → sem histórico duplicado", () => {
  it("já reconciliada é no-op comercial", () => {
    const plan = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "aprovada",
      currentPipelineStage: "ativado",
    })
    assert.equal(plan.writeCommercialHistory, false)

    const history = buildCommercialConversionHistoryInsert({
      referralId: "ref-1",
      actorUserId: "actor-1",
      commercial: plan,
      clientPk: "client-1",
      syncRunId: "run-1",
    })
    assert.equal(history, null)

    const { update } = convertedUpdate({
      currentStatus: "aprovada",
      currentPipelineStage: "ativado",
    })
    assert.equal(Object.prototype.hasOwnProperty.call(update, "status"), false)
    assert.equal(
      Object.prototype.hasOwnProperty.call(update, "pipeline_stage"),
      false
    )

    const gate = classifyErpConversionCheck({
      brbyteIdInteressado: "int-1",
      brbyteClientPk: "client-1",
      brbyteSyncStatus: "converted",
      currentStatus: "aprovada",
      currentPipelineStage: "ativado",
      normalizeSyncStatus: normalizeBrbyteSyncStatus,
    })
    assert.equal(gate.kind, "already_synced")
  })

  it("converted com CRM desalinhado repara uma vez e escreve histórico", () => {
    const gate = classifyErpConversionCheck({
      brbyteIdInteressado: "int-1",
      brbyteClientPk: "client-1",
      brbyteSyncStatus: "converted",
      currentStatus: "em_atendimento",
      currentPipelineStage: "tentativa_contato",
      normalizeSyncStatus: normalizeBrbyteSyncStatus,
    })
    assert.equal(gate.kind, "repair_commercial")

    const commercial = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "em_atendimento",
      currentPipelineStage: "tentativa_contato",
    })
    const history = buildCommercialConversionHistoryInsert({
      referralId: "ref-1",
      actorUserId: null,
      commercial,
      clientPk: "client-1",
      syncRunId: "run-1",
    })
    assert.ok(history)
    assert.equal(history.metadata.action, ERP_CONVERSION_COMMERCIAL_HISTORY_ACTION)
    assert.equal(history.new_status, "aprovada")

    const repair = buildCommercialRepairUpdate({
      commercial,
      syncedAtIso: "2026-09-10T15:00:00.000Z",
    })
    assert.ok(repair)
    assert.equal(repair.status, "aprovada")
    assert.equal(repair.pipeline_stage, "ativado")
    assert.deepEqual(assertNoForbiddenReferralKeys(repair), [])
  })
})

describe("I) conversão → zero efeito financeiro", () => {
  it("plano e persist não criam reward/wallet/RPC/first_invoice_paid", () => {
    const { commercial, update } = convertedUpdate()
    assert.equal(commercial.createsReward, false)
    assert.equal(commercial.createsWallet, false)
    assert.equal(commercial.setsFirstInvoicePaid, false)
    assert.equal(commercial.callsMarkFirstInvoicePaidFromSync, false)
    assert.deepEqual(assertNoForbiddenReferralKeys(update), [])
    assert.equal(
      Object.prototype.hasOwnProperty.call(update, "first_invoice_paid"),
      false
    )

    const gate = canAutoCreditFirstInvoiceReward({ autoMarkPaidEnabled: false })
    assert.equal(gate.allowed, false)
  })
})

describe("J) public_pre_registration → conversão não cria reward", () => {
  it("permanece inelegível após mapeamento comercial", () => {
    const plan = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "em_atendimento",
      currentPipelineStage: "novo",
    })
    assert.equal(plan.createsReward, false)
    assert.equal(
      isReferralRewardEligible({
        source: PUBLIC_PRE_REGISTRATION_SOURCE,
        reward_eligible: false,
        indicator_profile_id: null,
      }),
      false
    )
  })
})

describe("K) neutral_network_pre_registration → conversão não cria reward", () => {
  it("permanece inelegível após mapeamento comercial", () => {
    const plan = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "em_atendimento",
      currentPipelineStage: "novo",
    })
    assert.equal(plan.createsReward, false)
    assert.equal(
      isReferralRewardEligible({
        source: NEUTRAL_NETWORK_PRE_REGISTRATION_SOURCE,
        reward_eligible: false,
        indicator_profile_id: null,
      }),
      false
    )
  })
})

describe("L) status paga → nunca regride", () => {
  it("reexecução e trigger preservam paga", () => {
    const first = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "paga",
      currentPipelineStage: "instalacao",
    })
    assert.equal(first.targetStatus, "paga")

    const again = deriveCommercialStateFromErpConversion({
      erpConverted: true,
      currentStatus: "paga",
      currentPipelineStage: "ativado",
    })
    assert.equal(again.targetStatus, "paga")
    assert.equal(again.needsCommercialUpdate, false)

    const shouldAssign = shouldAssignCommercialOnAprovadaTrigger({
      oldStatus: "paga",
      newStatus: "paga",
      commercialProfileId: null,
      brbyteSyncStatus: "converted",
    })
    assert.equal(shouldAssign, false)

    const projected = projectErpConvertedAfterTrigger({
      previousStatus: "paga",
      previousPipelineStage: "ativado",
      commercialProfileId: "com-1",
    })
    assert.equal(projected.status, "paga")
    assert.equal(projected.assignCommercialTriggered, false)
  })
})

describe("won_at coalesce e 1.2R-C intocado", () => {
  it("não sobrescreve won_at existente", () => {
    const { update } = convertedUpdate({
      currentWonAt: "2026-01-01T00:00:00.000Z",
    })
    assert.equal(update.won_at, "2026-01-01T00:00:00.000Z")
  })

  it("canAutoCreditFirstInvoiceReward continua só no gate 1.2R-C", () => {
    const blocked = canAutoCreditFirstInvoiceReward({
      autoMarkPaidEnabled: false,
    })
    const allowed = canAutoCreditFirstInvoiceReward({
      autoMarkPaidEnabled: true,
    })
    assert.equal(blocked.allowed, false)
    assert.equal(allowed.allowed, true)
  })
})
