import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildControllrClientDateBirthField,
  formatControllrBirthDate,
  resolveControllrClientDateBirthForPayload,
} from "@/lib/brbyte/normalize-controllr-text"
import {
  buildSanitizedControllrHttpDiagnostics,
  inspectCreateInterestFormRisks,
  listOmittedEmptyFields,
} from "@/lib/brbyte/http-error-diagnostics"
import { BRBYTE_API_PATHS } from "@/types/brbyte"
import { splitPersonName } from "@/lib/brbyte/split-name"

/** Espelha o shape do form Controllr após a correção 1.1B (sem DB/ERP). */
function buildSampleCreateInterestPayload(input: {
  referredBirthDate?: string | null
  email?: string
  complement?: string
}): Record<string, string> {
  const name = splitPersonName("JOÃO SILVA")
  const birthField = buildControllrClientDateBirthField(input.referredBirthDate)
  return {
    lead_pk: "10",
    interest_status: "1",
    interest_type: "0",
    interest_name: name.firstName,
    interest_lastname: name.lastName,
    interest_doc1: "12345678909",
    interest_doc2: "MG123",
    interest_phone_number: "31999998888",
    interest_email_addr: input.email ?? "cliente@example.com",
    interest_addr_zipcode: "30130000",
    interest_addr_state: "MG",
    interest_addr_city: "BELO HORIZONTE",
    interest_addr_neighborhood: "CENTRO",
    interest_addr_address: "RUA DAS FLORES",
    interest_addr_number: "100",
    interest_addr_obs: input.complement ?? "",
    ...birthField,
    plan_pk: "99",
    interest_obs: "ORIGEM: INDIQUE E GANHE",
  }
}

