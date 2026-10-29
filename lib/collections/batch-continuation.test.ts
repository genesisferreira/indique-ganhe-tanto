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
  parseDurableResult,
  type BatchOperationStore,
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
import { readNextBatchRequest, sanitizeNextBatchResult, sanitizeStageTimings, type NextBatchSummary } from "@/lib/collections/next-batch"
import { readNextBatchProgress, readResumableOperation } from "@/lib/collections/contract-card"
import { executeNextBatchRequest, type NextBatchFlowDeps } from "@/lib/collections/batch-operation-flow"
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

/**
 * 3.1E-BB: fake de TESTE com a mesma semântica das RPCs (a fonte da verdade em
 * produção é o PostgreSQL; ver batch-operation-postgres.integration.test.ts).
 * Compartilhar o mesmo objeto entre "instâncias" simula o banco único.
 */
function createFakeDurableStore(opts: { now?: () => number; ttlMs?: number } = {}) {
  const now = opts.now ?? (() => 0)
  const ttl = opts.ttlMs ?? 600_000
  type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: Row[] = []
  let n = 0
  const ACTIVE = ["ready", "segment_running", "awaiting_next"]
  const view = (r: Row) => ({
    id: r.id, status: r.status, maxSegments: r.max, segmentsStarted: r.started, segmentsCompleted: r.completed,
    nextSegment: r.completed + 1, segmentInFlight: r.inFlight, stopRequested: r.stop, stopReason: r.reason,
    expiresAt: null, aggregateCounters: r.agg, lastSegmentSummary: null,
  })
  const res = (ok: boolean, code: string, r?: Row, extra: Record<string, unknown> = {}) =>
    parseDurableResult({ ok, code, operation: r ? view(r) : null, ...extra })
  const expire = () => {
    for (const r of rows) if (ACTIVE.includes(r.status) && r.expires <= now()) { r.status = "expired"; r.reason = "expired"; r.inFlight = null }
  }
  const store: BatchOperationStore & { rows: Row[] } = {
    rows,
    async create(i) {
      expire()
      const act = rows.find((r) => ACTIVE.includes(r.status))
      if (act) return res(false, "operation_active", act)
      if (!i.queueEnabled) return res(false, "disabled")
      if (i.available == null || i.available <= 0) return res(false, "capacity_full")
      const r: Row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, status: "ready", max: Math.min(10, Math.max(1, i.maxSegments)), started: 0, completed: 0, inFlight: null, stop: false, reason: null, expires: now() + ttl, agg: { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, segments: [] } }
      rows.push(r)
      return res(true, "created", r)
    },
    async claim(id, seg) {
      const r = rows.find((x) => x.id === id)
      if (!r) return res(false, "unknown_operation")
      if (ACTIVE.includes(r.status) && r.expires <= now()) { r.status = "expired"; r.reason = "expired"; r.inFlight = null; return res(false, "operation_expired", r) }
      if (r.status === "segment_running") return res(false, "segment_in_flight", r)
      if (!ACTIVE.includes(r.status)) return res(false, "operation_stopped", r)
      if (r.stop) { r.status = "stopped"; r.reason = "stop_requested"; return res(false, "stop_requested", r) }
      if (seg !== r.completed + 1) return res(false, "segment_out_of_order", r)
      if (r.started >= r.max) { r.status = "max_segments"; r.reason = "max_segments"; return res(false, "max_segments", r) }
      r.started += 1; r.inFlight = r.started; r.status = "segment_running"; r.expires = now() + ttl
      return res(true, "claimed", r, { segment: r.inFlight })
    },
    async complete(i) {
      const r = rows.find((x) => x.id === i.operationId)
      if (!r) return res(false, "unknown_operation")
      if (i.segment <= r.completed) return res(true, "already_completed", r, { replay: true })
      if (r.status !== "segment_running" || r.inFlight !== i.segment) return res(false, "segment_mismatch", r)
      const fail = ["error", "timeout", "zero_progress", "busy", "unavailable", "disabled"]
      let status: string, reason: string | null
      if ((i.stopReason && fail.includes(i.stopReason)) || !i.ok) { status = "failed"; reason = i.stopReason && fail.includes(i.stopReason) ? i.stopReason : "error" }
      else if (i.stopReason === "capacity_reached" || i.stopReason === "pagination_ended") { status = i.stopReason; reason = i.stopReason }
      else if (r.stop) { status = "stopped"; reason = "stop_requested" }
      else if (r.completed + 1 >= r.max) { status = "max_segments"; reason = "max_segments" }
      else { status = "awaiting_next"; reason = null }
      r.completed += 1; r.inFlight = null; r.status = status; r.reason = reason; r.expires = now() + ttl
      r.agg.scannedInvoices += i.summary.scannedInvoices; r.agg.newContracts += i.summary.newContracts
      r.agg.existingContractInvoices += i.summary.existingContractInvoices
      r.agg.segments.push({ segment: i.segment, ok: i.ok, ...i.summary, stopReason: reason })
      return res(true, "completed", r)
    },
    async requestStop(id) {
      const r = rows.find((x) => x.id === id)
      if (!r) return res(false, "unknown_operation")
      r.stop = true
      if (r.status === "ready" || r.status === "awaiting_next") { r.status = "stopped"; r.reason = "stop_requested" }
      return res(true, "stop_requested", r)
    },
    async get(id) {
      expire()
      const r = id ? rows.find((x) => x.id === id) : rows[rows.length - 1]
      return res(true, "ok", r)
    },
  }
  return store
}

