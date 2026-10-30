/**
 * Sprint 3.1E-BJ - auditoria do campo pago + timeout de invoice_info 60s +
 * reserva pre-detalhe (sem ERP, sem rede, relogio controlado).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { decideSegmentStop } from "@/lib/collections/batch-operation"
import {
  COLLECTION_DETAIL_CONCURRENCY_DEFAULT,
  COLLECTION_DETAIL_CONCURRENCY_MAX,
  COLLECTION_DISCOVERY_DETAIL_TIMEOUT_BEFORE_MS,
  COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS,
  COLLECTION_DISCOVERY_DETAIL_WINDOW_RESERVE_MS,
  COLLECTION_DISCOVERY_LIST_TIMEOUT_MS,
  COLLECTION_DISCOVERY_PLATFORM_MARGIN_MS,
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S,
  COLLECTION_DISCOVERY_TIME_BUDGET_MS,
  collectionDetailWindowFits,
  sanitizeDiscoveryErrorClass,
} from "@/lib/collections/discovery-contract"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { createMemoryDiscoveryStore } from "@/lib/collections/discovery-store"
import { createMemoryContractCaseRepo } from "@/lib/collections/contract-case-memory"
import {
  collectionListRowFinancialProof,
  decideInvoiceDetailLookup,
} from "@/lib/collections/invoice-from-controllr"
import { extractInvoiceMonetaryFields } from "@/lib/brbyte/invoice-amount"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"

const now = new Date("2026-09-16T12:00:00.000Z")
const referenceDate = "2026-09-16"

function inv(pk: string, contractPk: string): CollectionSyncInvoice {
  const due = new Date(now)
  due.setUTCDate(due.getUTCDate() - 12)
  return {
    invoicePk: pk, contractPk, clientPk: null, customerName: "Cliente Fixture", customerDocument: "***0000",
    invoiceDueDate: due.toISOString(), invoiceMsg: null, invoiceDateCredit: null, isPaid: false,
    invoiceAmountDocument: 100, invoiceAmountPaid: 0, contractStatus: 1,
  }
}

type Resp = { afterMs: number; fail?: "error" }
/** Simula invoice_info: responde em afterMs se < timeout; senao timeout no deadline. */
function harness(n: number, responses: Resp[], opts: { listMs?: number; budgetMs?: number } = {}) {
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
  let nowMs = 0
  let inFlight = 0
  let maxInFlight = 0
  const seenTimeouts: number[] = []
  const started: string[] = []
  // Janela: as chamadas de uma janela correm em paralelo; o relogio avanca
  // pelo maior tempo observado (wall), nao pela soma.
  const run = () =>
    runOverdueDiscoveryBatch({
      store: createMemoryDiscoveryStore(), repo, owner: "w", actorProfileId: "actor", now,
      referenceInstant: now, referenceDate, minimumDaysOverdue: 5, collectionsEnabled: true,
      maxPages: 1, startedAtMs: 0, clock: () => nowMs,
      budgetMs: opts.budgetMs ?? COLLECTION_DISCOVERY_TIME_BUDGET_MS,
      detailConcurrency: 99,
      fetchPage: async ({ afterInvoicePk }) => {
        nowMs += opts.listMs ?? 30_000
        const page = rows.map((r) => r.invoicePk).filter((pk) => afterInvoicePk == null || Number(pk) > Number(afterInvoicePk)).slice(0, 15)
        return { ok: true, rows: page.map((invoicePk) => ({ invoicePk })), total: page.length }
      },
      toInvoice: (row) => byPk.get(String(row.invoicePk)) ?? null,
      prepareInvoice: async (invoice, _e, _n, ctx) => {
        const idx = started.length
        started.push(invoice.invoicePk)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        seenTimeouts.push(ctx?.timeoutMs ?? -1)
        const startAt = nowMs
        const r = responses[idx] ?? { afterMs: 1_000 }
        const timeout = ctx?.timeoutMs ?? COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS
        const elapsed = Math.min(r.afterMs, timeout)
        await new Promise((res) => setTimeout(res, 1))
        nowMs = Math.max(nowMs, startAt + elapsed)
        inFlight -= 1
        if (r.afterMs >= timeout) return { ok: false as const, failure: "timeout" as const }
        if (r.fail) return { ok: false as const, failure: "error" as const }
        return { ok: true as const, invoice }
      },
    })
  return { persistOrder, started, seenTimeouts, get maxInFlight() { return maxInFlight }, get nowMs() { return nowMs }, run }
}