describe("Sprint 1.1B — client_date_birth Controllr", () => {
  it("1) 1990-05-21 → 21/05/1990", () => {
    assert.equal(formatControllrBirthDate("1990-05-21"), "21/05/1990")
    assert.deepEqual(resolveControllrClientDateBirthForPayload("1990-05-21"), {
      value: "21/05/1990",
      status: "iso_converted",
    })
  })

  it("2) 2020-01-09 → 09/01/2020", () => {
    assert.equal(formatControllrBirthDate("2020-01-09"), "09/01/2020")
    assert.equal(
      resolveControllrClientDateBirthForPayload("2020-01-09").value,
      "09/01/2020"
    )
  })

  it("3) data já em DD/MM/YYYY não é corrompida", () => {
    assert.deepEqual(
      resolveControllrClientDateBirthForPayload("21/05/1990"),
      { value: "21/05/1990", status: "br_passthrough" }
    )
  })

  it("4) string vazia omite o campo", () => {
    assert.deepEqual(resolveControllrClientDateBirthForPayload(""), {
      value: null,
      status: "omitted",
    })
    assert.deepEqual(buildControllrClientDateBirthField(""), {})
  })

  it("5) null omite o campo", () => {
    assert.deepEqual(resolveControllrClientDateBirthForPayload(null), {
      value: null,
      status: "omitted",
    })
    assert.deepEqual(buildControllrClientDateBirthField(null), {})
  })

  it("6) undefined omite o campo", () => {
    assert.deepEqual(resolveControllrClientDateBirthForPayload(undefined), {
      value: null,
      status: "omitted",
    })
    assert.deepEqual(buildControllrClientDateBirthField(undefined), {})
  })

  it("7) data inválida omite sem inventar default", () => {
    assert.deepEqual(resolveControllrClientDateBirthForPayload("1990-13-40"), {
      value: null,
      status: "invalid",
    })
    assert.deepEqual(resolveControllrClientDateBirthForPayload("nao-e-data"), {
      value: null,
      status: "invalid",
    })
    assert.deepEqual(resolveControllrClientDateBirthForPayload("31/02/2020"), {
      value: null,
      status: "invalid",
    })
    assert.deepEqual(buildControllrClientDateBirthField("1990-13-40"), {})
  })

  it("8) payload final do create-interest usa DD/MM/YYYY", () => {
    const dbIso = "1990-05-21"
    const payload = buildSampleCreateInterestPayload({
      referredBirthDate: dbIso,
    })
    assert.equal(payload.client_date_birth, "21/05/1990")
    assert.notEqual(payload.client_date_birth, dbIso)
  })

  it("9) domínio/banco permanece em ISO (valor de entrada inalterado)", () => {
    const dbValue = "1990-05-21"
    const before = dbValue
    resolveControllrClientDateBirthForPayload(dbValue)
    assert.equal(dbValue, before)
    assert.equal(dbValue, "1990-05-21")
  })

  it("10) log sanitizado não contém a data completa", () => {
    const diagnostics = buildSanitizedControllrHttpDiagnostics({
      path: BRBYTE_API_PATHS.createClientInterest,
      status: 400,
      fields: buildSampleCreateInterestPayload({
        referredBirthDate: "1990-05-21",
      }),
      bodyText:
        'Data inválida client_date_birth=1990-05-21 ou 21/05/1990',
      json: {
        message: "Data inválida client_date_birth=1990-05-21 ou 21/05/1990",
      },
    })
    assert.ok(diagnostics.responseMessageHint)
    assert.ok(!diagnostics.responseMessageHint?.includes("1990-05-21"))
    assert.ok(!diagnostics.responseMessageHint?.includes("21/05/1990"))
    assert.ok(diagnostics.responseMessageHint?.includes("[date]"))
  })

  it("11) client_date_birth enviado no formato esperado (BR)", () => {
    const field = buildControllrClientDateBirthField("2020-01-09")
    assert.deepEqual(field, { client_date_birth: "09/01/2020" })
    const risks = inspectCreateInterestFormRisks({
      ...buildSampleCreateInterestPayload({ referredBirthDate: "2020-01-09" }),
    })
    assert.equal(
      risks.some((r) => r.code === "birth_date_iso_not_br"),
      false
    )
  })

  it("12) demais campos do payload permanecem intactos", () => {
    const withoutBirth = buildSampleCreateInterestPayload({
      referredBirthDate: null,
    })
    const withBirth = buildSampleCreateInterestPayload({
      referredBirthDate: "1990-05-21",
    })
    const { client_date_birth: _a, ...restWithout } = withoutBirth
    const { client_date_birth: _b, ...restWith } = withBirth
    assert.deepEqual(restWith, restWithout)
    assert.equal(withBirth.lead_pk, withoutBirth.lead_pk)
    assert.equal(withBirth.plan_pk, withoutBirth.plan_pk)
    assert.equal(withBirth.interest_obs, withoutBirth.interest_obs)
  })

  it("regressão HTTP 400 simulado: ISO no payload ainda é flagado; BR não", () => {
    const legacyIsoPayload = {
      ...buildSampleCreateInterestPayload({ referredBirthDate: null }),
      client_date_birth: "1990-05-21",
    }
    const fixedPayload = buildSampleCreateInterestPayload({
      referredBirthDate: "1990-05-21",
    })

    assert.ok(
      inspectCreateInterestFormRisks(legacyIsoPayload).some(
        (r) => r.code === "birth_date_iso_not_br"
      )
    )
    assert.equal(
      inspectCreateInterestFormRisks(fixedPayload).some(
        (r) => r.code === "birth_date_iso_not_br"
      ),
      false
    )

    const simulated400 = buildSanitizedControllrHttpDiagnostics({
      path: BRBYTE_API_PATHS.createClientInterest,
      status: 400,
      fields: legacyIsoPayload,
      json: { success: false, message: "Invalid date" },
      bodyText: '{"success":false,"message":"Invalid date"}',
    })
    assert.equal(simulated400.errorClass, "bad_request")
    assert.equal(simulated400.status, 400)
  })
})

describe("Sprint 1.1B — campos vazios (somente documentação/comportamento)", () => {
  it("mantém omissão de strings vazias sem alteração global", () => {
    const form = buildSampleCreateInterestPayload({
      referredBirthDate: "1990-05-21",
      email: "",
      complement: "",
    })
    const omitted = listOmittedEmptyFields(form)
    assert.ok(omitted.includes("interest_email_addr"))
    assert.ok(omitted.includes("interest_addr_obs"))
    assert.equal(omitted.includes("client_date_birth"), false)
  })
})
