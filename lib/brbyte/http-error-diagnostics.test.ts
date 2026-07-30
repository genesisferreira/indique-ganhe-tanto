import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildSanitizedControllrHttpDiagnostics,
  classifyControllrHttpStatus,
  detectBirthDateFormat,
  inspectCreateInterestFormRisks,
  inventoryFormFields,
  listOmittedEmptyFields,
  resolveControllrClientErrorMessage,
} from "@/lib/brbyte/http-error-diagnostics"
import { BRBYTE_API_PATHS } from "@/types/brbyte"
import { formatControllrBirthDate } from "@/lib/brbyte/normalize-controllr-text"
import { splitPersonName } from "@/lib/brbyte/split-name"

/** Replica o shape enviado por buildCreateInterestForm (sem DB/ERP). */
function sampleCreateInterestForm(overrides: Record<string, string> = {}) {
  const name = splitPersonName("JOÃO SILVA")
  return {
    lead_pk: "10",
    interest_status: "1",
    interest_type: "0",
    interest_name: name.firstName,
    interest_lastname: name.lastName,
    interest_doc1: "12345678909",
    interest_doc2: "MG123",
    interest_phone_number: "31999998888",
    interest_email_addr: "cliente@example.com",
    interest_addr_zipcode: "30130000",
    interest_addr_state: "MG",
    interest_addr_city: "BELO HORIZONTE",
    interest_addr_neighborhood: "CENTRO",
    interest_addr_address: "RUA DAS FLORES",
    interest_addr_number: "100",
    interest_addr_obs: "",
    client_date_birth: "1990-05-20",
    plan_pk: "99",
    interest_obs: "ORIGEM: INDIQUE E GANHE",
    ...overrides,
  }
}

describe("classificação HTTP Controllr", () => {
  it("classifica 400 como bad_request", () => {
    assert.equal(classifyControllrHttpStatus(400), "bad_request")
  })

  it("classifica null como network_or_unknown", () => {
    assert.equal(classifyControllrHttpStatus(null), "network_or_unknown")
  })
})

describe("formato de nascimento vs Controllr", () => {
  it("detecta ISO residual no payload (regressão)", () => {
    assert.equal(detectBirthDateFormat("1990-05-20"), "iso")
  })

  it("detecta formato BR usado em formatControllrBirthDate", () => {
    const br = formatControllrBirthDate("1990-05-20")
    assert.equal(br, "20/05/1990")
    assert.equal(detectBirthDateFormat(br), "br")
  })

  it("marca risco high quando client_date_birth ainda está em ISO", () => {
    const risks = inspectCreateInterestFormRisks(sampleCreateInterestForm())
    const birthRisk = risks.find((r) => r.code === "birth_date_iso_not_br")
    assert.ok(birthRisk)
    assert.equal(birthRisk?.severity, "high")
  })

  it("não marca risco de ISO quando já está em DD/MM/YYYY", () => {
    const risks = inspectCreateInterestFormRisks(
      sampleCreateInterestForm({ client_date_birth: "20/05/1990" })
    )
    assert.equal(
      risks.some((r) => r.code === "birth_date_iso_not_br"),
      false
    )
  })
})

describe("omissão de campos vazios (admin-http)", () => {
  it("lista campos que seriam removidos do POST", () => {
    const form = sampleCreateInterestForm({
      interest_addr_obs: "",
      interest_email_addr: "",
    })
    const omitted = listOmittedEmptyFields(form)
    assert.ok(omitted.includes("interest_addr_obs"))
    assert.ok(omitted.includes("interest_email_addr"))
  })

  it("inventário marca presença sem expor valores", () => {
    const inv = inventoryFormFields(
      sampleCreateInterestForm({ interest_email_addr: "" })
    )
    const email = inv.find((f) => f.key === "interest_email_addr")
    assert.equal(email?.present, true)
    assert.equal(email?.empty, true)
    assert.equal(email?.length, 0)
    assert.ok(!JSON.stringify(inv).includes("cliente@"))
  })
})

describe("diagnóstico sanitizado de HTTP 400", () => {
  it("extrai message do ERP sem expor CPF/e-mail", () => {
    const diagnostics = buildSanitizedControllrHttpDiagnostics({
      path: BRBYTE_API_PATHS.createClientInterest,
      status: 400,
      fields: sampleCreateInterestForm(),
      bodyText: JSON.stringify({
        success: false,
        message: "Data inválida para CPF 123.456.789-09 email cliente@x.com",
      }),
      json: {
        success: false,
        message: "Data inválida para CPF 123.456.789-09 email cliente@x.com",
      },
    })

    assert.equal(diagnostics.errorClass, "bad_request")
    assert.equal(diagnostics.path, BRBYTE_API_PATHS.createClientInterest)
    assert.ok(diagnostics.responseMessageHint)
    assert.ok(!diagnostics.responseMessageHint?.includes("123.456.789-09"))
    assert.ok(!diagnostics.responseMessageHint?.includes("cliente@"))
    assert.ok(diagnostics.fieldKeysSent.includes("client_date_birth"))
  })

  it("quando corpo não tem message, monta hint genérico", () => {
    const diagnostics = buildSanitizedControllrHttpDiagnostics({
      path: BRBYTE_API_PATHS.createClientInterest,
      status: 400,
      fields: sampleCreateInterestForm(),
      bodyText: "",
      json: null,
    })
    const msg = resolveControllrClientErrorMessage(diagnostics)
    assert.match(msg, /HTTP 400/)
    assert.match(msg, /client_interest\/create/)
  })

  it("simula falha de create interest sem chamada real", () => {
    const form = sampleCreateInterestForm()
    const risks = inspectCreateInterestFormRisks(form)
    const simulatedErp = {
      ok: false as const,
      status: 400,
      json: { success: false, message: "Invalid client_date_birth" },
      message: "HTTP 400",
      diagnostics: buildSanitizedControllrHttpDiagnostics({
        path: BRBYTE_API_PATHS.createClientInterest,
        status: 400,
        fields: form,
        bodyText: '{"success":false,"message":"Invalid client_date_birth"}',
        json: { success: false, message: "Invalid client_date_birth" },
      }),
    }

    assert.equal(simulatedErp.status, 400)
    assert.ok(risks.some((r) => r.code === "birth_date_iso_not_br"))
    assert.equal(
      simulatedErp.diagnostics.responseMessageHint,
      "Invalid client_date_birth"
    )
  })
})

describe("mapa de endpoints Controllr usados pelo CRM", () => {
  it("expõe create/list/invoice paths esperados", () => {
    assert.equal(
      BRBYTE_API_PATHS.createClientInterest,
      "/controllrctl/client_interest/create"
    )
    assert.equal(
      BRBYTE_API_PATHS.listClientInterest,
      "/controllrctl/client_interest/list"
    )
    assert.equal(BRBYTE_API_PATHS.invoiceList, "/invoice_ctl/invoice/list")
    assert.equal(
      BRBYTE_API_PATHS.invoiceListInfo,
      "/invoice_ctl/invoice/list_info"
    )
  })
})