describe("BJ 1 auditoria do campo pago (invoice/list)", () => {
  it("campo oficial e invoice_amount_paid; mapeamento ja existe; nenhum substituto aceito", () => {
    const m = extractInvoiceMonetaryFields({ invoice_amount_paid: "40.00", invoice_amount_document: 100 })
    assert.equal(m.invoiceAmountPaid, 40)
    for (const k of ["invoice_amount_credit", "invoice_amount_interest", "invoice_amount_discount",
      "invoice_amount_fine", "invoice_balance", "invoice_amount_net", "invoice_amount", "invoice_value"]) {
      const x = extractInvoiceMonetaryFields({ [k]: 50, invoice_amount_document: 100 })
      assert.equal(x.invoiceAmountPaid, null, `${k} nao pode virar valor pago`)
    }
  })
  it("ausencia do campo pago continua exigindo detalhe (nao assume 0)", () => {
    const raw: Record<string, unknown> = {
      invoice_pk: 101, contract_pk: 7, contract_status: 1, invoice_deleted: false,
      invoice_date_credit: null, invoice_amount_document: 100,
      invoice_msg: "", is_paid: false, invoice_amount_credit: 0,
    }
    const row = { invoicePk: "101", contractPk: "7", invoiceDueDate: "2026-09-01", invoiceDeleted: false, raw } as never
    const proof = collectionListRowFinancialProof(row)
    assert.equal(proof.proven, false)
    assert.equal(proof.reason, "missing_paid_amount")
    assert.equal(decideInvoiceDetailLookup({ needsDetailByRule: true, listFinancialProven: proof.proven }), "fetch")
  })
})

describe("BJ 2 timeout de invoice_info = 60000", () => {
  it("constantes preservadas", () => {
    assert.equal(COLLECTION_DISCOVERY_DETAIL_TIMEOUT_BEFORE_MS, 30_000)
    assert.equal(COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS, 60_000)
    assert.equal(COLLECTION_DETAIL_CONCURRENCY_DEFAULT, 2)
    assert.equal(COLLECTION_DETAIL_CONCURRENCY_MAX, 2)
    assert.equal(COLLECTION_DISCOVERY_LIST_TIMEOUT_MS, 70_000)
    assert.equal(COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S, 240)
    assert.equal(COLLECTION_DISCOVERY_TIME_BUDGET_MS, 220_000)
    assert.equal(COLLECTION_DISCOVERY_PLATFORM_MARGIN_MS, 20_000)
    assert.equal(COLLECTION_DISCOVERY_DETAIL_WINDOW_RESERVE_MS, 74_000)
  })
  for (const ms of [29_000, 31_000, 45_000, 59_000]) {
    it(`detalhe respondendo em ${ms / 1000}s e validado e persistido`, async () => {
      const h = harness(1, [{ afterMs: ms }])
      const r = await h.run()
      assert.deepEqual(h.seenTimeouts, [60_000])
      assert.deepEqual(h.persistOrder, ["1000"])
      assert.equal(r.cursorLastInvoicePk, "1000")
    })
  }
  it("timeout em 60s: nada persiste, cursor nao avanca, sem retry", async () => {
    const h = harness(2, [{ afterMs: 60_000 }, { afterMs: 10_000 }])
    const r = await h.run()
    assert.deepEqual(h.persistOrder, [])
    assert.equal(r.pauseStage, "detail_timeout")
    assert.equal(r.cursorLastInvoicePk, null)
    assert.equal(h.started.filter((x) => x === "1000").length, 1)
    assert.ok(h.nowMs <= 30_000 + 60_000 + 1)
  })
})

