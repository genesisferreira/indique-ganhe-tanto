/**
 * Sprint 3.1E-BA — continuação limitada, batchOperationId, detalhe evitável
 * e mocks de performance (sem ERP, sem banco, sem rede).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  NEXT_BATCH_MAX_SEGMENTS_DEFAULT,
  NEXT_BATCH_MAX_SEGMENTS_HARD_CAP,
  createBatchOperationRegistry,
  decideSegmentStop,
  gateSegmentStart,
  resolveMaxSegments,
} from "@/lib/collections/batch-operation"
import { runOverdueDiscoveryBatch, type DiscoveryBatchResult } from "@/lib/collections/discovery-runner"
import { createMemoryDiscoveryStore } from "@/lib/collections/discovery-store"
import { createMemoryContractCaseRepo } from "@/lib/collections/contract-case-memory"
import {
  collectionListRowFinancialProven,
  decideInvoiceDetailLookup,
} from "@/lib/collections/invoice-from-controllr"
import { readNextBatchRequest, sanitizeNextBatchResult, sanitizeStageTimings } from "@/lib/collections/next-batch"
import { readNextBatchProgress } from "@/lib/collections/contract-card"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"

const now = new Date("2026-09-16T12:00:00.000Z")
const referenceDate = "2026-09-16"
const CAPACITY = 15

function inv(pk: string, contractPk: string, opts: Partial<CollectionSyncInvoice> & { days?: number } = {}): CollectionSyncInvoice {
  const due = new Date(now)
  due.setUTCDate(due.getUTCDate() - (opts.days ?? 12))
  return {
    invoicePk: pk,
    contractPk,
    clientPk: null,
    customerName: "Cliente Fixture",
    customerDocument: "***0000",
    invoiceDueDate: due.toISOString(),
    invoiceMsg: null,
    invoiceDateCredit: null,
    isPaid: false,
    invoiceAmountDocument: 100,
    invoiceAmountPaid: 0,
    contractStatus: 1,
    ...opts,
  }
}

function listRow(over: Record<string, unknown> = {}, rowOver: Record<string, unknown> = {}) {
  return {
    invoicePk: "101",
    contractPk: "7",
    invoiceDueDate: "2026-09-01",
    invoiceDeleted: false,
    raw: {
      invoice_pk: 101,
      contract_pk: 7,
      contract_status: 1,
      invoice_deleted: false,
      invoice_date_credit: null,
      invoice_amount_document: 100,
      invoice_amount_paid: 0,
      ...over,
    },
    ...rowOver,
  } as never
}

function keyset(rows: CollectionSyncInvoice[]) {
  const byPk = new Map(rows.map((r) => [r.invoicePk, r]))
  const sorted = rows.map((r) => r.invoicePk).sort((a, b) => Number(a) - Number(b))
  const afters: Array<string | null> = []
  return {
    byPk,
    afters,
    fetchPage: async ({ afterInvoicePk }: { afterInvoicePk: string | null }) => {
      afters.push(afterInvoicePk)
      const page = sorted.filter((pk) => afterInvoicePk == null || Number(pk) > Number(afterInvoicePk)).slice(0, 15)
      return { ok: true, rows: page.map((invoicePk) => ({ invoicePk })), total: sorted.length }
    },
  }
}

describe("3.1E-BA instrumentação de detalhe (lista suficiente)", () => {
  it("lista com todos os campos comprovados dispensa invoice_info", () => {
    assert.equal(collectionListRowFinancialProven(listRow()), true)
    assert.equal(decideInvoiceDetailLookup({ needsDetailByRule: true, listFinancialProven: true }), "skip_list_sufficient")
  })
  it("pagamento parcial comprovado na lista também dispensa", () => {
    assert.equal(collectionListRowFinancialProven(listRow({ invoice_amount_paid: 40 })), true)
  })
  it("ausência de invoice_date_credit na linha NÃO prova nada (ausência ≠ pagamento, mas exige detalhe)", () => {
    const row = listRow()
    delete (row as { raw: Record<string, unknown> }).raw.invoice_date_credit
    assert.equal(collectionListRowFinancialProven(row), false)
  })
  it("crédito preenchido, msg=paid ou pago>=documento => detalhe preservado (evidência positiva/conflito)", () => {
    assert.equal(collectionListRowFinancialProven(listRow({ invoice_date_credit: "2026-09-10" })), false)
    assert.equal(collectionListRowFinancialProven(listRow({ invoice_msg: "paid" })), false)
    assert.equal(collectionListRowFinancialProven(listRow({ invoice_amount_paid: 100 })), false)
  })
  it("sem contract_status, contract_pk, vencimento, invoice_deleted ou valores => detalhe", () => {
    assert.equal(collectionListRowFinancialProven(listRow({ contract_status: undefined })), false)
    assert.equal(collectionListRowFinancialProven(listRow({ contract_pk: undefined }, { contractPk: null })), false)
    assert.equal(collectionListRowFinancialProven(listRow({}, { invoiceDueDate: null })), false)
    const noDel = listRow()
    delete (noDel as { raw: Record<string, unknown> }).raw.invoice_deleted
    assert.equal(collectionListRowFinancialProven(noDel), false)
    assert.equal(collectionListRowFinancialProven(listRow({ invoice_amount_document: undefined })), false)
    assert.equal(collectionListRowFinancialProven(listRow({ invoice_amount_paid: undefined })), false)
  })
  it("regra que não exige detalhe continua sem detalhe", () => {
    assert.equal(decideInvoiceDetailLookup({ needsDetailByRule: false, listFinancialProven: false }), "skip_not_needed")
    assert.equal(decideInvoiceDetailLookup({ needsDetailByRule: true, listFinancialProven: false }), "fetch")
  })
  it("stage timings sanitizados: só números", () => {
    const t = sanitizeStageTimings({ loginMs: 24000.4, listMs: 41000, detailLookups: 3, evil: "x", totalMs: -1 })
    assert.equal(t?.loginMs, 24000)
    assert.equal(t?.totalMs, null)
    assert.equal("evil" in (t ?? {}), false)
    const s = sanitizeNextBatchResult({ ok: true, progressMade: true, segmentScannedInvoices: 15 })
    assert.equal(s.progressMade, true)
    assert.equal(s.segmentScannedInvoices, 15)
  })
})

/** Mock de performance: login 24s, lista 41s, invoice_info 13s; orçamento 105s. */
async function perfSegment(useListProof: boolean) {
  const rows = Array.from({ length: 15 }, (_, i) => inv(String(1000 + i), String(500 + i)))
  const pages = keyset(rows)
  let t = 24_000
  let detailLookups = 0
  const repo = createMemoryContractCaseRepo()
  const result = await runOverdueDiscoveryBatch({
    store: createMemoryDiscoveryStore(),
    repo,
    owner: "w",
    actorProfileId: "actor",
    now,
    referenceInstant: now,
    referenceDate,
    minimumDaysOverdue: 5,
    collectionsEnabled: true,
    startedAtMs: 0,
    clock: () => t,
    budgetMs: 105_000,
    configuredTimeoutMs: 50_000,
    maxPages: 1,
    fetchPage: async (a) => {
      t += 41_000
      return pages.fetchPage(a)
    },
    toInvoice: (row) => pages.byPk.get(String(row.invoicePk)) ?? null,
    prepareInvoice: async (invoice) => {
      const decision = decideInvoiceDetailLookup({ needsDetailByRule: true, listFinancialProven: useListProof })
      if (decision === "fetch") {
        detailLookups += 1
        t += 13_000
      }
      return invoice
    },
    contractSlots: 13,
  })
  return { result, detailLookups }
}

