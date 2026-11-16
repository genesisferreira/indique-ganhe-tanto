import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const form = readFileSync("components/referral-share/public-form.tsx", "utf8")
const catalog = readFileSync("lib/referral-share/public-catalog.ts", "utf8")
const sql = readFileSync("supabase/patch-referral-share-form-3-1f-j12.sql", "utf8")
const route = readFileSync("app/api/public/indicacao/submit/route.ts", "utf8")
const partnerPage = readFileSync("app/parceiro/[token]/page.tsx", "utf8")
const pipeline = readFileSync("lib/services/pipeline.service.ts", "utf8")
const card = readFileSync("components/referral/referral-interested-fields.tsx", "utf8")

const labels = [
  "Plano 400 Mega com linha fixa",
  "Banda Larga Corporativa",
  "Internet Empresarial",
  "500 Mega",
  "1000 Mega",
]

describe("3.1F-J12 formulário público", () => {
  it("mostra o documento obrigatório e as cinco opções, nesta ordem", () => {
    let cursor = 0
    for (const label of labels) {
      const at = catalog.indexOf(label)
      assert.ok(at > cursor, label)
      cursor = at
      assert.match(sql, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    }
    assert.match(form, /CPF ou CNPJ/)
    assert.match(form, /Digite o CPF ou CNPJ/)
    assert.match(form, /Informe um CPF ou CNPJ válido\./)
    assert.match(form, /consultar a disponibilidade e entrar em contato/)
    assert.match(form, /referralDocumentDigits/)
    assert.match(form, /REFERRAL_SHARE_PLANS\.map/)
    assert.doesNotMatch(form, /Documento \(opcional\)|300 Mega|Plano Link/)
    assert.match(catalog, /isValidCpfDigits/)
    assert.match(catalog, /isValidCnpjDigits/)
    assert.equal(sql.includes("(\\d)\\1+"), true)
    assert.match(sql, /invalid_document/)
    assert.match(sql, /invalid_plan/)
    assert.match(sql, /public_offer_name/)
    assert.doesNotMatch(sql, /insert into public\.plans|raise notice|raise log/i)
    assert.doesNotMatch(route, /console\.(log|info|debug|warn)\(/)
    assert.match(route, /planCode/)
    assert.doesNotMatch(route, /"planId"/)
    assert.match(partnerPage, /ReferralSharePublicForm/)
    assert.match(pipeline, /public_offer_name/)
    assert.match(card, /\*\*\*\.\*\*\*-/)
    assert.doesNotMatch(card, /\$\{d\.slice\(0, 3\)\}\.\$\{d\.slice\(3, 6\)\}/)
  })
})
