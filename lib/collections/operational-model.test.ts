import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import { decideConfirmedPrefixAdvance } from "@/lib/collections/discovery-prefix"
import {
  COLLECTIONS_ACTIVE_CONTRACT_CAPACITY,
  COLLECTIONS_CLIENT_IDENTITY_PROVEN,
  COLLECTIONS_CLIENT_PK_REQUIRED,
  CONTRACT_SCOPE_NOTICE,
  CUSTOMER_DEDUPLICATION_SCOPE,
  contractCardStates,
  classifyContractStatusForCollections,
  computeCapacity,
  contractBlockIndicator,
  decideContractCaseClosure,
  gateNextBatch,
  groupInvoicesByContract,
  parseProvenPk,
  paymentDetectedIdempotencyKey,
  planBatchSlots,
  type ContractInvoice,
} from "@/lib/collections/operational-model"

const now = new Date("2026-10-27T12:00:00Z")
const inv = (i: string, c: string, p: ContractInvoice["payment"] = "open", due = "2026-09-01"): ContractInvoice => ({
  invoicePk: i, contractPk: c, dueDate: due, daysOverdue: 20, payment: p,
})

describe("3.1E-AR identidade", () => {
  it("A/B/C pk válidos; D ausente; E tipo inválido → inconclusivo", () => {
    assert.equal(parseProvenPk("12"), "12")
    assert.equal(parseProvenPk(34), "34")
    assert.equal(parseProvenPk(null), null)
    assert.equal(parseProvenPk("abc"), null)
    assert.equal(parseProvenPk(1.5), null)
    assert.equal(parseProvenPk("0"), null)
    const g = groupInvoicesByContract([inv("1", "x"), { ...inv("2", "9"), invoicePk: "" }])
    assert.equal(g.inconclusive, 2)
    assert.equal(g.cases.length, 0)
  })
  it("client_pk não comprovado: escopo contract_only, client_pk não exigido", () => {
    assert.equal(COLLECTIONS_CLIENT_IDENTITY_PROVEN, false)
    assert.equal(COLLECTIONS_CLIENT_PK_REQUIRED, false)
    assert.equal(CUSTOMER_DEDUPLICATION_SCOPE, "contract_only")
    assert.equal(
      CONTRACT_SCOPE_NOTICE,
      "Os atendimentos são agrupados por contrato. Clientes com mais de um contrato podem aparecer em blocos separados."
    )
    assert.deepEqual(gateNextBatch({ available: 15, activeRun: false }), { ok: true, slots: 15 })
  })
})

describe("3.1E-AR agregação por contrato", () => {
  it("F três faturas mesmo contrato → um caso; I repetido sem efeito duplicado", () => {
    const g = groupInvoicesByContract([inv("3", "7"), inv("1", "7", "open", "2026-08-01"), inv("2", "7"), inv("2", "7")])
    assert.equal(g.cases.length, 1)
    assert.deepEqual(g.cases[0].invoices.map((i) => i.invoicePk), ["1", "2", "3"])
    assert.equal(g.cases[0].oldestDueDate, "2026-08-01")
  })
  it("dois contratos → dois casos", () => {
    assert.equal(groupInvoicesByContract([inv("1", "7"), inv("2", "8")]).cases.length, 2)
  })
})

describe("3.1E-AR status", () => {
  it("K 5 cancelado; L 4 elegível; 6/texto inconclusivo", () => {
    assert.equal(classifyContractStatusForCollections(5).kind, "cancelled_contract")
    assert.deepEqual(classifyContractStatusForCollections(4), { kind: "eligible", official: "bloqueado" })
    assert.equal(classifyContractStatusForCollections(6).kind, "inconclusive")
    assert.equal(classifyContractStatusForCollections("4").kind, "inconclusive")
  })
  it("M ≥15 sem status 4 → faixa de bloqueio, não bloqueio oficial", () => {
    assert.equal(contractBlockIndicator({ contractStatus: 1, daysOverdue: 15 }), "Em faixa de bloqueio")
    assert.equal(contractBlockIndicator({ contractStatus: 4, daysOverdue: 3 }), "Bloqueado no ERP")
    assert.equal(contractBlockIndicator({ contractStatus: 1, daysOverdue: 14 }), null)
  })
  it("N três faturas não implicam cancelamento", () => {
    const d = decideContractCaseClosure([inv("1", "7"), inv("2", "7"), inv("3", "7")])
    assert.equal(d.action, "keep_open")
  })
})