describe("3.1E-BA performance mocks (causa das 3 faturas)", () => {
  it("ANTES: invoice_info por linha esgota o orçamento após ~3 linhas (confirmed_prefix_budget)", async () => {
    const { result, detailLookups } = await perfSegment(false)
    assert.equal(result.pauseStage, "confirmed_prefix_budget")
    assert.ok(result.scannedInvoices <= 4, `scanned=${result.scannedInvoices}`)
    assert.ok(detailLookups >= 3)
  })
  it("DEPOIS: lista suficiente => 0 invoice_info e página inteira confirmada", async () => {
    const { result, detailLookups } = await perfSegment(true)
    assert.equal(detailLookups, 0)
    assert.equal(result.scannedInvoices, 13)
    assert.equal(result.contractsAdmitted, 13)
    assert.equal(result.capacityReached, true)
  })
})

describe("3.1E-BA batchOperationId", () => {
  const mk = () => {
    let n = 0
    let clock = 0
    const reg = createBatchOperationRegistry({
      newId: () => `00000000-0000-4000-8000-00000000000${++n}`,
      now: () => clock,
      ttlMs: 1000,
    })
    return { reg, tick: (ms: number) => (clock += ms) }
  }
  it("clique duplo / segunda aba: segunda operação recusada enquanto há uma ativa", () => {
    const { reg } = mk()
    assert.equal(reg.begin(5).ok, true)
    const second = reg.begin(5)
    assert.equal(second.ok, false)
    if (!second.ok) assert.equal(second.code, "operation_active")
  })
  it("concorrência: segmento em voo bloqueia outro; ordem estrita", () => {
    const { reg } = mk()
    const b = reg.begin(5)
    assert.ok(b.ok)
    if (!b.ok) return
    const id = b.operation.id
    assert.equal(reg.claimSegment(id, 2).ok, false)
    assert.equal(reg.claimSegment(id, 1).ok, true)
    const dup = reg.claimSegment(id, 1)
    assert.equal(dup.ok, false)
    if (!dup.ok) assert.equal(dup.code, "segment_in_flight")
  })
  it("limite de segmentos e parada solicitada", () => {
    const { reg } = mk()
    const b = reg.begin(2)
    assert.ok(b.ok)
    if (!b.ok) return
    const id = b.operation.id
    const rec = (segment: number) => ({ segment, ok: true, scannedInvoices: 15, newContracts: 1, existingContractInvoices: 0, pauseStage: "page_limit", durationMs: 1, stopReason: null })
    reg.claimSegment(id, 1)
    reg.completeSegment(id, rec(1))
    reg.claimSegment(id, 2)
    const op = reg.completeSegment(id, rec(2))
    assert.equal(op?.status, "stopped")
    assert.equal(op?.stopReason, "max_segments")
    assert.equal(reg.claimSegment(id, 3).ok, false)
    const b2 = reg.begin(5)
    assert.ok(b2.ok)
    if (!b2.ok) return
    reg.claimSegment(b2.operation.id, 1)
    reg.requestStop(b2.operation.id)
    const op2 = reg.completeSegment(b2.operation.id, rec(1))
    assert.equal(op2?.stopReason, "stop_requested")
  })
  it("refresh/aba fechada: operação expira por TTL e não continua sozinha", () => {
    const { reg, tick } = mk()
    const b = reg.begin(5)
    assert.ok(b.ok)
    if (!b.ok) return
    tick(5000)
    assert.equal(reg.hasActive(), false)
    const c = reg.claimSegment(b.operation.id, 1)
    assert.equal(c.ok, false)
  })
  it("max segments configurável com teto", () => {
    assert.equal(resolveMaxSegments(undefined), NEXT_BATCH_MAX_SEGMENTS_DEFAULT)
    assert.equal(resolveMaxSegments("3"), 3)
    assert.equal(resolveMaxSegments(999), NEXT_BATCH_MAX_SEGMENTS_HARD_CAP)
    assert.equal(resolveMaxSegments(0), NEXT_BATCH_MAX_SEGMENTS_DEFAULT)
  })
  it("corpo: runId recusado; start exige confirm; continue exige segmento >=2", () => {
    assert.equal(readNextBatchRequest({ runId: "x", confirm: true }).ok, false)
    assert.equal(readNextBatchRequest({}).ok, false)
    assert.deepEqual(readNextBatchRequest({ confirm: true }), { ok: true, request: { kind: "start" } })
    const id = "00000000-0000-4000-8000-000000000001"
    assert.equal(readNextBatchRequest({ batchOperationId: id, segment: 1 }).ok, false)
    assert.equal(readNextBatchRequest({ batchOperationId: "nope", segment: 2 }).ok, false)
    assert.equal(readNextBatchRequest({ batchOperationId: id, segment: 2 }).ok, true)
    assert.equal(readNextBatchRequest({ batchOperationId: id, stop: true }).ok, true)
  })
})

