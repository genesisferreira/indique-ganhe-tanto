import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ACTIVE_CONTRACT_STATUS,
  FIRST_INVOICE_VALUE_COMMISSION_ENABLED,
  INDICATOR_FULL_AMOUNT_MATCH_REQUIRED,
  INDICATOR_PAYMENT_RULE,
  INVOICE_EQUAL_OPER,
  INVOICE_IS_OPER,
  INVOICE_PAID_AMOUNT_USED_FOR_REWARD,
  PARTIAL_PAYMENT_BLOCKS_REWARD,
  PERCENTAGE_COMMISSION_ENABLED,
  REWARD_AMOUNT_SOURCE,
  buildOfficialContractWhere,
  buildOfficialInvoiceWhere,
  classifyTransport,
  creditDateProvesIndicatorPayment,
  fixedCommissionMayAccrue,
  selectActiveContract,
  selectFirstInvoice,
} from "./controllr-automation-rules"

const client = "10"
const contract = "20"

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    invoice_pk: 3,
    contract_pk: 20,
    client_pk: 10,
    invoice_deleted: false,
    invoice_date_document: "2026-01-02 10:00:00.000",
    invoice_date_credit: "2026-02-02 10:00:00",
    invoice_amount_document: 100,
    invoice_amount_paid: 100,
    ...overrides,
  }
}

describe("filtro oficial", () => {
  it("usa operador 5 nos pks e operador 7 só em invoice_deleted false", () => {
    const where = buildOfficialInvoiceWhere(client, contract)
    assert.deepEqual(where[0], { field: "client.client_pk", oper: INVOICE_EQUAL_OPER, value: 10 })
    assert.deepEqual(where[2], { field: "invoice.contract_pk", oper: INVOICE_EQUAL_OPER, value: 20 })
    assert.deepEqual(where[4], { field: "invoice_deleted", oper: INVOICE_IS_OPER, value: false })
    assert.equal(JSON.stringify(where).includes('"oper":7,"value":20'), false)
    const contractWhere = buildOfficialContractWhere(client)
    assert.deepEqual(contractWhere, [
      { field: "client.client_pk", oper: INVOICE_EQUAL_OPER, value: 10 },
    ])
    assert.equal(JSON.stringify(contractWhere).includes('"oper":7'), false)
  })
})

describe("contrato", () => {
  it("aceita somente status 0 não excluído do cliente", () => {
    const found = selectActiveContract(
      [{ client_pk: 10, contract_pk: 20, contract_status: ACTIVE_CONTRACT_STATUS, contract_deleted: false }],
      client
    )
    assert.equal(found.status, "found")
  })

  it("exclui contrato removido e status diferente de zero", () => {
    assert.equal(
      selectActiveContract(
        [{ client_pk: 10, contract_pk: 20, contract_status: 0, contract_deleted: true }],
        client
      ).status,
      "none"
    )
    assert.equal(
      selectActiveContract(
        [{ client_pk: 10, contract_pk: 20, contract_status: 1, contract_deleted: false }],
        client
      ).status,
      "none"
    )
  })

  it("dois contratos ativos ficam ambíguos", () => {
    assert.equal(
      selectActiveContract(
        [
          { client_pk: 10, contract_pk: 20, contract_status: 0, contract_deleted: false },
          { client_pk: 10, contract_pk: 21, contract_status: 0, contract_deleted: false },
        ],
        client
      ).status,
      "ambiguous"
    )
  })
})