describe("3.1E-AR pagamento", () => {
  it("AG parcial mantém aberto; AH todas pagas fecham; AI ausência; AJ cancelamento", () => {
    assert.deepEqual(decideContractCaseClosure([inv("1", "7", "paid"), inv("2", "7"), inv("3", "7")]), { action: "keep_open", pending: 2 })
    assert.deepEqual(decideContractCaseClosure([inv("1", "7", "paid"), inv("2", "7", "paid")]), { action: "close_paid" })
    assert.equal(decideContractCaseClosure([inv("1", "7", "paid"), inv("2", "7", "absent")]).action, "keep_open")
    assert.equal(decideContractCaseClosure([inv("1", "7", "cancelled")]).action, "route_cancellation_flow")
    const g = groupInvoicesByContract([inv("1", "7", "paid"), inv("2", "7"), inv("3", "7")])
    assert.equal(g.cases[0].paidCount, 1)
    assert.equal(g.cases[0].openCount, 2)
  })
  it("AK payment_detected idempotente por fatura", () => {
    assert.equal(paymentDetectedIdempotencyKey("c", "1"), paymentDetectedIdempotencyKey("c", "1"))
    assert.notEqual(paymentDetectedIdempotencyKey("c", "1"), paymentDetectedIdempotencyKey("c", "2"))
  })
})

describe("3.1E-AU capacidade por contrato distinto", () => {
  it("G zero → 15; H dez → 5; I quinze → 0; nunca negativo", () => {
    assert.equal(COLLECTIONS_ACTIVE_CONTRACT_CAPACITY, 15)
    assert.equal(computeCapacity({ occupants: [], now }).available, 15)
    const ten = Array.from({ length: 10 }, (_, i) => ({ contractPk: String(i + 1), state: "open" as const }))
    assert.equal(computeCapacity({ occupants: ten, now }).available, 5)
    const fifteen = Array.from({ length: 15 }, (_, i) => ({ contractPk: String(i + 1), state: "open" as const }))
    assert.equal(computeCapacity({ occupants: fifteen, now }).available, 0)
    assert.deepEqual(gateNextBatch({ available: 0, activeRun: false }), { ok: false, code: "capacity_full" })
    const many = Array.from({ length: 20 }, (_, i) => ({ contractPk: String(i + 1), state: "open" as const }))
    assert.equal(computeCapacity({ occupants: many, now }).available, 0)
  })
  it("mesmo contrato não ocupa duas vagas; M promessa futura livre; N vencida ocupa", () => {
    const c = computeCapacity({ now, occupants: [
      { contractPk: "1", state: "open" }, { contractPk: "1", state: "in_contact" },
      { contractPk: "2", state: "promise", dueAt: "2026-11-01T00:00:00Z" },
      { contractPk: "3", state: "promise", dueAt: "2026-10-01T00:00:00Z" },
      { contractPk: "4", state: "paid" },
    ] })
    assert.equal(c.occupying, 2)
    assert.equal(c.futurePromises, 1)
  })
  it("capacidade cheia e busy recusados antes do ERP", () => {
    assert.deepEqual(gateNextBatch({ available: 0, activeRun: false }), { ok: false, code: "capacity_full" })
    assert.deepEqual(gateNextBatch({ available: 3, activeRun: true }), { ok: false, code: "busy" })
    assert.deepEqual(gateNextBatch({ available: 3, activeRun: false }), { ok: true, slots: 3 })
  })
  it("K/L lote: contrato ativo não consome; novo consome; cancelado nunca; capacity_reached", () => {
    const p = planBatchSlots({ slots: 2, alreadyActiveContracts: new Set(["1"]), rows: [
      { contractPk: "1", contractStatus: 1 }, { contractPk: "2", contractStatus: 5 },
      { contractPk: "3", contractStatus: 4 }, { contractPk: "3", contractStatus: 1 },
      { contractPk: "4", contractStatus: 1 }, { contractPk: "5", contractStatus: 1 },
    ] })
    assert.deepEqual(p.admittedContracts, ["3", "4"])
    assert.equal(p.cancelledSkipped, 1)
    assert.equal(p.capacityReached, true)
    assert.equal(p.consumedRows, 5)
  })
  it("estados visuais: parcial, todas pagas, bloqueado, faixa", () => {
    assert.deepEqual(contractCardStates({ contractStatus: 1, maxDaysOverdue: 20, paidCount: 1, openCount: 2 }), [
      "Ativado", "Em faixa de bloqueio", "Pagamento parcial",
    ])
    assert.deepEqual(contractCardStates({ contractStatus: 4, maxDaysOverdue: 20, paidCount: 0, openCount: 1 }), ["Bloqueado no ERP"])
    assert.deepEqual(contractCardStates({ contractStatus: null, maxDaysOverdue: 3, paidCount: 2, openCount: 0 }), [
      "Inconclusivo", "Todas as pendências pagas",
    ])
  })
})

