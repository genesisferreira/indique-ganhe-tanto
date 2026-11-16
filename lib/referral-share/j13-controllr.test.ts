import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  controllrClaimIsOpen,
  controllrOfferLabel,
  decideControllrRetry,
  needsControllrLookupBeforeCreate,
  referralShareControllrOrigin,
} from "./controllr-origin"

const offers = [
  "Plano 400 Mega com linha fixa",
  "Banda Larga Corporativa",
  "Internet Empresarial",
  "500 Mega",
  "1000 Mega",
]
const origins = [
  ["indicator", "indicator", "INDICADOR"],
  ["employee", "technician_originator", "TÉCNICO"],
  ["employee", "external_sales_originator", "VENDEDOR EXTERNO"],
  ["partner_merchant", "partner_merchant_originator", "COMÉRCIO PARCEIRO"],
] as const

describe("envio do formulário público ao Controllr", () => {
  it("cobre origem, oferta, idempotência e o caminho existente", () => {
    for (const [kind, role, label] of origins) {
      assert.equal(referralShareControllrOrigin({ originKind: kind, attributionRole: role }), label)
    }
    for (const offer of offers) {
      assert.equal(controllrOfferLabel(offer, "500 Mega"), offer)
    }
    assert.equal(controllrOfferLabel("Banda Larga Corporativa", "500 Mega"), "Banda Larga Corporativa")
    assert.equal(controllrOfferLabel(null, "500 Mega"), "500 Mega")

    const now = Date.parse("2026-11-16T18:00:00.000Z")
    assert.equal(controllrClaimIsOpen({ interestId: null, endpoint: null, lastSyncAt: null, nowMs: now, ttlMs: 120000 }), true)
    assert.equal(controllrClaimIsOpen({ interestId: "10", endpoint: null, lastSyncAt: null, nowMs: now, ttlMs: 120000 }), false)
    assert.equal(controllrClaimIsOpen({
      interestId: null,
      endpoint: "create_interest:in_progress",
      lastSyncAt: "2026-11-16T17:59:30.000Z",
      nowMs: now,
      ttlMs: 120000,
    }), false)
    assert.equal(controllrClaimIsOpen({
      interestId: null,
      endpoint: "create_interest:in_progress",
      lastSyncAt: "2026-11-16T17:50:00.000Z",
      nowMs: now,
      ttlMs: 120000,
    }), true)
    assert.equal(decideControllrRetry({ lookupReached: true, existingInterestPk: "55" }), "link_existing")
    assert.equal(decideControllrRetry({ lookupReached: true, existingInterestPk: null }), "create")
    assert.equal(decideControllrRetry({ lookupReached: false, existingInterestPk: null }), "stop_unknown")
    assert.equal(needsControllrLookupBeforeCreate({ interestId: null, syncStatus: "pending", attempts: 0 }), false)
    assert.equal(needsControllrLookupBeforeCreate({ interestId: null, syncStatus: "error", attempts: 1 }), true)

    const indicacao = readFileSync("app/api/public/indicacao/submit/route.ts", "utf8")
    const parceiro = readFileSync("app/api/public/parceiro/submit/route.ts", "utf8")
    const dispatch = readFileSync("lib/referral-share/controllr-dispatch.ts", "utf8")
    const service = readFileSync("lib/brbyte/create-interest.service.ts", "utf8")
    const preService = readFileSync("lib/public-pre-registration/service.ts", "utf8")
    const card = readFileSync("components/admin/brbyte-create-interest-card.tsx", "utf8")
    const adminRoute = readFileSync("app/api/admin/brbyte/create-interest/route.ts", "utf8")
    for (const route of [indicacao, parceiro]) {
      assert.match(route, /dispatchReferralShareControllrInterest/)
      assert.doesNotMatch(route, /brbyteAdminLogin|brbyte_sync|createInterest\(/)
    }
    assert.match(dispatch, /createBrbyteInterestFromReferral/)
    assert.match(dispatch, /sourceContext: "referral_share"/)
    assert.doesNotMatch(dispatch, /brbyteAdminLogin|BRBYTE_API_PASSWORD|syncEnabled|wallet_transactions|employee_commission/)
    const preObservation = readFileSync("lib/public-pre-registration/observation.ts", "utf8")
    assert.match(preObservation, /ORIGEM/)
    assert.match(preObservation, /PRÉ-CADASTRO/)
    assert.match(service, /referral_share/)
    assert.match(service, /REFERRAL_SHARE_FORM_NOTE/)
    assert.match(service, /decideControllrRetry/)
    assert.doesNotMatch(service, /token_hash|idempotency_key|BRBYTE_API_PASSWORD/)
    assert.match(service, /brbyte_last_endpoint.neq/)
    assert.match(preService, /createBrbyteInterestFromReferral/)
    assert.match(card, /Pendente de envio ao Controllr/)
    assert.match(card, /Falha no envio/)
    assert.match(card, /Tentar novamente/)
    assert.match(card, /canMutate &&/)
    assert.match(adminRoute, /requireMutation: false/)
    assert.match(adminRoute, /sourceContext: "admin_manual"/)
  })
})
