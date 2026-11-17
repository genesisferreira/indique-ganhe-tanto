import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { buildControllrClientDateBirthField } from "../brbyte/normalize-controllr-text"
import { buildBrbyteInterestedObservation } from "../brbyte/interested-observation"
import {
  REFERRAL_SHARE_DUE_DAYS,
  REFERRAL_SHARE_DUE_DAY_LABEL,
  birthDateInputToIso,
  isReferralShareDueDay,
  maskBirthDateInput,
  referralShareBirthIssue,
} from "./public-catalog"

const form = readFileSync("components/referral-share/public-form.tsx", "utf8")
const sql = readFileSync("supabase/patch-referral-share-form-3-1f-j16.sql", "utf8")
const route = readFileSync("app/api/public/indicacao/submit/route.ts", "utf8")
const partnerRoute = readFileSync("app/api/public/parceiro/submit/route.ts", "utf8")
const domain = readFileSync("lib/partner-merchants/domain.ts", "utf8")
const service = readFileSync("lib/referral-share/service.ts", "utf8")
const creator = readFileSync("lib/brbyte/create-interest.service.ts", "utf8")
const dispatch = readFileSync("lib/referral-share/controllr-dispatch.ts", "utf8")
const indicacaoPage = readFileSync("app/indicacao/[token]/page.tsx", "utf8")
const partnerPage = readFileSync("app/parceiro/[token]/page.tsx", "utf8")

describe("3.1F-J16 formulário único", () => {
  it("valida nascimento e vencimento no mesmo contrato", () => {
    assert.equal(maskBirthDateInput("15031990"), "15/03/1990")
    assert.equal(birthDateInputToIso("15/03/1990"), "1990-03-15")
    assert.equal(referralShareBirthIssue("15/03/1990"), "ok")
    assert.equal(referralShareBirthIssue("29/02/2024"), "ok")
    assert.equal(referralShareBirthIssue(""), "empty")
    assert.equal(referralShareBirthIssue("31/02/2020"), "invalid")
    assert.equal(referralShareBirthIssue("29/02/2023"), "invalid")
    assert.equal(referralShareBirthIssue("01/01/2099"), "future")
    assert.deepEqual([...REFERRAL_SHARE_DUE_DAYS], [5, 10, 15, 20, 25, 30])
    for (const day of REFERRAL_SHARE_DUE_DAYS) assert.equal(isReferralShareDueDay(day), true)
    assert.equal(isReferralShareDueDay(7), false)
    assert.equal(isReferralShareDueDay(10.5), false)
    assert.equal(isReferralShareDueDay(Number.NaN), false)
  })

  it("usa um componente para indicador, técnico, vendedor e parceiro", () => {
    assert.match(indicacaoPage, /ReferralSharePublicForm/)
    assert.match(partnerPage, /ReferralSharePublicForm/)
    assert.match(form, /REFERRAL_SHARE_DUE_DAY_LABEL/)
    assert.equal(REFERRAL_SHARE_DUE_DAY_LABEL, "Melhor dia para vencimento da fatura")
    assert.match(form, /referralDocumentDigits\(document\)\?\.length === 14 \? null/)
    assert.match(form, /birthDate: company \? null/)
    assert.match(form, /preferredInvoiceDueDay: due/)
    assert.match(form, /placeholder="DD\/MM\/AAAA"/)
    assert.match(form, /px-4 py-6 sm:py-10/)
    assert.match(form, /max-w-lg/)
    assert.match(form, /className="w-full"/)
    assert.doesNotMatch(form, /console\.(log|info|debug|warn)\(/)
  })

  it("rejeita vencimento forjado e persiste os dois campos nas três origens", () => {
    assert.match(sql, /invalid_due_day/)
    assert.match(sql, /birth_date_invalid/)
    assert.match(sql, /birth_date_future/)
    assert.match(sql, /\^\(5\|10\|15\|20\|25\|30\)\$/)
    assert.equal((sql.match(/referred_birth_date, preferred_invoice_due_day/g) ?? []).length, 3)
    assert.match(sql, /coalesce\(v_birth, ''\), v_due::text/)
    assert.match(sql, /idempotency_conflict/)
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('igt\.j11\.idem:'/)
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('igt\.j11\.phone:'/)
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('igt\.j11\.doc:'/)
    assert.match(sql, /referral_share_link_usable/)
    assert.match(sql, /'unavailable'/)
    assert.match(sql, /where er\.attribution_role = v_link\.attribution_role/)
    assert.match(sql, /'referral_share_link', 'Indique e Ganhe', 'indicator'/)
    assert.match(sql, /'pix'::public\.reward_type, null, true/)
    assert.match(sql, /'employee_sales_opportunity', 'Oportunidade Funcionário', 'employee'/)
    assert.match(sql, /null, null, false, 'employee_sales_opportunity'/)
    assert.match(sql, /'partner_merchant_referral', 'Comércio Parceiro', 'partner_merchant'/)
    assert.match(sql, /null, null, false, 'partner_merchant_referral'/)
    assert.match(sql, /length\(v_document\) = 11 or v_birth is not null/)
    assert.doesNotMatch(sql, /alter table|set default/i)
    assert.doesNotMatch(sql, /raise (notice|log|warning)/i)
  })

  it("aceita os campos no contrato público sem registrar a data", () => {
    assert.match(route, /"birthDate", "preferredInvoiceDueDay"/)
    assert.match(domain, /"birthDate"/)
    assert.match(domain, /"preferredInvoiceDueDay"/)
    assert.match(partnerRoute, /PUBLIC_PAYLOAD_KEYS/)
    assert.match(service, /birth_date_invalid/)
    assert.match(service, /birth_date_future/)
    assert.match(service, /invalid_due_day/)
    assert.match(service, /Informe a data de nascimento\./)
    assert.match(service, /A data de nascimento não pode estar no futuro\./)
    assert.match(service, /code: error\.code \?\? null/)
    assert.doesNotMatch(service, /birthDate|referred_birth_date/)
    assert.match(creator, /referred_birth_date/)
    assert.match(creator, /preferred_invoice_due_day/)
    assert.match(creator, /client_date_birth_invalid/)
    assert.match(creator, /omit_from_payload/)
    assert.match(creator, /buildControllrClientDateBirthField\(row\.referred_birth_date\)/)
    assert.match(dispatch, /enqueueAutomaticInterestOperation/)
    assert.match(dispatch, /markInterestRetryable/)
    assert.deepEqual(buildControllrClientDateBirthField("1990-03-15"), { client_date_birth: "15/03/1990" })
    assert.equal(buildControllrClientDateBirthField(null).client_date_birth, undefined)
    const observation = buildBrbyteInterestedObservation({
      erpLeadSource: "Indique e Ganhe",
      indicadorNome: "Origem sintética",
      tipoContratacao: "Pessoa física",
      planoNome: "500 Mega",
      birthDate: "1990-03-15",
      preferredInvoiceDueDay: 10,
      observacaoIndicado: null,
    })
    assert.match(observation.value, /NASCIMENTO: 15\/03\/1990/)
    assert.match(observation.value, /VENCIMENTO: DIA 10/)
  })
})