describe("3.1E-AR prefixo confirmado (puro)", () => {
  it("AA avança; AC sem confirmados não avança; AE monotônico", () => {
    assert.deepEqual(decideConfirmedPrefixAdvance({ cursorBefore: null, confirmedPrefixPk: "12", confirmedPrefixRows: 3 }), { advance: true, cursor: "12", rows: 3 })
    assert.deepEqual(decideConfirmedPrefixAdvance({ cursorBefore: null, confirmedPrefixPk: null, confirmedPrefixRows: 0 }), { advance: false })
    assert.deepEqual(decideConfirmedPrefixAdvance({ cursorBefore: "20", confirmedPrefixPk: "12", confirmedPrefixRows: 1 }), { advance: false })
    assert.deepEqual(decideConfirmedPrefixAdvance({ cursorBefore: "20", confirmedPrefixPk: "20", confirmedPrefixRows: 1 }), { advance: false })
  })
})

describe("3.1E-AU migration", () => {
  const sql = readFileSync("supabase/patch-collection-au-contract-batch.sql", "utf8")
  it("aditiva, índice de caso ativo por contrato, RPCs fenced, service_role only, sem client_pk", () => {
    assert.equal(/\bdelete\s+from\b/i.test(sql), false)
    assert.equal(/\bdrop\s+table\b/i.test(sql), false)
    assert.equal(/\btruncate\b/i.test(sql), false)
    assert.match(sql, /collection_cases_active_contract_uidx/)
    assert.match(sql, /function public\.persist_collection_contract_invoice/)
    assert.match(sql, /function public\.acquire_collection_contract_lock/)
    assert.match(sql, /'partial_paid'/)
    assert.match(sql, /pg_advisory_xact_lock\(872146, hashtext\(v_contract\)\)/)
    assert.equal(/client_pk\s*=\s*p_write_model/i.test(sql), false)
    assert.equal((sql.match(/security definer/g) ?? []).length >= 7, true)
    assert.equal((sql.match(/set search_path = public/g) ?? []).length >= 8, true)
    assert.equal(/grant execute[^;]*to (anon|authenticated)/i.test(sql), false)
  })
})

describe("3.1E-AR migration", () => {
  const sql = readFileSync("supabase/patch-collection-ar-operational-batch.sql", "utf8")
  it("aditiva, sem DELETE/DROP TABLE, RLS, grants mínimos, search_path", () => {
    assert.equal(/\bdelete\s+from\b/i.test(sql), false)
    assert.equal(/\bdrop\s+table\b/i.test(sql), false)
    assert.equal(/\btruncate\b/i.test(sql), false)
    assert.match(sql, /create table if not exists public\.collection_case_invoices/)
    assert.match(sql, /unique \(invoice_pk\)/)
    assert.match(sql, /enable row level security/)
    assert.match(sql, /revoke all on table public\.collection_case_invoices from anon/)
    assert.match(sql, /security definer\s+set search_path = public/)
    assert.match(sql, /cursor_last_invoice_pk::numeric/)
  })
})
