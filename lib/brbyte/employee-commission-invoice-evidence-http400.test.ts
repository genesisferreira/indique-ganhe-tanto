/**
 * Sprint 3.1F-H5R — reproduz localmente o HTTP 400 / PostgreSQL 42601 do probe
 * employee_commission_invoice_evidence (falha real: CRM 502 / ERP 400, hint 42601).
 *
 * Mock local do Controllr invoice/list: recebe form-urlencoded, interpreta `where`
 * (array de folhas {field, oper, value} unidas por {field:"AND"}) e traduz para a
 * semântica SQL documentada (wiki BrByte REST-HTTP: 1 <, 2 >, 3 <=, 4 >=, 5 =, 7 IS, 8 IS NOT).
 * `IS` só aceita NULL/TRUE/FALSE em PostgreSQL; qualquer outro literal é syntax_error 42601.
 *
 * O filtro substituto (contract_pk oper 5) NÃO está comprovado por fonte oficial ou
 * histórico live 200 → o mock o classifica como não comprovado (não aceita).
 * Sem rede, sem ERP real, sem banco, sem IDs reais. Valores abaixo são fictícios.
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  EMPLOYEE_EVIDENCE_ATTEMPTS,
  EMPLOYEE_EVIDENCE_MAX_ROWS,
  EMPLOYEE_EVIDENCE_MAX_TIMEOUT_MS,
  EMPLOYEE_EVIDENCE_OFFICIAL_ISSUE_DATE_FIELD,
  EMPLOYEE_EVIDENCE_SORT_DIR,
  EMPLOYEE_EVIDENCE_SORT_FIELD,
  buildEmployeeEvidenceFormFields,
  clampEmployeeEvidenceTimeoutMs,
  summarizeEmployeeEvidence,
} from "@/lib/brbyte/employee-commission-invoice-evidence-result"
import { buildOverdueInvoiceListWhere } from "@/lib/brbyte/overdue-invoice-list-query"
import { INVOICE_LIST_PROBE_WHERE_FILTERS } from "@/lib/brbyte/invoice-list-probe-result"

const FICTIONAL_CONTRACT_PK = "900000000001"
const FICTIONAL_INVOICE_PK = "900000000777"
const FICTIONAL_AMOUNT = 12345.67
const FICTIONAL_NAME = "Fulano Ficticio"

const OPER_SQL: Record<number, string> = { 1: "<", 2: ">", 3: "<=", 4: ">=", 5: "=", 7: "IS", 8: "IS NOT" }
const FORM_KEYS = ["dir", "limit", "page", "sort", "start", "where"]
/** Campos/operadores já usados em consultas que retornaram 200 (overdue keyset, Cobrança, DevTools). */
const LIVE_PROVEN_FILTERS = new Set([
  "invoice_deleted:7",
  "invoice_date_due:8",
  "invoice_date_credit:7",
  "invoice_date_due:1",
  "invoice_pk:2",
])
/** Combinações sem fonte oficial estática nem histórico live 200 (gate H5R). */
const NOT_PROVEN_FILTERS = new Set(["contract_pk:5"])
const SORTABLE = new Set(["invoice_pk"])

type MockResponse = { status: number; json: { success: boolean; code?: string; message?: string; data?: unknown[]; total?: number } }

function mockInvoiceList(body: string, contentType = "application/x-www-form-urlencoded"): MockResponse {
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return { status: 400, json: { success: false, code: "invalid_content_type", message: "bad request" } }
  }
  const form = new URLSearchParams(body)
  const keys = [...new Set([...form.keys()])].sort()
  if (keys.join(",") !== FORM_KEYS.join(",") || [...form.keys()].length !== FORM_KEYS.length) {
    return { status: 400, json: { success: false, code: "invalid_form_shape", message: "bad request" } }
  }
  if (!SORTABLE.has(form.get("sort") ?? "") || !["ASC", "DESC"].includes(form.get("dir") ?? "")) {
    return { status: 400, json: { success: false, code: "42703", message: "bad request" } }
  }
  let where: unknown
  try { where = JSON.parse(form.get("where") ?? "") } catch { return { status: 400, json: { success: false, code: "42601", message: "bad request" } } }
  if (!Array.isArray(where)) return { status: 400, json: { success: false, code: "42601", message: "bad request" } }
  const leaves: unknown[] = []
  const walk = (n: unknown) => (Array.isArray(n) ? n.forEach(walk) : leaves.push(n))
  walk(where)
  for (const leaf of leaves) {
    if (!leaf || typeof leaf !== "object") return { status: 400, json: { success: false, code: "42601", message: "bad request" } }
    const l = leaf as Record<string, unknown>
    if (l.field === "AND" && Object.keys(l).length === 1) continue
    const extra = Object.keys(l).filter((k) => !["field", "oper", "value"].includes(k))
    if (extra.length || typeof l.field !== "string" || typeof l.oper !== "number" || !OPER_SQL[l.oper]) {
      return { status: 400, json: { success: false, code: "42601", message: "bad request" } }
    }
    const op = OPER_SQL[l.oper]
    // Semântica PostgreSQL: IS / IS NOT só aceitam NULL, TRUE, FALSE → senão syntax_error 42601.
    if ((op === "IS" || op === "IS NOT") && !(l.value === null || typeof l.value === "boolean")) {
      return { status: 400, json: { success: false, code: "42601", message: "bad request" } }
    }
    const key = `${l.field}:${l.oper}`
    if (NOT_PROVEN_FILTERS.has(key)) {
      return { status: 400, json: { success: false, code: "not_proven_in_mock", message: "bad request" } }
    }
    if (!LIVE_PROVEN_FILTERS.has(key)) return { status: 400, json: { success: false, code: "42703", message: "bad request" } }
    if (l.field === "invoice_pk" && typeof l.value !== "number") return { status: 400, json: { success: false, code: "42883", message: "bad request" } }
  }
  return { status: 200, json: { success: true, data: [], total: 0 } }
}

