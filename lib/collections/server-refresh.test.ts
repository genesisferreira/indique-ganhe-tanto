/** Sprint 3.1E-BD — refetch do servidor após cada segmento (puro, fetch fake, sem ERP). */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { parseCapacitySummary } from "@/lib/collections/next-batch"
import { nextBatchButtonState } from "@/lib/collections/contract-card"
import { buildSegmentMetrics, SEGMENT_METRIC_NUMBER_KEYS } from "@/lib/collections/batch-operation"
import {
  CASES_URL,
  NEXT_BATCH_URL,
  STALE_SUMMARY_MESSAGE,
  driveBatchSegments,
  readySummary,
  refreshServerState,
  summaryFromRefresh,
  type FetchLike,
  type SummaryViewState,
} from "@/lib/collections/server-refresh"

type Call = { url: string; method: string }

/** Servidor fake: o "banco" é a única fonte; segmentos mudam o banco. */
function fakeServer(o: { occupying: number; failRefresh?: (n: number) => boolean; failCases?: boolean }) {
  const db = { occupying: o.occupying, opStatus: "ready" as string }
  const calls: Call[] = []
  let getCount = 0
  const fetchFn: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET"
    calls.push({ url, method })
    if (method !== "GET") throw new Error("refresh must be GET-only")
    if (url === NEXT_BATCH_URL) {
      getCount += 1
      if (o.failRefresh?.(getCount)) return { ok: false, json: async () => ({ ok: false }) }
      const summary = parseCapacitySummary({ configured: 15, occupying: db.occupying }, { status: "paused", pauseStage: null })
      return { ok: true, json: async () => ({ ok: true, summary, operation: { operationStatus: db.opStatus, segment: 1 } }) }
    }
    if (url === CASES_URL) {
      if (o.failCases) return { ok: false, json: async () => ({ ok: false }) }
      return { ok: true, json: async () => ({ ok: true, items: Array.from({ length: db.occupying }, () => ({})), dashboard: { overdue: db.occupying }, kind: "admin_master" }) }
    }
    throw new Error(`unexpected url ${url}`)
  }
  return { db, calls, fetchFn }
}

function capOf(s: SummaryViewState) {
  const r = readySummary(s)
  return r ? `${r.configuredCapacity}/${r.activeContracts}/${r.availableCapacity}` : s.status
}