describe("3.1E-BA decisões de parada / gate", () => {
  const base = { ok: true, discoveryStatus: "paused", pauseStage: "page_limit", progressMade: true, capacityReached: false, availableAfter: 5 }
  it("continua só com progresso, sem erro, com vaga e paginação aberta", () => {
    assert.equal(decideSegmentStop(base), null)
    assert.equal(decideSegmentStop({ ...base, ok: false, discoveryStatus: "failed" }), "error")
    assert.equal(decideSegmentStop({ ...base, pauseStage: "list_timeout_headers" }), "timeout")
    assert.equal(decideSegmentStop({ ...base, progressMade: false }), "zero_progress")
    assert.equal(decideSegmentStop({ ...base, capacityReached: true }), "capacity_reached")
    assert.equal(decideSegmentStop({ ...base, availableAfter: 0 }), "capacity_reached")
    assert.equal(decideSegmentStop({ ...base, discoveryStatus: "pagination_ended" }), "pagination_ended")
  })
  it("gate antes do segmento: lease ativa, capacidade cheia, desligado", () => {
    assert.deepEqual(gateSegmentStart({ available: 3, busy: false, enabled: true }), { ok: true, slots: 3 })
    assert.deepEqual(gateSegmentStart({ available: 3, busy: true, enabled: true }), { ok: false, reason: "busy" })
    assert.deepEqual(gateSegmentStart({ available: 0, busy: false, enabled: true }), { ok: false, reason: "capacity_reached" })
    assert.deepEqual(gateSegmentStart({ available: null, busy: false, enabled: true }), { ok: false, reason: "error" })
  })
})