describe("3.1E-BB batchOperationId durável (fluxo + store)", () => {
  const summary = (available: number, busy = false) => ({
    ok: true as const,
    summary: { configuredCapacity: 15, activeContracts: 15 - available, availableCapacity: available, capacityFull: available <= 0, source: "contract_capacity", configured: 15, occupying: 15 - available, available, unkeyed: 0, futurePromises: 0, futureCallbacks: 0, busy, runStatus: "paused", runPauseStage: null } as unknown as NextBatchSummary,
  })
  const okSeg = { ok: true, discoveryStatus: "paused", pauseStage: "page_limit", progressMade: true, contractsAdmitted: 1, segmentScannedInvoices: 15, segmentUpdated: 0, capacityReached: false }
  function deps(store: BatchOperationStore, o: { available?: () => number; busy?: () => boolean; run?: () => Promise<unknown>; calls?: { n: number } } = {}): NextBatchFlowDeps {
    return {
      store,
      loadSummary: async () => summary(o.available ? o.available() : 10, o.busy ? o.busy() : false),
      loadQueueEnabled: async () => true,
      runSegment: async () => {
        if (o.calls) o.calls.n += 1
        return (o.run ? await o.run() : okSeg) as never
      },
      maxSegmentsEnv: undefined,
    }
  }
  it("clique duplo / duas abas / duas instâncias: segunda criação recusada (operation_active)", async () => {
    const db = createFakeDurableStore()
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const calls = { n: 0 }
    const tabA = executeNextBatchRequest(deps(db, { calls, run: async () => { await gate; return okSeg } }), { actorProfileId: "x", request: { kind: "start" } })
    await new Promise((r) => setTimeout(r, 5))
    const tabB = await executeNextBatchRequest(deps(db, { calls }), { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(tabB.status, 409)
    assert.equal(tabB.body.code, "operation_active")
    release()
    await tabA
    assert.equal(calls.n, 1)
    assert.equal(db.rows.length, 1)
  })
  it("instância A cria/executa seg1; B reconhece e continua seg2; ordinal não pula", async () => {
    const db = createFakeDurableStore()
    const A = deps(db), B = deps(db)
    const s1 = await executeNextBatchRequest(A, { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(s1.body.continue, true)
    assert.equal(s1.body.nextSegment, 2)
    const id = String(s1.body.batchOperationId)
    const seen = await db.get(null)
    assert.equal(seen.operation?.id, id)
    const skip = await executeNextBatchRequest(B, { actorProfileId: "x", request: { kind: "continue", batchOperationId: id, segment: 3 } })
    assert.equal(skip.body.code, "segment_out_of_order")
    const s2 = await executeNextBatchRequest(B, { actorProfileId: "x", request: { kind: "continue", batchOperationId: id, segment: 2 } })
    assert.equal(s2.body.segment, 2)
  })
  it("limite 5 global (env 100 => teto 10; default 5) e maxSegments no body recusado", async () => {
    const db = createFakeDurableStore()
    let id = ""
    let r = await executeNextBatchRequest(deps(db), { actorProfileId: "x", request: { kind: "start" } })
    id = String(r.body.batchOperationId)
    for (let seg = 2; seg <= 7; seg++) {
      r = await executeNextBatchRequest(deps(db), { actorProfileId: "x", request: { kind: "continue", batchOperationId: id, segment: seg } })
      if (r.body.continue !== true) break
    }
    assert.equal(r.body.operationStatus, "max_segments")
    assert.equal(r.body.segment, 5)
    assert.equal(resolveMaxSegments("100"), NEXT_BATCH_MAX_SEGMENTS_HARD_CAP)
    assert.equal(readNextBatchRequest({ confirm: true, maxSegments: 100 }).ok, false)
    assert.equal(readNextBatchRequest({ batchOperationId: id, segment: 2, maxSegments: 100 }).ok, false)
  })
  it("erro e timeout => failed, zero retry; zero_progress => failed", async () => {
    for (const [run, reason] of [
      [async () => { throw new Error("x") }, "error"],
      [async () => ({ ...okSeg, pauseStage: "list_timeout_headers" }), "timeout"],
      [async () => ({ ...okSeg, progressMade: false }), "zero_progress"],
    ] as const) {
      const db = createFakeDurableStore()
      const calls = { n: 0 }
      const r = await executeNextBatchRequest(deps(db, { run, calls }), { actorProfileId: "x", request: { kind: "start" } })
      assert.equal(r.body.operationStatus, "failed")
      assert.equal(r.body.stopReason, reason)
      assert.equal(r.body.continue, false)
      assert.equal(calls.n, 1)
    }
  })
  it("capacity_reached e pagination_ended encerram globalmente; capacidade cheia antes => zero ERP", async () => {
    const db = createFakeDurableStore()
    let avail = 1
    const calls = { n: 0 }
    const r = await executeNextBatchRequest(deps(db, { available: () => avail, calls, run: async () => { avail = 0; return okSeg } }), { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(r.body.operationStatus, "capacity_reached")
    const db2 = createFakeDurableStore()
    const p = await executeNextBatchRequest(deps(db2, { run: async () => ({ ...okSeg, discoveryStatus: "pagination_ended" }) }), { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(p.body.operationStatus, "pagination_ended")
    const db3 = createFakeDurableStore()
    const c3 = { n: 0 }
    const full = await executeNextBatchRequest(deps(db3, { available: () => 0, calls: c3 }), { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(full.body.code, "capacity_full")
    assert.equal(c3.n, 0)
    // capacidade enche entre segmentos (outra instância) => seg2 não chama ERP
    const db4 = createFakeDurableStore()
    let a4 = 5
    const c4 = { n: 0 }
    const s1 = await executeNextBatchRequest(deps(db4, { available: () => a4, calls: c4 }), { actorProfileId: "x", request: { kind: "start" } })
    a4 = 0
    const s2 = await executeNextBatchRequest(deps(db4, { available: () => a4, calls: c4 }), { actorProfileId: "x", request: { kind: "continue", batchOperationId: String(s1.body.batchOperationId), segment: 2 } })
    assert.equal(s2.body.operationStatus, "capacity_reached")
    assert.equal(c4.n, 1)
  })
  it("run lease ativa (busy) continua barrando: segmento não chama ERP", async () => {
    const db = createFakeDurableStore()
    const calls = { n: 0 }
    const r = await executeNextBatchRequest(deps(db, { busy: () => true, calls }), { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(r.status, 409)
    assert.equal(calls.n, 0)
    assert.equal(r.body.operationStatus, "failed")
  })
  it("stop_requested em outra instância: segmento em voo termina, nenhum novo começa", async () => {
    const db = createFakeDurableStore()
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const p = executeNextBatchRequest(deps(db, { run: async () => { await gate; return okSeg } }), { actorProfileId: "x", request: { kind: "start" } })
    await new Promise((r) => setTimeout(r, 5))
    const id = db.rows[0].id
    const stop = await executeNextBatchRequest(deps(db), { actorProfileId: "x", request: { kind: "stop", batchOperationId: id } })
    assert.equal(stop.body.operationStatus, "segment_running")
    release()
    const r = await p
    assert.equal(r.body.operationStatus, "stopped")
    const next = await executeNextBatchRequest(deps(db), { actorProfileId: "x", request: { kind: "continue", batchOperationId: id, segment: 2 } })
    assert.equal(next.body.code, "operation_stopped")
  })
  it("TTL entre instâncias e refresh: expira, não continua sozinho; terminal não bloqueia nova", async () => {
    let clock = 0
    const db = createFakeDurableStore({ now: () => clock, ttlMs: 1000 })
    const s1 = await executeNextBatchRequest(deps(db), { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(s1.body.operationStatus, "awaiting_next")
    // "refresh": nada roda sozinho; GET só lê
    const state = await db.get(null)
    assert.equal(state.operation?.status, "awaiting_next")
    assert.equal(db.rows[0].completed, 1)
    clock += 5000
    const late = await executeNextBatchRequest(deps(db), { actorProfileId: "x", request: { kind: "continue", batchOperationId: String(s1.body.batchOperationId), segment: 2 } })
    assert.equal(late.body.code, "operation_expired")
    const fresh = await executeNextBatchRequest(deps(db), { actorProfileId: "x", request: { kind: "start" } })
    assert.equal(fresh.body.code, "loaded")
  })
  it("conclusão repetida é idempotente", async () => {
    const db = createFakeDurableStore()
    const c = await db.create({ maxSegments: 5, configuredCapacity: 15, available: 5, queueEnabled: true, createdBy: null })
    const id = c.operation!.id
    await db.claim(id, 1)
    const sum = { scannedInvoices: 3, newContracts: 1, existingContractInvoices: 0, durationMs: 1, pauseStage: null }
    const a = await db.complete({ operationId: id, segment: 1, ok: true, stopReason: null, summary: sum })
    const b = await db.complete({ operationId: id, segment: 1, ok: true, stopReason: null, summary: sum })
    assert.equal(a.replay, false)
    assert.equal(b.replay, true)
    assert.equal(b.operation?.totals.newContracts, 1)
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
  it("retomada só explícita: readResumableOperation exige awaiting_next", () => {
    const id = "00000000-0000-4000-8000-000000000001"
    assert.deepEqual(readResumableOperation({ batchOperationId: id, operationStatus: "awaiting_next", resumable: true, nextSegment: 2 }), { id, nextSegment: 2 })
    assert.equal(readResumableOperation({ batchOperationId: id, operationStatus: "failed", resumable: false, nextSegment: 2 }), null)
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

describe("3.1E-BA/BB continuação limitada (store durável fake)", () => {
  async function operation(opts: { rows: CollectionSyncInvoice[]; initialActive: number; maxSegments: number; failAt?: number }) {
    const pages = keyset(opts.rows)
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryContractCaseRepo()
    const reg = createFakeDurableStore()
    const begun = await reg.create({ maxSegments: opts.maxSegments, configuredCapacity: 15, available: 13, queueEnabled: true, createdBy: null })
    assert.ok(begun.ok && begun.operation)
    const id = begun.operation!.id
    let active = opts.initialActive
    let runId: string | null = null
    let fetchCalls = 0
    const results: DiscoveryBatchResult[] = []
    for (let seg = 1; seg <= 20; seg++) {
      const claim = await reg.claim(id, seg)
      if (!claim.ok) break
      const gate = gateSegmentStart({ available: CAPACITY - active, busy: false, enabled: true })
      if (!gate.ok) {
        await reg.complete({ operationId: id, segment: seg, ok: gate.reason === "capacity_reached", stopReason: gate.reason, summary: { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, durationMs: 0, pauseStage: null } })
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
      await reg.complete({
        operationId: id,
        segment: seg,
        ok: r.ok,
        stopReason: stop,
        summary: { scannedInvoices: 0, newContracts: r.contractsAdmitted ?? 0, existingContractInvoices: 0, pauseStage: r.pauseStage ?? null, durationMs: 0 },
      })
    }
    const got = (await reg.get(id)).operation!
    const op = { ...got, segments: got.segments }
    return { op, pages, repo, results, active, fetchCalls }
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
    // 3.1E-BB: gate por segmento vive no fluxo durável, chamado pelo serviço.
    const flow = readFileSync("lib/collections/batch-operation-flow.ts", "utf8")
    assert.match(svc, /executeNextBatchRequest\(/)
    assert.doesNotMatch(flow, /while\s*\(|for\s*\(\s*;/)
    assert.match(flow, /decideNextBatch\(/)
  })
})