describe("BJ 2 paralelismo 2 e ordem", () => {
  it("duas chamadas paralelas >30s: wall < soma; max 2; ordem ASC", async () => {
    const h = harness(2, [{ afterMs: 45_000 }, { afterMs: 31_000 }])
    const r = await h.run()
    assert.equal(h.maxInFlight, 2)
    assert.deepEqual(h.persistOrder, ["1000", "1001"])
    assert.equal(r.cursorLastInvoicePk, "1001")
    assert.ok(h.nowMs - 30_000 < 45_000 + 31_000)
  })
  it("erro da primeira bloqueia a segunda", async () => {
    const h = harness(2, [{ afterMs: 31_000, fail: "error" }, { afterMs: 5_000 }])
    const r = await h.run()
    assert.deepEqual(h.persistOrder, [])
    assert.equal(r.pauseStage, "detail_error")
    assert.equal(r.cursorLastInvoicePk, null)
  })
  it("erro da segunda: prefixo parcial [1]; cursor seguro", async () => {
    const h = harness(3, [{ afterMs: 35_000 }, { afterMs: 40_000, fail: "error" }])
    const r = await h.run()
    assert.deepEqual(h.persistOrder, ["1000"])
    assert.equal(r.pauseStage, "detail_error")
    assert.equal(r.cursorLastInvoicePk, "1000")
    assert.equal(h.persistOrder.includes("1002"), false)
  })
})

describe("BJ 3 reserva pre-detalhe", () => {
  it("helper exige detail 60s + persist + release", () => {
    assert.equal(collectionDetailWindowFits({ remainingMs: 74_000 }), true)
    assert.equal(collectionDetailWindowFits({ remainingMs: 73_999 }), false)
  })
  it("sem orcamento: nao inicia a janela; pausa pre_detail_budget (nao timeout); prefixo confirmado", async () => {
    // lista 30s; janelas 2x50s terminam em 80/130/180s; em 180s restam 40s < 74s: 7a/8a nao iniciam.
    const h = harness(8, [{ afterMs: 50_000 }, { afterMs: 50_000 }, { afterMs: 50_000 }, { afterMs: 50_000 }, { afterMs: 50_000 }, { afterMs: 50_000 }, { afterMs: 50_000 }, { afterMs: 50_000 }])
    const r = await h.run()
    assert.equal(r.pauseStage, "pre_detail_budget")
    assert.deepEqual(h.persistOrder, ["1000", "1001", "1002", "1003", "1004", "1005"])
    assert.equal(h.started.includes("1006"), false)
    assert.equal(r.cursorLastInvoicePk, h.persistOrder[h.persistOrder.length - 1])
    assert.ok(h.nowMs <= COLLECTION_DISCOVERY_TIME_BUDGET_MS, `now=${h.nowMs}`)
    assert.equal(sanitizeDiscoveryErrorClass("pre_detail_budget:0") != null, true)
    assert.notEqual(decideSegmentStop({ ok: true, discoveryStatus: "paused", pauseStage: "pre_detail_budget", progressMade: true, capacityReached: false, availableAfter: 12 }), "timeout")
  })
  it("orcamento insuficiente ja na primeira posicao: nenhuma chamada inicia", async () => {
    const h = harness(2, [], { listMs: 60_000, budgetMs: 100_000 })
    const r = await h.run()
    assert.deepEqual(h.started, [])
    assert.equal(r.pauseStage, "pre_detail_budget")
    assert.equal(r.cursorLastInvoicePk, null)
  })
})

describe("BJ arquitetura", () => {
  it("sync usa timeout proprio de detalhe, nao config.timeoutMs", () => {
    const sync = readFileSync("lib/collections/sync.ts", "utf8")
    assert.match(sync, /configuredTimeoutMs: COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS/)
    assert.match(sync, /detailTimeoutMs: COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS/)
  })
})