describe("3.1E-BA continuação limitada (memória)", () => {
  async function operation(opts: { rows: CollectionSyncInvoice[]; initialActive: number; maxSegments: number; failAt?: number }) {
    const pages = keyset(opts.rows)
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryContractCaseRepo()
    const reg = createBatchOperationRegistry({ newId: () => "00000000-0000-4000-8000-000000000009" })
    const begun = reg.begin(opts.maxSegments)
    assert.ok(begun.ok)
    if (!begun.ok) throw new Error("x")
    const id = begun.operation.id
    let active = opts.initialActive
    let runId: string | null = null
    let fetchCalls = 0
    const results: DiscoveryBatchResult[] = []
    for (let seg = 1; seg <= 20; seg++) {
      const claim = reg.claimSegment(id, seg)
      if (!claim.ok) break
      const gate = gateSegmentStart({ available: CAPACITY - active, busy: false, enabled: true })
      if (!gate.ok) {
        reg.stop(id, gate.reason)
        break
      }
      const r: DiscoveryBatchResult = await runOverdueDiscoveryBatch({
        store,
        repo,
        owner: `seg-${seg}`,
        actorProfileId: "actor",
        now,
        referenceInstant: now,
        referenceDate,
        minimumDaysOverdue: 5,
        collectionsEnabled: true,
        startedAtMs: 0,
        clock: () => 0,
        budgetMs: 100_000,
        configuredTimeoutMs: 5_000,
        maxPages: 1,
        runId,
        fetchPage: async (a) => {
          fetchCalls += 1
          if (opts.failAt === seg) return { ok: false, rows: [], total: null, httpStatus: 500 }
          return pages.fetchPage(a)
        },
        toInvoice: (row) => pages.byPk.get(String(row.invoicePk)) ?? null,
        contractSlots: gate.slots,
      })
      runId = r.runId
      active += r.contractsAdmitted ?? 0
      assert.ok(active <= CAPACITY, `active=${active}`)
      results.push(r)
      const stop = decideSegmentStop({
        ok: r.ok,
        discoveryStatus: r.status,
        pauseStage: r.pauseStage,
        progressMade: r.progressMade,
        capacityReached: r.capacityReached === true,
        availableAfter: CAPACITY - active,
      })
      reg.completeSegment(id, {
        segment: seg,
        ok: r.ok,
        scannedInvoices: 0,
        newContracts: r.contractsAdmitted ?? 0,
        existingContractInvoices: 0,
        pauseStage: r.pauseStage,
        durationMs: 0,
        stopReason: stop,
      })
    }
    return { op: reg.get(id)!, pages, repo, results, active, fetchCalls }
  }

  it("uma confirmação => vários segmentos; segundo começa após o cursor do primeiro; capacidade ≤15", async () => {
    // 2 contratos por fatura? não: 1 contrato a cada 3 faturas => 45 faturas, 15 contratos
    const rows = Array.from({ length: 45 }, (_, i) => inv(String(2000 + i), String(900 + Math.floor(i / 3))))
    const { op, pages, active, results } = await operation({ rows, initialActive: 2, maxSegments: 5 })
    assert.ok(op.segments.length >= 2, `segments=${op.segments.length}`)
    assert.equal(pages.afters[0], null)
    assert.equal(pages.afters[1], results[0].cursorLastInvoicePk)
    for (let i = 1; i < pages.afters.length; i++) {
      assert.ok(Number(pages.afters[i]) > Number(pages.afters[i - 1] ?? 0), "cursor monotônico")
    }
    assert.equal(active, CAPACITY)
    assert.equal(op.stopReason, "capacity_reached")
  })

  it("nenhuma fatura pulada nem duplicada entre segmentos", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => inv(String(3000 + i), "77"))
    const { repo, op } = await operation({ rows, initialActive: 2, maxSegments: 5 })
    const cases = [...(repo as unknown as { cases: Map<string, unknown> }).cases.values()]
    assert.equal(cases.length, 1, "um caso por contrato")
    assert.equal(op.stopReason, "pagination_ended")
  })

  it("erro interrompe sem retry (zero chamadas extras)", async () => {
    const rows = Array.from({ length: 45 }, (_, i) => inv(String(4000 + i), String(100 + i)))
    const { op, fetchCalls } = await operation({ rows, initialActive: 2, maxSegments: 5, failAt: 1 })
    assert.equal(op.stopReason, "error")
    assert.equal(op.segments.length, 1)
    assert.equal(fetchCalls, 1)
  })

  it("capacidade cheia antes do segmento => nenhum segmento/ERP", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => inv(String(5000 + i), String(200 + i)))
    const { op, fetchCalls } = await operation({ rows, initialActive: 15, maxSegments: 5 })
    assert.equal(fetchCalls, 0)
    assert.equal(op.stopReason, "capacity_reached")
  })

  it("max segments respeitado (sem loop ilimitado)", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => inv(String(6000 + i), "55"))
    const { op, fetchCalls } = await operation({ rows, initialActive: 2, maxSegments: 3 })
    assert.equal(op.segments.length, 3)
    assert.equal(fetchCalls, 3)
    assert.equal(op.stopReason, "max_segments")
  })
})

describe("3.1E-BA UI / arquitetura", () => {
  it("progresso lido sem IDs", () => {
    const v = readNextBatchProgress({ segment: 2, maxSegments: 5, totals: { scannedInvoices: 30, newContracts: 4, existingContractInvoices: 3 }, remainingSlots: 9, stopReasonLabel: null }, true)
    assert.equal(v?.segment, 2)
    assert.equal(v?.remainingSlots, 9)
  })
  it("página tem botão de parada e painel de progresso; sem setInterval/cron", () => {
    const page = readFileSync("app/cobranca/page.tsx", "utf8")
    assert.match(page, /Parar após o segmento atual/)
    assert.match(page, /next-batch-progress/)
    assert.doesNotMatch(page, /setInterval|localStorage|sessionStorage/)
  })
  it("rota executa no máximo um segmento por POST; serviço sem loop", () => {
    const route = readFileSync("app/api/admin/collections/next-batch/route.ts", "utf8")
    assert.match(route, /runNextBatchOperation/)
    const svc = readFileSync("lib/collections/next-batch.service.ts", "utf8")
    assert.doesNotMatch(svc, /while\s*\(|for\s*\(\s*;/)
    assert.match(svc, /decideNextBatch\(/)
  })
})
