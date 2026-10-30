/**
 * Sprint 3.1E-BG — vazão (BF) + salvaguardas anti-clique (sem ERP, sem rede).
 * PostgreSQL real: ver throughput-safeguard-bg-postgres.integration.test.ts.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  buildSegmentMetrics,
  decideSegmentStop,
  isClientOperationNonce,
  parseDurableResult,
  type BatchOperationStore,
} from "@/lib/collections/batch-operation"
import { executeNextBatchRequest, type NextBatchFlowDeps } from "@/lib/collections/batch-operation-flow"
import {
  COLLECTION_DETAIL_CONCURRENCY_DEFAULT,
  COLLECTION_DETAIL_CONCURRENCY_MAX,
  COLLECTION_DISCOVERY_LIST_TIMEOUT_MS,
  COLLECTION_DISCOVERY_LOGIN_TIMEOUT_MS,
  COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS,
  COLLECTION_DISCOVERY_PLATFORM_MARGIN_MS,
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S,
  COLLECTION_DISCOVERY_TIME_BUDGET_MS,
  resolveDetailConcurrency,
} from "@/lib/collections/discovery-contract"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { createMemoryDiscoveryStore } from "@/lib/collections/discovery-store"
import { createMemoryContractCaseRepo } from "@/lib/collections/contract-case-memory"
import {
  FINANCIAL_PROOF_REASONS,
  collectionListRowFinancialProof,
  collectionListRowFinancialProven,
  incrementFinancialProofReason,
  sanitizeFinancialProofHistogram,
  sumFinancialProofHistogram,
  type FinancialProofReasonHistogram,
} from "@/lib/collections/invoice-from-controllr"
import {
  NEXT_BATCH_RETRY_WARNING,
  nextBatchConfirmDetails,
  readNextBatchRequest,
  sanitizeNextBatchResult,
  type NextBatchSummary,
} from "@/lib/collections/next-batch"
import { driveBatchSegments } from "@/lib/collections/server-refresh"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"

const now = new Date("2026-09-16T12:00:00.000Z")
const referenceDate = "2026-09-16"

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
const without = (key: string) => {
  const r = listRow() as { raw: Record<string, unknown> }
  delete r.raw[key]
  return r as never
}

describe("BG §1 razão primária de prova financeira + histograma", () => {
  it("cada linha tem UMA razão da allowlist, em ordem fixa", () => {
    const cases: Array<[unknown, string]> = [
      [listRow(), "proven"],
      [listRow({ invoice_amount_paid: 40 }), "proven"],
      [listRow({}, { invoiceDueDate: null }), "missing_due_date"],
      [listRow({}, { invoiceDueDate: "16/09/2026" }), "invalid_due_date"],
      [listRow({ contract_pk: undefined }, { contractPk: null }), "missing_contract_pk"],
      [listRow({ contract_status: undefined }), "invalid_contract_status"],
      [without("invoice_deleted"), "missing_invoice_deleted"],
      [listRow({ invoice_deleted: "x" }), "invalid_invoice_deleted"],
      [listRow({ invoice_deleted: true }), "invalid_invoice_deleted"],
      [without("invoice_date_credit"), "missing_credit_field"],
      [listRow({ invoice_date_credit: "2026-09-10" }), "nonempty_credit"],
      [listRow({ invoice_amount_document: undefined }), "missing_document_amount"],
      [listRow({ invoice_amount_document: 0 }), "invalid_document_amount"],
      [listRow({ invoice_amount_paid: undefined }), "missing_paid_amount"],
      [listRow({ invoice_amount_paid: 100 }), "paid_greater_or_equal_document"],
      [listRow({ invoice_msg: "paid" }), "paid_message"],
      [listRow({ is_paid: true }), "conflicting_payment_evidence"],
      [listRow({}, { raw: null }), "unknown_requirement"],
    ]
    for (const [row, reason] of cases) {
      const r = collectionListRowFinancialProof(row as never)
      assert.equal(r.reason, reason, JSON.stringify(row))
      assert.equal(r.proven, reason === "proven")
      assert.equal(collectionListRowFinancialProven(row as never), reason === "proven")
      assert.ok((FINANCIAL_PROOF_REASONS as readonly string[]).includes(r.reason))
    }
  })
  it("ausência de crédito/valor nunca vira pagamento nem prova (fail-closed => detalhe)", () => {
    assert.equal(collectionListRowFinancialProof(without("invoice_date_credit")).proven, false)
    assert.equal(collectionListRowFinancialProof(without("invoice_amount_paid")).proven, false)
  })
  it("histograma: soma = linhas classificadas; recusa chaves fora da allowlist/valores inválidos", () => {
    const h: FinancialProofReasonHistogram = {}
    const rows = [listRow(), without("invoice_date_credit"), listRow({ invoice_msg: "paid" }), listRow()]
    for (const row of rows) incrementFinancialProofReason(h, collectionListRowFinancialProof(row).reason)
    assert.equal(sumFinancialProofHistogram(h), rows.length)
    assert.deepEqual(h, { proven: 2, missing_credit_field: 1, paid_message: 1 })
    assert.equal(sanitizeFinancialProofHistogram({ proven: 1, evil: 2 }), null)
    assert.equal(sanitizeFinancialProofHistogram({ proven: -1 }), null)
    assert.equal(sanitizeFinancialProofHistogram({ proven: 1.5 }), null)
    assert.equal(sanitizeFinancialProofHistogram({ proven: "1" }), null)
    assert.equal(sanitizeFinancialProofHistogram([1]), null)
    assert.deepEqual(sanitizeFinancialProofHistogram({ proven: 3, missing_paid_amount: 0 }), { proven: 3 })
  })
  it("métricas do segmento carregam só o histograma sanitizado", () => {
    const m = buildSegmentMetrics({
      startedAtMs: 0, totalMs: 1, stageTimings: { detailWallMs: 10, detailRequestSumMs: 18, detailMaxConcurrency: 9, persistExclusiveMs: 3 },
      segmentScannedInvoices: 1, newContracts: 0, existingContractInvoices: 1, segmentCreated: 0, skippedThisBatch: 0,
      capacityBefore: 3, capacityAfter: 3, financialProofReasons: { proven: 1, evil: 1 },
    })
    assert.equal(m.financialProofReasons, null)
    assert.equal(m.detailMaxConcurrency, 2)
    assert.equal(m.detailWallMs, 10)
    assert.equal(m.detailRequestSumMs, 18)
    assert.equal(m.persistExclusiveMs, 3)
    const s = sanitizeNextBatchResult({ ok: true, financialProofReasons: { proven: 2, missing_credit_field: 1 } })
    assert.deepEqual(s.financialProofReasons, { proven: 2, missing_credit_field: 1 })
  })
})

describe("BG §1C orçamentos", () => {
  it("rota 240s, deadline lógico 220s, margem 20s, login 30s, lista 70s, reserva ≥12s, concorrência 2", () => {
    assert.equal(COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S, 240)
    assert.equal(COLLECTION_DISCOVERY_TIME_BUDGET_MS, 220_000)
    assert.equal(COLLECTION_DISCOVERY_PLATFORM_MARGIN_MS, 20_000)
    assert.equal(COLLECTION_DISCOVERY_LOGIN_TIMEOUT_MS, 30_000)
    assert.equal(COLLECTION_DISCOVERY_LIST_TIMEOUT_MS, 70_000)
    assert.ok(COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS >= 12_000)
    assert.equal(COLLECTION_DETAIL_CONCURRENCY_DEFAULT, 2)
    assert.equal(COLLECTION_DETAIL_CONCURRENCY_MAX, 2)
    assert.equal(resolveDetailConcurrency(99), 2)
    assert.equal(resolveDetailConcurrency(0), 1)
    assert.equal(resolveDetailConcurrency(undefined), 2)
    for (const route of ["app/api/admin/collections/next-batch/route.ts", "app/api/admin/collections/sync/route.ts"]) {
      assert.match(readFileSync(route, "utf8"), /export const maxDuration = 240\b/)
    }
  })
  it("concorrência não é configurável pelo body", () => {
    assert.equal(readNextBatchRequest({ confirm: true, clientOperationNonce: randomUUID(), detailConcurrency: 10 }).ok, false)
  })
})

// ---------------------------------------------------------------------------
// §2 paralelismo limitado com persistência ordenada
// ---------------------------------------------------------------------------
function inv(pk: string, contractPk: string): CollectionSyncInvoice {
  const due = new Date(now)
  due.setUTCDate(due.getUTCDate() - 12)
  return {
    invoicePk: pk, contractPk, clientPk: null, customerName: "Cliente Fixture", customerDocument: "***0000",
    invoiceDueDate: due.toISOString(), invoiceMsg: null, invoiceDateCredit: null, isPaid: false,
    invoiceAmountDocument: 100, invoiceAmountPaid: 0, contractStatus: 1,
  }
}
type Deferred = { resolve: (v: unknown) => void; promise: Promise<unknown>; signal?: AbortSignal }
function harness(n: number, opts: { slots?: number | null } = {}) {
  const rows = Array.from({ length: n }, (_, i) => inv(String(1000 + i), String(500 + i)))
  const byPk = new Map(rows.map((r) => [r.invoicePk, r]))
  const base = createMemoryContractCaseRepo()
  const persistOrder: string[] = []
  const repo = {
    ...base,
    persistFencedInvoice: async (i: Parameters<typeof base.persistFencedInvoice>[0]) => {
      persistOrder.push(String(i.writeModel.invoice_pk))
      return base.persistFencedInvoice(i)
    },
  }
  const store = createMemoryDiscoveryStore()
  const pending = new Map<string, Deferred>()
  let inFlight = 0
  let maxInFlight = 0
  const started: string[] = []
  const prepareInvoice = (invoice: CollectionSyncInvoice, _e: unknown, _n: Date, ctx?: { signal: AbortSignal }) => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    started.push(invoice.invoicePk)
    let resolve!: (v: unknown) => void
    const promise = new Promise((r) => (resolve = r)).finally(() => (inFlight -= 1))
    pending.set(invoice.invoicePk, { resolve, promise, signal: ctx?.signal })
    return promise as Promise<never>
  }
  const run = () =>
    runOverdueDiscoveryBatch({
      store, repo, owner: "w", actorProfileId: "actor", now, referenceInstant: now, referenceDate,
      minimumDaysOverdue: 5, collectionsEnabled: true, maxPages: 1, budgetMs: 220_000,
      detailConcurrency: 99, // teto absoluto 2 mesmo se alguém tentar mais
      fetchPage: async ({ afterInvoicePk }) => {
        const page = rows.map((r) => r.invoicePk).filter((pk) => afterInvoicePk == null || Number(pk) > Number(afterInvoicePk)).slice(0, 15)
        return { ok: true, rows: page.map((invoicePk) => ({ invoicePk })), total: page.length }
      },
      toInvoice: (row) => byPk.get(String(row.invoicePk)) ?? null,
      prepareInvoice,
      contractSlots: opts.slots ?? null,
    })
  return { rows, byPk, store, persistOrder, pending, started, get maxInFlight() { return maxInFlight }, run }
}
const tick = () => new Promise((r) => setTimeout(r, 2))
async function waitFor(cond: () => boolean) {
  for (let i = 0; i < 500 && !cond(); i++) await tick()
  assert.ok(cond(), "condição não atingida")
}

describe("BG §2 invoice_info com paralelismo ≤ 2 e persistência em invoice_pk ASC", () => {
  it("respostas invertidas: a posterior aguarda a anterior; ordem e cursor preservados; máx 2 em voo", async () => {
    const h = harness(4)
    const p = h.run()
    await waitFor(() => h.pending.has("1000") && h.pending.has("1001"))
    assert.equal(h.pending.has("1002"), false, "terceira chamada não pode iniciar com 2 em voo")
    // Segunda posição responde ANTES da primeira.
    h.pending.get("1001")!.resolve({ ok: true, invoice: h.byPk.get("1001") })
    await tick()
    assert.deepEqual(h.persistOrder, [], "posterior não pode persistir antes da anterior")
    h.pending.get("1000")!.resolve({ ok: true, invoice: h.byPk.get("1000") })
    await waitFor(() => h.pending.has("1002"))
    await waitFor(() => h.pending.has("1003"))
    h.pending.get("1003")!.resolve({ ok: true, invoice: h.byPk.get("1003") })
    h.pending.get("1002")!.resolve(h.byPk.get("1002"))
    const r = await p
    assert.deepEqual(h.persistOrder, ["1000", "1001", "1002", "1003"])
    assert.ok(h.maxInFlight <= 2, `maxInFlight=${h.maxInFlight}`)
    assert.equal(h.maxInFlight, 2)
    assert.equal(r.pipelineMetrics?.detailMaxConcurrency, 2)
    assert.equal(r.cursorLastInvoicePk, "1003")
  })

  it("timeout na PRIMEIRA posição: nada persiste (mesmo com a segunda pronta); cursor não avança", async () => {
    const h = harness(3)
    const p = h.run()
    await waitFor(() => h.pending.has("1000") && h.pending.has("1001"))
    h.pending.get("1001")!.resolve({ ok: true, invoice: h.byPk.get("1001") })
    h.pending.get("1000")!.resolve({ ok: false, failure: "timeout" })
    const r = await p
    assert.deepEqual(h.persistOrder, [])
    assert.equal(r.pauseStage, "detail_timeout")
    assert.equal(r.progressMade, false)
    assert.equal(r.cursorLastInvoicePk, null)
    assert.equal(h.started.includes("1002"), false)
    assert.equal(h.pending.get("1001")!.signal?.aborted, true, "fim da página aborta a espera")
    assert.equal(decideSegmentStop({ ok: true, discoveryStatus: "paused", pauseStage: "detail_timeout", progressMade: false, capacityReached: false, availableAfter: 12 }), "timeout")
  })

  it("falha na SEGUNDA posição: só o prefixo [1] persiste; cursor = 1ª; sem retry", async () => {
    const h = harness(3)
    const p = h.run()
    await waitFor(() => h.pending.has("1000") && h.pending.has("1001"))
    h.pending.get("1001")!.resolve({ ok: false, failure: "error" })
    h.pending.get("1000")!.resolve({ ok: true, invoice: h.byPk.get("1000") })
    const r = await p
    assert.deepEqual(h.persistOrder, ["1000"])
    assert.equal(r.pauseStage, "detail_error")
    assert.equal(r.progressMade, true)
    assert.equal(r.cursorLastInvoicePk, "1000")
    assert.equal(h.started.filter((x) => x === "1001").length, 1, "sem retry")
    assert.equal(decideSegmentStop({ ok: true, discoveryStatus: "paused", pauseStage: "detail_error", progressMade: true, capacityReached: false, availableAfter: 12 }), "error")
  })

  it("timeout na SEGUNDA posição após a primeira persistir: prefixo [1]", async () => {
    const h = harness(2)
    const p = h.run()
    await waitFor(() => h.pending.has("1000") && h.pending.has("1001"))
    h.pending.get("1000")!.resolve({ ok: true, invoice: h.byPk.get("1000") })
    await waitFor(() => h.persistOrder.length === 1)
    h.pending.get("1001")!.resolve({ ok: false, failure: "timeout" })
    const r = await p
    assert.deepEqual(h.persistOrder, ["1000"])
    assert.equal(r.pauseStage, "detail_timeout")
    assert.equal(r.cursorLastInvoicePk, "1000")
  })

  it("capacidade esgotada não inicia detalhe adicional à frente", async () => {
    const h = harness(3, { slots: 1 })
    const p = h.run()
    await waitFor(() => h.pending.has("1000"))
    await tick()
    h.pending.get("1000")!.resolve({ ok: true, invoice: h.byPk.get("1000") })
    if (h.pending.has("1001")) h.pending.get("1001")!.resolve({ ok: true, invoice: h.byPk.get("1001") })
    const r = await p
    assert.deepEqual(h.persistOrder, ["1000"])
    assert.equal(r.capacityReached, true)
    assert.equal(h.started.includes("1002"), false)
  })
})

// ---------------------------------------------------------------------------
// §2 salvaguardas anti-clique
// ---------------------------------------------------------------------------
function nonceFakeStore() {
  type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: Row[] = []
  let n = 0
  const view = (r: Row) => ({ id: r.id, status: r.status, maxSegments: 5, segmentsStarted: r.started, segmentsCompleted: r.completed, nextSegment: r.completed + 1, segmentInFlight: r.inFlight, stopRequested: false, stopReason: r.reason, expiresAt: null, aggregateCounters: { segments: [] } })
  const res = (ok: boolean, code: string, r?: Row, extra: Record<string, unknown> = {}) => parseDurableResult({ ok, code, operation: r ? view(r) : null, ...extra })
  const ACTIVE = ["ready", "segment_running", "awaiting_next"]
  const createdBy: Array<string | null> = []
  const sources: string[] = []
  const store: BatchOperationStore & { rows: Row[]; createdBy: typeof createdBy; sources: string[] } = {
    rows, createdBy, sources,
    async create(i) {
      const same = rows.find((r) => r.nonce === i.clientOperationNonce)
      if (same) return res(true, "replay", same, { replay: true })
      const act = rows.find((r) => ACTIVE.includes(r.status))
      if (act) return res(false, "operation_active", act)
      const r: Row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, status: "ready", started: 0, completed: 0, inFlight: null, reason: null, nonce: i.clientOperationNonce }
      createdBy.push(i.createdBy)
      sources.push(String(i.initiationSource))
      rows.push(r)
      return res(true, "created", r)
    },
    async claim(id, seg, nonce) {
      const r = rows.find((x) => x.id === id)
      if (!r) return res(false, "unknown_operation")
      if (r.nonce !== nonce) return res(false, "nonce_mismatch", r)
      if (r.status === "segment_running") return res(false, "segment_in_flight", r)
      if (!ACTIVE.includes(r.status)) return res(false, "operation_stopped", r)
      if (seg !== r.completed + 1) return res(false, "segment_out_of_order", r)
      r.started += 1; r.inFlight = r.started; r.status = "segment_running"
      return res(true, "claimed", r, { segment: r.inFlight })
    },
    async complete(i) {
      const r = rows.find((x) => x.id === i.operationId)!
      r.completed += 1; r.inFlight = null
      r.status = i.stopReason ? (["error", "timeout", "zero_progress"].includes(i.stopReason) ? "failed" : i.stopReason) : "awaiting_next"
      r.reason = i.stopReason
      return res(true, "completed", r)
    },
    async requestStop(id) { return res(true, "stop_requested", rows.find((x) => x.id === id)) },
    async get(id) { return res(true, "ok", id ? rows.find((x) => x.id === id) : rows[rows.length - 1]) },
  }
  return store
}
const summaryOk = { ok: true as const, summary: { configuredCapacity: 15, activeContracts: 3, availableCapacity: 12, capacityFull: false, source: "contract_capacity", configured: 15, occupying: 3, available: 12, unkeyed: 0, futurePromises: 0, futureCallbacks: 0, busy: false, runStatus: "paused", runPauseStage: null } as unknown as NextBatchSummary }
const okSeg = { ok: true, discoveryStatus: "paused", pauseStage: "page_limit", progressMade: true, contractsAdmitted: 1, segmentScannedInvoices: 3, segmentUpdated: 0, capacityReached: false }
function flowDeps(store: BatchOperationStore, o: { run?: () => Promise<unknown>; calls?: { n: number } } = {}): NextBatchFlowDeps {
  return {
    store,
    loadSummary: async () => summaryOk,
    loadQueueEnabled: async () => true,
    runSegment: async () => {
      if (o.calls) o.calls.n += 1
      return (o.run ? await o.run() : okSeg) as never
    },
    maxSegmentsEnv: undefined,
  }
}

describe("BG §2 client_operation_nonce + salvaguardas", () => {
  it("nonce obrigatório; ator/origem/limites nunca aceitos do body", () => {
    assert.equal(readNextBatchRequest({ confirm: true }).ok, false)
    assert.equal(readNextBatchRequest({ confirm: true, clientOperationNonce: "abc" }).ok, false)
    for (const key of ["actor", "actorProfileId", "createdBy", "initiationSource", "initiation_source", "detailConcurrency"]) {
      assert.equal(readNextBatchRequest({ confirm: true, clientOperationNonce: randomUUID(), [key]: "x" }).ok, false, key)
    }
    assert.ok(isClientOperationNonce(randomUUID()))
  })

  it("duplo clique com o MESMO nonce: replay, uma única operação e um único segmento", async () => {
    const db = nonceFakeStore()
    const calls = { n: 0 }
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const nonce = randomUUID()
    const first = executeNextBatchRequest(flowDeps(db, { calls, run: async () => { await gate; return okSeg } }), { actorProfileId: "admin-session", request: { kind: "start", clientOperationNonce: nonce } })
    await tick()
    const second = await executeNextBatchRequest(flowDeps(db, { calls }), { actorProfileId: "admin-session", request: { kind: "start", clientOperationNonce: nonce } })
    assert.equal(second.status, 200)
    assert.equal(second.body.code, "operation_replay")
    assert.equal(second.body.continue, false)
    release()
    await first
    assert.equal(db.rows.length, 1)
    assert.equal(calls.n, 1)
    assert.deepEqual(db.createdBy, ["admin-session"])
    assert.deepEqual(db.sources, ["admin_master_confirm"])
  })

  it("duas abas/instâncias com nonces diferentes: segunda recusada (operation_active), zero segmento extra", async () => {
    const db = nonceFakeStore()
    const calls = { n: 0 }
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const tabA = executeNextBatchRequest(flowDeps(db, { calls, run: async () => { await gate; return okSeg } }), { actorProfileId: "a", request: { kind: "start", clientOperationNonce: randomUUID() } })
    await tick()
    const tabB = await executeNextBatchRequest(flowDeps(db, { calls }), { actorProfileId: "a", request: { kind: "start", clientOperationNonce: randomUUID() } })
    assert.equal(tabB.body.code, "operation_active")
    release()
    await tabA
    assert.equal(calls.n, 1)
  })

  it("continuação com nonce de outra confirmação é recusada (nonce_mismatch), sem segmento", async () => {
    const db = nonceFakeStore()
    const calls = { n: 0 }
    const nonce = randomUUID()
    const s1 = await executeNextBatchRequest(flowDeps(db, { calls }), { actorProfileId: "a", request: { kind: "start", clientOperationNonce: nonce } })
    const id = String(s1.body.batchOperationId)
    const other = await executeNextBatchRequest(flowDeps(db, { calls }), { actorProfileId: "a", request: { kind: "continue", batchOperationId: id, segment: 2, clientOperationNonce: randomUUID() } })
    assert.equal(other.body.code, "nonce_mismatch")
    assert.equal(calls.n, 1)
    const own = await executeNextBatchRequest(flowDeps(db, { calls }), { actorProfileId: "a", request: { kind: "continue", batchOperationId: id, segment: 2, clientOperationNonce: nonce } })
    assert.equal(own.body.code, "loaded")
    assert.equal(calls.n, 2)
  })

  it("operação failed não reinicia: cliente para no primeiro failed; refetch nunca faz POST de criação", async () => {
    const posts: Array<Record<string, unknown>> = []
    let refreshes = 0
    const nonce = randomUUID()
    const out = await driveBatchSegments({
      initial: { confirm: true, clientOperationNonce: nonce },
      clientOperationNonce: nonce,
      post: async (payload) => {
        posts.push(payload)
        return { httpOk: false, json: { ok: false, code: "failed", batchOperationId: "00000000-0000-4000-8000-000000000001", operationStatus: "failed", continue: false, nextSegment: 2 } }
      },
      refresh: async () => {
        refreshes += 1
        return { ok: false } as never
      },
      onSegment: () => undefined,
      onRefreshing: () => undefined,
      onRefreshed: () => undefined,
      stopRequested: () => false,
    })
    assert.equal(posts.length, 1)
    assert.equal(out.segmentsPosted, 1)
    assert.equal(refreshes, 1)
  })

  it("continuação envia o MESMO nonce em todos os segmentos", async () => {
    const posts: Array<Record<string, unknown>> = []
    const nonce = randomUUID()
    const id = "00000000-0000-4000-8000-000000000001"
    let seg = 0
    await driveBatchSegments({
      initial: { confirm: true, clientOperationNonce: nonce },
      clientOperationNonce: nonce,
      post: async (payload) => {
        posts.push(payload)
        seg += 1
        return { httpOk: true, json: { ok: true, batchOperationId: id, continue: seg < 3, nextSegment: seg + 1 } }
      },
      refresh: async () => ({ ok: true, operation: null, summary: summaryOk.summary, cases: { items: [], dashboard: null, kind: "admin_master" } }) as never,
      onSegment: () => undefined,
      onRefreshing: () => undefined,
      onRefreshed: () => undefined,
      stopRequested: () => false,
    })
    assert.equal(posts.length, 3)
    for (const p of posts) assert.equal(p.clientOperationNonce, nonce)
  })

  it("modal mostra capacidade, estado atual e o alerta obrigatório", () => {
    const text = nextBatchConfirmDetails({ summary: summaryOk.summary, lastOperationStatus: "failed", lastStopReasonLabel: "Timeout no segmento (sem retry)." })
    assert.match(text, /Carregar até 12 novos contratos/)
    assert.match(text, /3\/15/)
    assert.match(text, /paused/)
    assert.match(text, /failed/)
    assert.ok(text.includes(NEXT_BATCH_RETRY_WARNING))
    assert.equal(
      NEXT_BATCH_RETRY_WARNING,
      "Uma nova tentativa sem progresso pode bloquear temporariamente a descoberta e exigir liberação administrativa."
    )
  })

  it("página: criação SOMENTE após window.confirm; mount/refresh/catch/finally nunca postam confirm:true", () => {
    const page = readFileSync("app/cobranca/page.tsx", "utf8")
    const creations = page.match(/confirm: true/g) ?? []
    assert.equal(creations.length, 1, "um único ponto de criação")
    const fn = page.slice(page.indexOf("async function loadNextBatch"), page.indexOf("async function resumeOperation"))
    assert.ok(fn.indexOf("window.confirm(") >= 0 && fn.indexOf("window.confirm(") < fn.indexOf("confirm: true"))
    assert.match(fn, /crypto\.randomUUID\(\)/)
    const effects = page.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\)/g) ?? []
    for (const e of effects) assert.doesNotMatch(e, /runSegments|loadNextBatch|method: "POST"/)
    const refresh = page.slice(page.indexOf("const refreshAll"), page.indexOf("useEffect("))
    assert.doesNotMatch(refresh, /method: "POST"|runSegments/)
    const runSeg = page.slice(page.indexOf("async function runSegments"))
    const fin = runSeg.slice(runSeg.indexOf("} finally {"), runSeg.indexOf("} finally {") + 300)
    assert.doesNotMatch(fin, /runSegments|loadNextBatch|fetch\(/)
    assert.match(page, /disabled=\{button\.disabled\}/)
  })

  it("rota GET só lê; criação apenas no POST com sessão Admin Master", () => {
    const route = readFileSync("app/api/admin/collections/next-batch/route.ts", "utf8")
    const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"))
    assert.doesNotMatch(get, /runNextBatchOperation|executeNextBatchRequest/)
    assert.match(route, /actorProfileId: auth\.profileId/)
  })

  it("código da app nunca faz INSERT/UPDATE/DELETE direto em collection_discovery_runs", () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(full)
      }
    }
    walk("lib")
    walk("app")
    assert.ok(files.length > 50)
    for (const f of files) {
      const src = readFileSync(f, "utf8")
      assert.doesNotMatch(src, /from\(\s*["']collection_discovery_runs["']\s*\)[\s\S]{0,80}?\.(update|insert|upsert|delete)\(/, f)
    }
  })
})
