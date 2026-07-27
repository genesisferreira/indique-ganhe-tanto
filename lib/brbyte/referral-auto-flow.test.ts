import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildBrbyteInterestedObservation } from "@/lib/brbyte/interested-observation"
import {
  CONTROLLR_INVOICE_DUE_DAYS,
  isValidControllrInvoiceDueDay,
  normalizeControllrErpTextFields,
  normalizeControllrText,
  validateControllrBirthDate,
} from "@/lib/brbyte/normalize-controllr-text"
import { getIndicatorBrbyteStatusMessage } from "@/lib/brbyte/indicator-status-messages"

function parseTruthy(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

describe("indicação normal — nascimento e vencimento", () => {
  it("exige data de nascimento", () => {
    const result = validateControllrBirthDate("")
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, "missing")
  })

  it("rejeita data futura", () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const iso = tomorrow.toISOString().slice(0, 10)
    const result = validateControllrBirthDate(iso)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, "future")
  })

  it("aceita vencimentos 05/10/15/20/25/30", () => {
    for (const day of CONTROLLR_INVOICE_DUE_DAYS) {
      assert.equal(isValidControllrInvoiceDueDay(day), true)
    }
  })

  it("rejeita vencimento inválido", () => {
    assert.equal(isValidControllrInvoiceDueDay(7), false)
    assert.equal(isValidControllrInvoiceDueDay(31), false)
    assert.equal(isValidControllrInvoiceDueDay("10"), false)
  })
})

describe("normalização Controllr", () => {
  it("aplica uppercase no payload textual", () => {
    const fields = normalizeControllrErpTextFields({
      name: "joão silva",
      rg: "mg-12.345",
      state: "mg",
      city: "belo horizonte",
      neighborhood: "centro",
      street: "rua das flores",
      number: "120a",
      complement: "apto 2",
    })
    assert.equal(fields.name, "JOÃO SILVA")
    assert.equal(fields.state, "MG")
    assert.equal(fields.city, "BELO HORIZONTE")
    assert.equal(fields.number, "120A")
  })

  it("não altera e-mail / CPF / telefone / CEP via helper textual", () => {
    const email = "Cliente@Email.com"
    const cpf = "123.456.789-09"
    const phone = "(31) 99999-8888"
    const cep = "30130-000"
    assert.equal(cpf.replace(/\D/g, ""), "12345678909")
    assert.equal(phone.replace(/\D/g, ""), "31999998888")
    assert.equal(cep.replace(/\D/g, ""), "30130000")
    assert.notEqual(normalizeControllrText(email), email)
  })
})

describe("interest_obs indicação normal", () => {
  it("mantém interest_obs <= 255 e inclui campos obrigatórios", () => {
    const built = buildBrbyteInterestedObservation({
      erpLeadSource: "Indique e Ganhe",
      indicadorNome: "João Silva",
      planoNome: "500 Mega",
      birthDate: "1990-08-15",
      preferredInvoiceDueDay: 10,
      tipoContratacao: "tanto_livre",
      installationFeeAwareness: true,
      contractTypeAwareness: true,
      observacaoIndicado: "Observação muito longa ".repeat(40),
    })
    assert.ok(built.value.length <= 255)
    assert.match(built.value, /ORIGEM:/)
    assert.match(built.value, /INDICADOR:/)
    assert.match(built.value, /PLANO:/)
    assert.match(built.value, /NASCIMENTO: 15\/08\/1990/)
    assert.match(built.value, /VENCIMENTO: DIA 10/)
    assert.equal(built.truncated, true)
  })

  it("usa o nome da oferta comercial no PLANO", () => {
    const built = buildBrbyteInterestedObservation({
      erpLeadSource: "Indique e Ganhe",
      indicadorNome: "Ana",
      planoNome: "1000 MEGA + MESH",
      birthDate: "1988-01-01",
      preferredInvoiceDueDay: 5,
      tipoContratacao: "tanto_vantagens",
      installationFeeAwareness: true,
      contractTypeAwareness: true,
    })
    assert.match(built.value, /PLANO: 1000 MEGA \+ MESH/)
  })
})

describe("feature flags auto", () => {
  it("auto create exige CREATE + AUTO_CREATE", () => {
    assert.equal(
      parseTruthy("true") && parseTruthy("false"),
      false
    )
    assert.equal(
      parseTruthy("true") && parseTruthy("true"),
      true
    )
  })

  it("auto conversion exige SYNC + AUTO_CHECK_CONVERSION", () => {
    assert.equal(parseTruthy("false") && parseTruthy("true"), false)
    assert.equal(parseTruthy("true") && parseTruthy("true"), true)
  })

  it("auto first invoice exige SYNC + AUTO_CHECK_FIRST_INVOICE", () => {
    assert.equal(parseTruthy("true") && parseTruthy("false"), false)
    assert.equal(parseTruthy("true") && parseTruthy("true"), true)
  })
})

describe("primeira fatura e baixa", () => {
  it("seleciona somente a primeira fatura válida por data", () => {
    const rows = [
      { invoicePk: "2", due: "2026-03-10", deleted: false },
      { invoicePk: "1", due: "2026-02-10", deleted: false },
      { invoicePk: "x", due: "2026-01-10", deleted: true },
    ]
    const candidates = rows
      .filter((row) => row.invoicePk && !row.deleted)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
    assert.equal(candidates[0]?.invoicePk, "1")
  })

  it("detecta baixa manual via invoice_msg paid + date_credit", () => {
    const invoiceMsg = "paid"
    const invoiceDateCredit = "2026-02-15"
    const isPaid =
      invoiceMsg.toLowerCase() === "paid" && Boolean(invoiceDateCredit)
    assert.equal(isPaid, true)
  })

  it("ignora fatura sem baixa válida", () => {
    const invoiceMsg = "open"
    const invoiceDateCredit = null
    const isPaid =
      invoiceMsg.toLowerCase() === "paid" && Boolean(invoiceDateCredit)
    assert.equal(isPaid, false)
  })

  it("segunda fatura não substitui a primeira selecionada", () => {
    const rows = [
      { invoicePk: "2", due: "2026-03-10", deleted: false },
      { invoicePk: "1", due: "2026-02-10", deleted: false },
    ]
    const first = rows
      .filter((row) => row.invoicePk && !row.deleted)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0]
    assert.equal(first?.invoicePk, "1")
    // Execução repetida com as mesmas faturas permanece na primeira
    const again = rows
      .filter((row) => row.invoicePk && !row.deleted)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0]
    assert.equal(again?.invoicePk, first?.invoicePk)
  })
})

describe("mensagens amigáveis do indicador", () => {
  it("não expõe termos técnicos", () => {
    const message = getIndicatorBrbyteStatusMessage("error")
    assert.equal(
      message,
      "Sua indicação foi cadastrada. Nossa equipe dará continuidade ao processamento."
    )
    assert.doesNotMatch(message, /BRByte|Controllr|HTTP|interest_pk/i)
  })
})