describe("3.1E-BD refetch do servidor após cada segmento", () => {
  it("segmento cria contrato: 15/2/13 → 15/3/12 lido do servidor (sem incremento no cliente)", async () => {
    const srv = fakeServer({ occupying: 2 })
    const views: string[] = []
    const out = await driveBatchSegments({
      initial: { confirm: true },
      post: async () => {
        srv.db.occupying = 3 // efeito do segmento no banco
        srv.db.opStatus = "awaiting_next"
        return { httpOk: true, json: { ok: true, contractsAdmitted: 1, continue: false, segment: 1 } }
      },
      refresh: () => refreshServerState(srv.fetchFn),
      onSegment: () => undefined,
      onRefreshing: () => views.push("refreshing"),
      onRefreshed: (r) => views.push(capOf(summaryFromRefresh(r))),
      stopRequested: () => false,
    })
    assert.deepEqual(views, ["refreshing", "15/3/12"])
    assert.equal(out.refreshes, 1)
  })

  it("refetch após CADA segmento (awaiting_next e terminal) — 2 segmentos => 2 refetches", async () => {
    const srv = fakeServer({ occupying: 2 })
    const caps: string[] = []
    let n = 0
    const out = await driveBatchSegments({
      initial: { confirm: true },
      post: async () => {
        n += 1
        if (n === 1) {
          srv.db.occupying = 3
          srv.db.opStatus = "awaiting_next"
          return { httpOk: true, json: { ok: true, continue: true, batchOperationId: "00000000-0000-4000-8000-000000000001", nextSegment: 2, segment: 1 } }
        }
        srv.db.opStatus = "failed"
        return { httpOk: false, json: { ok: false, continue: false, operationStatus: "failed", stopReason: "timeout", segment: 2 } }
      },
      refresh: () => refreshServerState(srv.fetchFn),
      onSegment: () => undefined,
      onRefreshing: () => undefined,
      onRefreshed: (r) => caps.push(capOf(summaryFromRefresh(r))),
      stopRequested: () => false,
    })
    assert.equal(out.segmentsPosted, 2)
    assert.equal(out.refreshes, 2)
    // segmento falha depois de progresso anterior: resumo continua refletindo o banco (15/3/12)
    assert.deepEqual(caps, ["15/3/12", "15/3/12"])
  })

  it("terminal failed no 1º segmento ainda atualiza o resumo", async () => {
    const srv = fakeServer({ occupying: 2 })
    const caps: string[] = []
    await driveBatchSegments({
      initial: { confirm: true },
      post: async () => {
        srv.db.occupying = 3
        srv.db.opStatus = "failed"
        return { httpOk: false, json: { ok: false, continue: false, operationStatus: "failed" } }
      },
      refresh: () => refreshServerState(srv.fetchFn),
      onSegment: () => undefined,
      onRefreshing: () => undefined,
      onRefreshed: (r) => caps.push(capOf(summaryFromRefresh(r))),
      stopRequested: () => false,
    })
    assert.deepEqual(caps, ["15/3/12"])
  })

  it("POST que lança (rede) ainda refaz o resumo e não continua", async () => {
    const srv = fakeServer({ occupying: 3 })
    const out = await driveBatchSegments({
      initial: { confirm: true },
      post: async () => { throw new Error("network") },
      refresh: () => refreshServerState(srv.fetchFn),
      onSegment: () => undefined, onRefreshing: () => undefined, onRefreshed: () => undefined,
      stopRequested: () => false,
    })
    assert.equal(out.segmentsPosted, 1)
    assert.equal(out.refreshes, 1)
  })

  it("falha no refetch: 'Resumo desatualizado — atualizar', botão bloqueado, sem novo segmento", async () => {
    const srv = fakeServer({ occupying: 2, failRefresh: () => true })
    let posts = 0
    let last: SummaryViewState = { status: "loading" }
    const out = await driveBatchSegments({
      initial: { confirm: true },
      post: async () => {
        posts += 1
        return { httpOk: true, json: { ok: true, continue: true, batchOperationId: "00000000-0000-4000-8000-000000000001", nextSegment: 2, segment: 1 } }
      },
      refresh: () => refreshServerState(srv.fetchFn),
      onSegment: () => undefined,
      onRefreshing: () => undefined,
      onRefreshed: (r) => { last = summaryFromRefresh(r) },
      stopRequested: () => false,
    })
    assert.equal(posts, 1, "não inicia segmento 2 com resumo desatualizado")
    assert.equal(out.refreshFailed, true)
    assert.deepEqual(last, { status: "stale", message: STALE_SUMMARY_MESSAGE })
    assert.equal(STALE_SUMMARY_MESSAGE, "Resumo desatualizado — atualizar")
    assert.equal(readySummary(last), null)
    assert.equal(nextBatchButtonState({ summary: readySummary(last), submitting: false, loading: true }).disabled, true)
  })

  it("falha só em /api/cobranca/cases também é stale (blocos não podem ficar antigos)", async () => {
    const srv = fakeServer({ occupying: 3, failCases: true })
    assert.deepEqual(summaryFromRefresh(await refreshServerState(srv.fetchFn)), { status: "stale", message: STALE_SUMMARY_MESSAGE })
  })

  it("refresh manual recupera o valor após falha", async () => {
    let fail = true
    const srv = fakeServer({ occupying: 3, failRefresh: () => fail })
    assert.equal(capOf(summaryFromRefresh(await refreshServerState(srv.fetchFn))), "stale")
    fail = false
    assert.equal(capOf(summaryFromRefresh(await refreshServerState(srv.fetchFn))), "15/3/12")
  })

  it("refetch não chama ERP: só GET em next-batch e cases; nenhum POST/segmento", async () => {
    const srv = fakeServer({ occupying: 2 })
    await refreshServerState(srv.fetchFn)
    await refreshServerState(srv.fetchFn)
    assert.ok(srv.calls.length === 4)
    for (const c of srv.calls) {
      assert.equal(c.method, "GET")
      assert.ok(c.url === NEXT_BATCH_URL || c.url === CASES_URL)
      assert.equal(/brbyte|controllr|invoice|probe|sync/i.test(c.url), false)
    }
  })

  it("estados refreshing/stale não expõem números; botão desabilitado fora de ready", () => {
    for (const s of [{ status: "refreshing" }, { status: "stale", message: STALE_SUMMARY_MESSAGE }, { status: "loading" }] as SummaryViewState[]) {
      assert.equal(readySummary(s), null)
    }
  })

  it("página usa refetch do servidor após segmentos, estado updating e stale; sem incremento local", () => {
    const page = readFileSync("app/cobranca/page.tsx", "utf8")
    assert.match(page, /driveBatchSegments/)
    assert.match(page, /refresh: refreshAll/)
    assert.match(page, /next-batch-summary-updating/)
    assert.match(page, /next-batch-summary-stale/)
    assert.match(page, /STALE_SUMMARY_MESSAGE/)
    assert.match(page, /loading: summaryState\.status !== "ready"/)
    assert.equal(/activeContracts\s*\+|availableCapacity\s*-|occupying\s*\+/.test(page), false)
    assert.equal(/setInterval|localStorage|sessionStorage/.test(page), false)
  })
})

