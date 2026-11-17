import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  controllrFailureStatus,
  interestRetryDelayMs,
  interestRetryDue,
  isAutomaticInterestCandidate,
  needsControllrLookupBeforeCreate,
} from "./controllr-origin"

describe("envio automático durável ao Controllr", () => {
  it("aguarda a criação, agenda nova tentativa e não depende da sincronização", () => {
    assert.equal(controllrFailureStatus(200), "retryable_error")
    assert.equal(controllrFailureStatus(500), "retryable_error")
    assert.equal(controllrFailureStatus(null), "retryable_error")
    assert.equal(controllrFailureStatus(400), "error")
    assert.equal(controllrFailureStatus(422), "error")

    assert.deepEqual(
      [0, 1, 2, 3, 4].map((attempts) => interestRetryDelayMs(attempts)),
      [0, 120000, 300000, 600000, null]
    )

    const now = Date.parse("2026-11-16T19:40:00.000Z")
    assert.equal(interestRetryDue({
      attempts: 0,
      lastSyncAt: null,
      endpoint: null,
      nowMs: now,
      leaseTtlMs: 120000,
    }), true)
    assert.equal(interestRetryDue({
      attempts: 0,
      lastSyncAt: "2026-11-16T19:39:30.000Z",
      endpoint: "create_interest:in_progress",
      nowMs: now,
      leaseTtlMs: 120000,
    }), false)
    assert.equal(interestRetryDue({
      attempts: 1,
      lastSyncAt: "2026-11-16T19:30:00.000Z",
      endpoint: "create_interest:in_progress",
      nowMs: now,
      leaseTtlMs: 120000,
    }), true)
    assert.equal(interestRetryDue({
      attempts: 4,
      lastSyncAt: "2026-11-16T18:00:00.000Z",
      endpoint: null,
      nowMs: now,
      leaseTtlMs: 120000,
    }), false)

    assert.equal(isAutomaticInterestCandidate({
      source: "referral_share_link",
      status: "pending",
      interestId: null,
    }), true)
    for (const source of [
      "referral_share_link",
      "employee_sales_opportunity",
      "partner_merchant_referral",
      "public_pre_registration",
    ]) {
      assert.equal(isAutomaticInterestCandidate({ source, status: "pending", interestId: null }), true)
    }
    assert.equal(isAutomaticInterestCandidate({
      source: null,
      status: "pending",
      interestId: null,
    }), false)
    assert.equal(isAutomaticInterestCandidate({
      source: "public_pre_registration",
      status: "error",
      interestId: null,
    }), false)
    assert.equal(needsControllrLookupBeforeCreate({
      interestId: null,
      syncStatus: "retryable_error",
      attempts: 1,
    }), true)
    assert.equal(needsControllrLookupBeforeCreate({
      interestId: null,
      syncStatus: "pending",
      attempts: 0,
    }), false)

    const indicacao = readFileSync("app/api/public/indicacao/submit/route.ts", "utf8")
    const parceiro = readFileSync("app/api/public/parceiro/submit/route.ts", "utf8")
    const dispatch = readFileSync("lib/referral-share/controllr-dispatch.ts", "utf8")
    const service = readFileSync("lib/brbyte/create-interest.service.ts", "utf8")
    const worker = readFileSync("lib/cron/brbyte-interest-dispatch.ts", "utf8")
    const cron = readFileSync("lib/cron/brbyte-sync.ts", "utf8")
    const vercel = readFileSync("vercel.json", "utf8")
    const card = readFileSync("components/admin/brbyte-create-interest-card.tsx", "utf8")
    const preService = readFileSync("lib/public-pre-registration/service.ts", "utf8")

    for (const route of [indicacao, parceiro]) {
      assert.match(route, /await dispatchReferralShareControllrInterest/)
      assert.doesNotMatch(route, /void dispatchReferralShareControllrInterest/)
    }
    assert.match(dispatch, /await createBrbyteInterestFromReferral/)
    assert.match(dispatch, /enqueueAutomaticInterestOperation/)
    assert.doesNotMatch(dispatch, /void createBrbyteInterestFromReferral|from\("referral_share_submissions"\)/)
    assert.match(dispatch, /referral_share_referral_id_for_dispatch/)
    const attemptAt = service.indexOf("brbyte_sync_attempts")
    const loginAt = service.indexOf("const login = await brbyteAdminLogin")
    assert.ok(attemptAt > 0 && loginAt > attemptAt)
    assert.match(service, /retryable_error/)
    assert.match(service, /useAttemptsAsRecorded: true/)
    assert.doesNotMatch(worker, /isBrbyteSyncEnabled|Promise\.all|wallet_transactions|employee_commission|partner_commission/)
    assert.match(worker, /loadDueInterestOperations/)
    assert.doesNotMatch(worker, /brbyte_sync_status/)
    assert.ok(cron.indexOf("runAutomaticInterestDispatch") < cron.indexOf("runBrbyteLifecycleSync"))
    assert.doesNotMatch(cron, /isBrbyteSyncEnabled/)
    assert.match(vercel, /"schedule": "15 12 \* \* \*"/)
    assert.doesNotMatch(vercel, /\*\/2 \* \* \* \*/)
    assert.match(card, /Envio automático agendado/)
    assert.match(card, /syncStatus === "error"/)
    assert.match(preService, /createBrbyteInterestFromReferral/)
    assert.match(preService, /enqueuePreRegistrationInterestOperation/)
  })
})