function encode(fields: Record<string, string>): string {
  const b = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) b.set(k, v)
  return b.toString()
}

function okForm(where: unknown): Record<string, string> {
  return { where: JSON.stringify(where), page: "1", start: "0", limit: "15", sort: "invoice_pk", dir: "ASC" }
}

const FORBIDDEN_KEYS = new Set([
  "contractPk", "contract_pk_value", "invoicePk", "invoicePks", "payload", "raw", "rawPayload",
  "cookie", "token", "name", "customer_name", "cpf", "cnpj", "document", "phone", "address", "amount", "paidAmount",
])

/** Varredura recursiva: chaves proibidas + valores fictícios sensíveis. `fields` só pode ter estatísticas. */
function scanForbidden(value: unknown, path = "$"): string[] {
  const hits: string[] = []
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) hits.push(`${path}.${k}`)
      hits.push(...scanForbidden(v, `${path}.${k}`))
    }
  } else if (value != null) {
    const s = String(value)
    if (s.includes(FICTIONAL_CONTRACT_PK) || s.includes(FICTIONAL_INVOICE_PK) || s.includes(String(FICTIONAL_AMOUNT)) || s.includes(FICTIONAL_NAME)) {
      hits.push(`${path}=<sensitive>`)
    }
  }
  return hits
}

describe("3.1F-H5R causa do HTTP 400 (42601) — mock local", () => {
  it("1. builder atual (contract_pk oper 7 + número) reproduz 400/42601", () => {
    const fields = buildEmployeeEvidenceFormFields(FICTIONAL_CONTRACT_PK)
    assert.deepEqual(Object.keys(fields).sort(), FORM_KEYS)
    const where = JSON.parse(fields.where) as Array<Record<string, unknown>>
    const contractLeaf = where.find((l) => l.field === "contract_pk")
    assert.equal(contractLeaf?.oper, 7)
    assert.equal(typeof contractLeaf?.value, "number")
    const res = mockInvoiceList(encode(fields))
    assert.equal(res.status, 400)
    assert.equal(res.json.code, "42601")
    assert.doesNotMatch(JSON.stringify(res.json), new RegExp(FICTIONAL_CONTRACT_PK))
  })

  it("2. oper 7 + false em invoice_deleted é válido", () => {
    assert.equal(mockInvoiceList(encode(okForm([{ field: "invoice_deleted", oper: 7, value: false }]))).status, 200)
  })

  it("3. oper 7 + null em invoice_date_credit é válido", () => {
    assert.equal(mockInvoiceList(encode(okForm([{ field: "invoice_date_credit", oper: 7, value: null }]))).status, 200)
  })

  it("4. contract_pk oper 5 + número NÃO é aceito: filtro substituto não comprovado", () => {
    const res = mockInvoiceList(encode(okForm([
      { field: "contract_pk", oper: 5, value: Number(FICTIONAL_CONTRACT_PK) },
      { field: "AND" },
      { field: "invoice_deleted", oper: 7, value: false },
    ])))
    assert.equal(res.status, 400)
    assert.equal(res.json.code, "not_proven_in_mock")
  })

  it("5. campo não filtrável → 400", () => {
    assert.equal(mockInvoiceList(encode(okForm([{ field: "customer_free_text", oper: 1, value: "x" }]))).status, 400)
  })

  it("6. tipo incorreto → 400", () => {
    assert.equal(mockInvoiceList(encode(okForm([{ field: "invoice_pk", oper: 2, value: "abc" }]))).status, 400)
  })

  it("7. where malformado → 400/42601", () => {
    const f = okForm([])
    f.where = "{not json"
    const res = mockInvoiceList(encode(f))
    assert.equal(res.status, 400)
    assert.equal(res.json.code, "42601")
  })

  it("8. sort inválido → 400", () => {
    const f = okForm([{ field: "invoice_deleted", oper: 7, value: false }])
    f.sort = "invoice_date_issue"
    assert.equal(mockInvoiceList(encode(f)).status, 400)
  })

  it("content-type inválido → 400", () => {
    assert.equal(mockInvoiceList(encode(okForm([])), "application/json").status, 400)
  })

  it("where real de atrasados (já 200 ao vivo) passa no mock", () => {
    const where = buildOverdueInvoiceListWhere("2026-11-06", 1)
    assert.ok(where)
    assert.equal(mockInvoiceList(encode(okForm(where))).status, 200)
  })

  it("probe legado só usa oper 7 com booleano (DevTools) e oper 5 nunca com contract_pk", () => {
    for (const leaf of INVOICE_LIST_PROBE_WHERE_FILTERS as ReadonlyArray<Record<string, unknown>>) {
      if (leaf.oper === 7) assert.ok(leaf.value === null || typeof leaf.value === "boolean")
      assert.notEqual(leaf.field, "contract_pk")
    }
  })
})

