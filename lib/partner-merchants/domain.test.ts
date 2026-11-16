import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import {
  assessCompensationRule,
  canPerform,
  capabilityForRole,
  decideDuplicate,
  decideIdempotency,
  fixedCommissionAlreadyRecorded,
  generatePartnerToken,
  hashPartnerToken,
  partnerPublicUrl,
  redactForLog,
  rejectForbiddenPublicKeys,
} from "@/lib/partner-merchants/domain"
import { renderPartnerQr } from "@/lib/partner-merchants/qr"
import { isReferralRewardEligible } from "@/lib/referral-reward-eligibility"

describe("3.1F-J9 token e QR", () => {
  it("token tem 256 bits, não é sequencial e a URL não carrega id interno", () => {
    const a = generatePartnerToken()
    const b = generatePartnerToken()
    assert.equal(a.length, 43)
    assert.notEqual(a, b)
    assert.equal(hashPartnerToken(a).length, 64)
    assert.notEqual(hashPartnerToken(a), a)
    const url = partnerPublicUrl(a)
    assert.equal(url, `https://crm.tantotelecom.com.br/parceiro/${a}`)
    assert.equal(url.includes("?"), false)
  })
  it("QR só aceita o link HTTPS do parceiro", async () => {
    const url = partnerPublicUrl(generatePartnerToken())
    const qr = await renderPartnerQr(url)
    assert.match(qr.svg, /<svg/)
    assert.ok(qr.png.length > 500)
    await assert.rejects(() => renderPartnerQr("https://crm.tantotelecom.com.br/parceiro/curto?comissao=30"))
  })
})

describe("3.1F-J9 atribuição, duplicidade e dinheiro", () => {
  it("oportunidade aberta preserva o parceiro original", () => {
    const decision = decideDuplicate({ openOpportunityId: "opp-1", recentClosed: false, confirmRecent: false })
    assert.deepEqual(decision, { action: "reject", code: "duplicate_open", recordCompeting: true })
  })
  it("encerrada há menos de 90 dias pede confirmação", () => {
    assert.equal(decideDuplicate({ openOpportunityId: null, recentClosed: true, confirmRecent: false }).action, "reject")
    assert.equal(decideDuplicate({ openOpportunityId: null, recentClosed: true, confirmRecent: true }).action, "create")
  })
  it("mesma chave com outro payload conflita e não troca o parceiro", () => {
    assert.equal(decideIdempotency({ hash: "a", partnerId: "p1" }, "a", "p1"), "replay")
    assert.equal(decideIdempotency({ hash: "a", partnerId: "p1" }, "b", "p1"), "conflict")
    assert.equal(decideIdempotency({ hash: "a", partnerId: "p1" }, "a", "p2"), "conflict")
  })
  it("valor fixo não tem default e as outras modalidades ficam bloqueadas", () => {
    assert.equal(assessCompensationRule({ kind: "fixed_amount" }).ok, false)
    const fixed = assessCompensationRule({ kind: "fixed_amount", fixedAmountCents: 1250 })
    assert.equal(fixed.ok, true)
    if (fixed.ok) assert.equal(fixed.entitlementCreated, false)
    const percentage = assessCompensationRule({ kind: "percentage", percentageBps: 800 })
    assert.equal(percentage.ok && percentage.status, "blocked")
    const invoice = assessCompensationRule({ kind: "first_invoice_value" })
    assert.equal(invoice.ok && invoice.blockReason, "full_payment_unproven")
  })
  it("várias faturas não geram outra comissão fixa", () => {
    const existing = [{ partnerId: "p", opportunityId: "o", ruleId: "r", trigger: "invoice_generated" }]
    assert.equal(fixedCommissionAlreadyRecorded(existing, { partnerId: "p", opportunityId: "o", ruleId: "r", trigger: "invoice_generated" }), true)
  })
  it("origem parceiro não gera reward", () => {
    assert.equal(isReferralRewardEligible({ origin_kind: "partner_merchant", reward_eligible: true, indicator_profile_id: "x", source: "partner_merchant_referral" }), false)
  })
  it("formulário público não aceita partner_id nem reward", () => {
    assert.equal(rejectForbiddenPublicKeys({ name: "Ana", partnerId: "x" }), true)
    assert.equal(rejectForbiddenPublicKeys({ name: "Ana", reward_eligible: true }), true)
    assert.equal(rejectForbiddenPublicKeys({ name: "Ana", consent: true }), false)
  })
})

describe("3.1F-J9 permissões", () => {
  it("isola master, financeiro, comercial, consulta e funcionário", () => {
    assert.equal(canPerform(capabilityForRole("admin_master"), "manage_merchant"), true)
    assert.equal(canPerform(capabilityForRole("admin_financeiro"), "save_rule"), true)
    assert.equal(canPerform(capabilityForRole("admin_financeiro"), "issue_link"), false)
    assert.equal(canPerform(capabilityForRole("comercial"), "view_operational"), true)
    assert.equal(canPerform(capabilityForRole("comercial"), "view_financial"), false)
    assert.equal(canPerform(capabilityForRole("admin_consulta"), "view_financial"), false)
    assert.equal(canPerform(capabilityForRole("funcionario"), "view_operational"), false)
  })
  it("log não guarda token nem telefone", () => {
    const redacted = redactForLog({ token: "abc", phone: "11999999999", status: "active", url: "https://crm.tantotelecom.com.br/parceiro/abcdefghijklmnopqrstuvwxyz0123456789abc" })
    assert.equal((redacted as { token: string }).token, "[redacted]")
    assert.equal((redacted as { phone: string }).phone, "[redacted]")
    assert.equal((redacted as { status: string }).status, "active")
  })
})

describe("3.1F-J9 formulário responsivo", () => {
  it("não mostra comissão e cabe em 360px", () => {
    const src = readFileSync("components/partner-merchants/public-form.tsx", "utf8")
    assert.match(src, /max-w-lg/)
    assert.match(src, /px-4/)
    assert.match(src, /Indicação enviada por:/)
    assert.equal(/comiss[aã]o|dados banc|R\$\s*30|R\$\s*50/i.test(src), false)
    assert.match(src, /if \(submittingRef\.current\) return/)
  })
})