describe("3.1E-BD métricas por segmento (sanitização)", () => {
  it("lista fechada de chaves; extras descartadas; sem IDs/PII; inteiros não negativos", () => {
    const m = buildSegmentMetrics({
      startedAtMs: Date.UTC(2026, 9, 29, 13, 50),
      totalMs: 102765.7,
      stageTimings: { loginMs: 900, listMs: -5, listRequests: 1, detailLookups: 3, detailSkippedByList: 0, persistMs: null, invoicePk: 123, customer: "Fulano" } as never,
      segmentScannedInvoices: 3, newContracts: 1, existingContractInvoices: 2, segmentCreated: 1, skippedThisBatch: 0,
      capacityBefore: 2, capacityAfter: 3,
    })
    const keys = Object.keys(m).sort()
    assert.deepEqual(keys, [...SEGMENT_METRIC_NUMBER_KEYS, "startedAt", "cursorAdvanced"].sort())
    assert.equal(m.totalMs, 102765)
    assert.equal(m.listMs, 0)
    assert.equal(m.persistMs, null)
    assert.equal(m.invoicesAttached, 3)
    assert.equal(m.cursorAdvanced, true)
    assert.equal(m.capacityBefore, 2)
    assert.equal(m.capacityAfter, 3)
    assert.equal(/Fulano|invoicePk|customer/.test(JSON.stringify(m)), false)
    for (const k of SEGMENT_METRIC_NUMBER_KEYS) {
      const v = m[k]
      assert.ok(v === null || (Number.isInteger(v) && v >= 0), k)
    }
  })
  it("timeout sem progresso: cursorAdvanced=false, contadores 0", () => {
    const m = buildSegmentMetrics({ startedAtMs: null, totalMs: 53243, stageTimings: null, segmentScannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, segmentCreated: 0, skippedThisBatch: 0, capacityBefore: 3, capacityAfter: 3 })
    assert.equal(m.cursorAdvanced, false)
    assert.equal(m.rowsScanned, 0)
    assert.equal(m.startedAt, null)
  })
})