describe("3.1F-H5R invariantes do probe sanitizado", () => {
  it("uma tentativa, timeout ≤ 70000, ≤ 15 linhas, sort invoice_pk ASC, emissão não comprovada", () => {
    assert.equal(EMPLOYEE_EVIDENCE_ATTEMPTS, 1)
    assert.equal(clampEmployeeEvidenceTimeoutMs(999_999), EMPLOYEE_EVIDENCE_MAX_TIMEOUT_MS)
    assert.equal(EMPLOYEE_EVIDENCE_MAX_TIMEOUT_MS, 70_000)
    assert.equal(EMPLOYEE_EVIDENCE_MAX_ROWS, 15)
    assert.equal(EMPLOYEE_EVIDENCE_SORT_FIELD, "invoice_pk")
    assert.equal(EMPLOYEE_EVIDENCE_SORT_DIR, "ASC")
    assert.equal(EMPLOYEE_EVIDENCE_OFFICIAL_ISSUE_DATE_FIELD, null)
  })

  it("HTTP 400 é classificado ERP_ERROR sem expor body", () => {
    const r = summarizeEmployeeEvidence({ contractPk: FICTIONAL_CONTRACT_PK, timeoutMs: 70000, durationMs: 1400, httpStatus: 400, json: null, transport: "error" })
    assert.equal(r.classification, "ERP_ERROR")
    assert.equal(r.attempts, 1)
    assert.equal(r.retryExecuted, false)
    assert.equal(r.rowCount, 0)
    assert.deepEqual(scanForbidden(r), [])
  })

  it("timeout sem retry e inconclusivo", () => {
    const r = summarizeEmployeeEvidence({ contractPk: FICTIONAL_CONTRACT_PK, timeoutMs: 70000, durationMs: 70000, httpStatus: null, json: null, transport: "timeout" })
    assert.equal(r.classification, "ERP_TIMEOUT_INCONCLUSIVE")
    assert.equal(r.retryExecuted, false)
    assert.equal(r.firstInvoiceOrderProven, false)
  })

  it("sucesso sanitizado: sem IDs/valores/PII; total>15 não prova cobertura; sem emissão não prova 1ª fatura", () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      invoice_pk: String(Number(FICTIONAL_INVOICE_PK) + i),
      contract_pk: FICTIONAL_CONTRACT_PK,
      invoice_deleted: false,
      invoice_amount: FICTIONAL_AMOUNT,
      invoice_amount_paid: i === 0 ? FICTIONAL_AMOUNT : undefined,
      invoice_msg: i === 1 ? "paid" : "open",
      invoice_date_credit: i === 0 ? "2026-10-01" : null,
      client_name: FICTIONAL_NAME,
    }))
    const r = summarizeEmployeeEvidence({ contractPk: FICTIONAL_CONTRACT_PK, timeoutMs: 70000, durationMs: 900, httpStatus: 200, json: { success: true, data: rows, total: 40 }, transport: "ok" })
    assert.deepEqual(scanForbidden(r), [])
    assert.equal(r.pageCoversContract, false)
    assert.equal(r.firstInvoiceOrderProven, false)
    // paid ausente não vira zero: campo não comprovado
    assert.equal(r.paidAmountFieldProven, false)
    assert.equal(r.fullPaymentDistinguishable, false)
    // msg "paid" sem crédito = conflito → inconclusivo
    assert.ok(r.paymentConflictCount > 0)
  })
})