describe("fatura", () => {
  it("ordena por data do documento e desempata por invoice_pk", () => {
    const first = selectFirstInvoice(
      [
        invoice({ invoice_pk: 1, invoice_date_document: "2026-03-01 00:00:00.000" }),
        invoice({ invoice_pk: 9, invoice_date_document: "2026-01-01 00:00:00.000" }),
        invoice({ invoice_pk: 4, invoice_date_document: "2026-01-01 00:00:00.000" }),
      ],
      { clientPk: client, contractPk: contract }
    )
    assert.equal(first?.invoicePk, "4")
  })

  it("descarta outro contrato, outro cliente, excluída, pk inválido e data inválida", () => {
    const first = selectFirstInvoice(
      [
        invoice({ contract_pk: 99 }),
        invoice({ client_pk: 99 }),
        invoice({ invoice_deleted: true, invoice_pk: 1, invoice_date_document: "2026-01-01 00:00:00.000" }),
        invoice({ invoice_pk: 0 }),
        invoice({ invoice_pk: 2, invoice_date_document: "2026-13-01 00:00:00.000" }),
        invoice({ invoice_pk: 8 }),
      ],
      { clientPk: client, contractPk: contract }
    )
    assert.equal(first?.invoicePk, "8")
  })

  it("resposta vazia não escolhe fatura", () => {
    assert.equal(selectFirstInvoice([], { clientPk: client, contractPk: contract }), null)
  })
})

describe("crédito do indicador", () => {
  it("crédito válido paga com valor integral, parcial, zero ou ausente", () => {
    for (const paid of [100, 70, 0, null, undefined]) {
      assert.equal(
        creditDateProvesIndicatorPayment("2026-02-02 10:00:00"),
        true,
        String(paid)
      )
    }
    assert.equal(creditDateProvesIndicatorPayment(""), false)
    assert.equal(creditDateProvesIndicatorPayment("2026-02-31 10:00:00"), false)
    assert.equal(INDICATOR_PAYMENT_RULE, "invoice_date_credit_present")
    assert.equal(INDICATOR_FULL_AMOUNT_MATCH_REQUIRED, false)
    assert.equal(PARTIAL_PAYMENT_BLOCKS_REWARD, false)
    assert.equal(REWARD_AMOUNT_SOURCE, "program_plan_rule")
    assert.equal(INVOICE_PAID_AMOUNT_USED_FOR_REWARD, false)
  })
})

describe("transporte e comissão", () => {
  it("timeout e resposta malformada não significam pagamento", () => {
    assert.equal(classifyTransport({ httpStatus: null, timedOut: true, malformed: false }), "inconclusive")
    assert.equal(classifyTransport({ httpStatus: 200, timedOut: false, malformed: true }), "inconclusive")
    assert.equal(classifyTransport({ httpStatus: 500, timedOut: false, malformed: false }), "inconclusive")
  })

  it("comissão fixa não exige pagamento e modalidades percentuais ficam bloqueadas", () => {
    assert.equal(
      fixedCommissionMayAccrue({
        origin: "employee",
        activeContract: true,
        validInvoice: true,
        entitlementExists: false,
        fixedRuleActive: true,
        method: "fixed_amount",
      }),
      true
    )
    assert.equal(
      fixedCommissionMayAccrue({
        origin: "partner",
        activeContract: true,
        validInvoice: true,
        entitlementExists: true,
        fixedRuleActive: true,
        method: "fixed_amount",
      }),
      false
    )
    assert.equal(
      fixedCommissionMayAccrue({
        origin: "indicator",
        activeContract: true,
        validInvoice: true,
        entitlementExists: false,
        fixedRuleActive: true,
        method: "fixed_amount",
      }),
      false
    )
    assert.equal(PERCENTAGE_COMMISSION_ENABLED, false)
    assert.equal(FIRST_INVOICE_VALUE_COMMISSION_ENABLED, false)
    assert.equal(
      fixedCommissionMayAccrue({
        origin: "employee",
        activeContract: true,
        validInvoice: true,
        entitlementExists: false,
        fixedRuleActive: true,
        method: "percentage",
      }),
      false
    )
    assert.equal(
      fixedCommissionMayAccrue({
        origin: "employee",
        activeContract: true,
        validInvoice: true,
        entitlementExists: false,
        fixedRuleActive: true,
        method: "first_invoice_value",
      }),
      false
    )
  })
})
