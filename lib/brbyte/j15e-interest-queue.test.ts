import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  automaticInterestKeyForPreRegistration,
  isExplicitInterestOperation,
  phasesAfterFailure,
  settleInterestOperation,
} from "./interest-queue"

const automatic = {
  operationType: "create_interest",
  status: "pending",
  idempotencyKey: "share_key_1234567890",
  origin: "referral_share_link",
  flow: "automatic_current",
  attempts: 0,
}

describe("fila explícita de interessado", () => {
  it("aceita submissão nova e retry temporário", () => {
    assert.equal(isExplicitInterestOperation(automatic), true)
    assert.equal(isExplicitInterestOperation({
      ...automatic,
      status: "retryable",
      attempts: 1,
      origin: "public_pre_registration",
    }), true)
    assert.equal(
      automaticInterestKeyForPreRegistration("314c21f9-c97b-4f3d-9494-8eb6dd2325ba").length >= 16,
      true
    )
  })

  it("não reprocessa erro permanente nem estoura o limite", () => {
    assert.equal(isExplicitInterestOperation({ ...automatic, status: "permanent_error_not_retryable" }), false)
    assert.equal(isExplicitInterestOperation({ ...automatic, attempts: 4 }), false)
    assert.equal(settleInterestOperation({
      ok: false, hasInterestId: false, attempts: 0, referralStatus: "error",
    }), "permanent_error_not_retryable")
    assert.equal(settleInterestOperation({
      ok: false, hasInterestId: false, attempts: 0, referralStatus: "retryable_error",
    }), "retryable")
  })

  it("legacy sem operação fica fora e a autorização administrativa entra", () => {
    assert.equal(isExplicitInterestOperation({
      operationType: "create_interest",
      status: "legacy_not_queued",
      idempotencyKey: null,
      origin: "legacy",
      flow: "legacy_backlog",
      attempts: 0,
    }), false)
    assert.equal(isExplicitInterestOperation({
      operationType: "create_interest",
      status: "pending",
      idempotencyKey: null,
      origin: "legacy",
      flow: "legacy_backlog",
      attempts: 0,
    }), false)
    assert.equal(isExplicitInterestOperation({
      operationType: "create_interest",
      status: "pending",
      idempotencyKey: "admin_key_1234567890",
      origin: "legacy",
      flow: "admin_explicit",
      attempts: 0,
    }), true)
  })

  it("replay, duas execuções e reward futuro não duplicam a operação", () => {
    assert.equal(isExplicitInterestOperation({ ...automatic, status: "succeeded" }), false)
    assert.equal(settleInterestOperation({
      ok: true, hasInterestId: true, attempts: 1,
    }), "succeeded")
    assert.deepEqual(phasesAfterFailure("interest"), [
      "conversion", "contract", "invoice", "reward", "fixed_commission", "audit",
    ])
  })
})

describe("cron isolado do backlog", () => {
  it("o worker não seleciona indicação por status e a fase financeira continua", () => {
    const worker = readFileSync(new URL("../cron/brbyte-interest-dispatch.ts", import.meta.url), "utf8")
    const queue = readFileSync(new URL("./interest-operation.ts", import.meta.url), "utf8")
    const cron = readFileSync(new URL("../cron/brbyte-sync.ts", import.meta.url), "utf8")
    const lifecycle = readFileSync(new URL("../cron/brbyte-lifecycle-sync.ts", import.meta.url), "utf8")
    const sql = readFileSync(
      new URL("../../supabase/patch-controllr-automation-3-1f-j15e.sql", import.meta.url),
      "utf8"
    )
    assert.match(queue, /brbyte_interest_operations/)
    assert.doesNotMatch(worker, /brbyte_sync_status|brbyte_id_interessado/)
    assert.doesNotMatch(queue, /\.in\("brbyte_sync_status"/)
    assert.match(cron, /phase_failed/)
    assert.ok(cron.indexOf("runAutomaticInterestDispatch") < cron.indexOf("runBrbyteLifecycleSync"))
    assert.match(lifecycle, /checkBrbyteFirstInvoiceFromReferral/)
    assert.match(lifecycle, /lease_released: true/)
    assert.match(lifecycle, /cursor:/)
    assert.match(sql, /legacy_not_queued/)
    assert.match(sql, /permanent_error_not_retryable/)
    assert.match(sql, /authorize_legacy_interest_operation/)
    assert.doesNotMatch(sql, /update public\.referrals/)
  })
})
