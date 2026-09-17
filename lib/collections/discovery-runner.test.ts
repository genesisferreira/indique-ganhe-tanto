import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  COLLECTION_DISCOVERY_LIVE_QUERY_COMBINATION_VALIDATED,
  COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH,
  COLLECTION_DISCOVERY_PAGE_SIZE,
  COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
  COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
  COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_MS,
  COLLECTION_DISCOVERY_TIME_BUDGET_MS,
  COLLECTION_DISCOVERY_TIMEZONE,
  collectionDiscoveryCappedTimeoutMs,
  sanitizeDiscoveryErrorClass,
} from "@/lib/collections/discovery-contract"
import { validateDiscoveryCheckpoint } from "@/lib/collections/discovery-checkpoint"
import { createMemoryDiscoveryCaseRepo } from "@/lib/collections/discovery-persist"
import { decideDiscoveryPersistAction } from "@/lib/collections/discovery-persist"
import { persistDiscoveredOverdueInvoice } from "@/lib/collections/discovery-persist"
import { simulateMutableOverduePages } from "@/lib/collections/discovery-page"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { createMemoryDiscoveryStore } from "@/lib/collections/discovery-store"
import {
  computeDaysOverdue,
  shouldOpenCollectionCase,
} from "@/lib/collections/eligibility"
import { collectionScanMayMutateCase } from "@/lib/collections/sync-source"
import { outstandingAmountFromInvoice } from "@/lib/collections/eligibility"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"

const now = new Date("2026-09-16T12:00:00.000Z")
const referenceDate = "2026-09-16"

function invoice(pk: string, daysOverdue: number): CollectionSyncInvoice {
  const due = new Date(now)
  due.setUTCDate(due.getUTCDate() - daysOverdue)
  return {
    invoicePk: pk,
    contractPk: "1",
    clientPk: "1",
    customerName: "Cliente Fixture",
    customerDocument: "***0000",
    invoiceDueDate: due.toISOString(),
    invoiceMsg: "open",
    invoiceDateCredit: null,
    isPaid: false,
    invoiceAmountDocument: 100,
    invoiceAmountPaid: 0,
  }
}

function pagesFromPks(pages: string[][]) {
  let calls = 0
  return {
    fetchPage: async () => {
      const current = pages[calls] ?? []
      calls += 1
      return {
        ok: true,
        rows: current.map((invoicePk) => ({ invoicePk })),
        total: 100,
      }
    },
    get calls() {
      return calls
    },
  }
}

describe("TEST A — primeira execução e retomada", () => {
  it("congela referência, cursor e contadores entre lotes", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    const fetch = pagesFromPks([
      ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"],
      ["25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39"],
    ])
    const first = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      maxPages: 1,
      budgetMs: 60_000,
      fetchPage: fetch.fetchPage,
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(first.ok, true)
    assert.equal(first.resumable, true)
    assert.equal(first.status, "paused")
    assert.equal(first.cursorLastInvoicePk, "24")
    assert.equal(first.referenceDate, referenceDate)
    assert.equal(first.created, 15)
    const secondNow = new Date("2026-09-17T12:00:00.000Z")
    const second = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w2",
      actorProfileId: "actor-1",
      now: secondNow,
      referenceInstant: secondNow,
      referenceDate: "2026-09-17",
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      maxPages: 1,
      budgetMs: 60_000,
      fetchPage: fetch.fetchPage,
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(second.runId, first.runId)
    assert.equal(second.referenceDate, referenceDate)
    assert.equal(second.referenceInstant, first.referenceInstant)
    assert.equal(second.cursorLastInvoicePk, "39")
    assert.equal(second.created, 30)
    assert.equal(second.coverageProven, false)
    assert.equal(second.uniqueOrderProven, false)
  })
})

describe("TEST B — orçamento pausa sem varrer a base", () => {
  it("para após o lote mesmo com mais páginas disponíveis", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    const fetch = pagesFromPks([
      ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"],
      ["25"],
    ])
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      maxPages: 1,
      budgetMs: 60_000,
      fetchPage: fetch.fetchPage,
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH < 571, true)
    assert.equal(COLLECTION_DISCOVERY_TIME_BUDGET_MS < COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_MS, true)
    assert.equal(COLLECTION_DISCOVERY_TIME_BUDGET_MS < 240_000, true)
    assert.equal(result.status, "paused")
    assert.equal(fetch.calls, 1)
    assert.equal(result.resumable, true)
    assert.equal(result.coverageProven, false)
  })
})

describe("TEST C — falha não avança cursor", () => {
  it("página com erro preserva o último identificador confirmado", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    let calls = 0
    const first = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      maxPages: 1,
      fetchPage: async () => {
        calls += 1
        return {
          ok: true,
          rows: ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"].map(
            (invoicePk) => ({ invoicePk })
          ),
          total: 40,
        }
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(first.cursorLastInvoicePk, "24")
    const failed = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w2",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      maxPages: 1,
      fetchPage: async () => ({
        ok: false,
        rows: [] as Array<{ invoicePk: string | null }>,
        total: null,
        message: "timeout",
      }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.resumable, true)
    assert.equal(failed.cursorLastInvoicePk, "24")
    assert.equal(calls, 1)
  })
})

describe("TEST D — reprocessamento idempotente", () => {
  it("não duplica caso, evento nem atribuição; preserva status operacional", async () => {
    const repo = createMemoryDiscoveryCaseRepo()
    const inv = invoice("88", 12)
    const first = await persistDiscoveredOverdueInvoice({
      invoice: inv,
      existing: null,
      now,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      actorProfileId: "actor-1",
      repo,
    })
    const existing = await repo.findByInvoicePk("88")
    assert.ok(existing)
    existing.status = "promise_to_pay"
    const second = await persistDiscoveredOverdueInvoice({
      invoice: inv,
      existing,
      now,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      actorProfileId: "actor-1",
      repo,
    })
    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(second.updated, true)
    assert.equal(repo.createdEvents.length, 1)
    assert.equal(repo.assignments.length, 1)
    assert.equal((await repo.findByInvoicePk("88"))?.status, "promise_to_pay")
  })
})

describe("TEST E — concorrência, expiração e fencing", () => {
  it("claim atômico, recuperação após lease e worker antigo bloqueado", async () => {
    const store = createMemoryDiscoveryStore()
    const t0 = new Date("2026-09-16T12:00:00.000Z")
    const first = await store.claimOrStart({
      owner: "old",
      now: t0,
      leaseMs: 1_000,
      referenceInstant: t0,
      referenceDate,
    })
    assert.equal(first.ok, true)
    const busy = await store.claimOrStart({
      owner: "other",
      now: t0,
      leaseMs: 1_000,
      referenceInstant: t0,
      referenceDate,
    })
    assert.equal(busy.ok, false)
    if (!busy.ok) assert.equal(busy.code, "busy")
    const recovered = await store.claimOrStart({
      owner: "new",
      now: new Date(t0.getTime() + 2_000),
      leaseMs: 1_000,
      referenceInstant: t0,
      referenceDate,
    })
    assert.equal(recovered.ok, true)
    if (!first.ok || !recovered.ok) return
    assert.equal(recovered.run.leaseGeneration > first.run.leaseGeneration, true)
    const stale = await store.advance({
      runId: first.run.id,
      owner: "old",
      generation: first.run.leaseGeneration,
      now: new Date(t0.getTime() + 2_000),
      cursorLastInvoicePk: "99",
      counters: {
        scannedPages: 1,
        scannedInvoices: 1,
        createdCount: 1,
        updatedCount: 0,
        skippedCount: 0,
        assignedCount: 0,
        unassignedCount: 0,
        errorCount: 0,
        reportedTotal: 1,
      },
    })
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.equal(stale.code, "stale_lease")
    const parallelStore = createMemoryDiscoveryStore()
    const [left, right] = await Promise.all([
      parallelStore.claimOrStart({
        owner: "a",
        now: t0,
        leaseMs: 5_000,
        referenceInstant: t0,
        referenceDate,
      }),
      parallelStore.claimOrStart({
        owner: "b",
        now: t0,
        leaseMs: 5_000,
        referenceInstant: t0,
        referenceDate,
      }),
    ])
    assert.equal([left, right].filter((item) => item.ok).length, 1)
    assert.equal([left, right].some((item) => !item.ok && item.code === "busy"), true)
  })
})

describe("TEST F — paginação mutável", () => {
  it("keyset não omite IDs posteriores quando um item anterior some; offset pode omitir", () => {
    const remainingAfterPayment = ["10", "30", "40", "50"]
    const keysetCursor = "20"
    const simulated = simulateMutableOverduePages({
      remainingPks: remainingAfterPayment,
      afterInvoicePk: keysetCursor,
      offsetStart: 2,
      limit: 2,
    })
    assert.deepEqual(simulated.keyset, ["30", "40"])
    assert.deepEqual(simulated.offset, ["40", "50"])
    assert.equal(COLLECTION_DISCOVERY_LIVE_QUERY_COMBINATION_VALIDATED, false)
    assert.equal(simulated.offset.includes("30"), false)
  })
})

describe("TEST G — identificadores inválidos não encerram a paginação", () => {
  it("IDs repetidos ou sem progressão falham de forma retomável", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      fetchPage: async () => ({
        ok: true,
        rows: [{ invoicePk: "10" }, { invoicePk: "10" }],
        total: 2,
      }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(result.ok, false)
    assert.equal(result.status, "failed")
    assert.equal(result.resumable, true)
    assert.notEqual(result.status, "pagination_ended")
  })
})

describe("TEST H — contrato financeiro", () => {
  it("mínimo de 5 dias UTC permanece e ausência não paga", () => {
    const four = computeDaysOverdue({
      invoiceDueDate: invoice("1", 4).invoiceDueDate,
      now,
    })
    const five = computeDaysOverdue({
      invoiceDueDate: invoice("2", 5).invoiceDueDate,
      now,
    })
    assert.equal(four, 4)
    assert.equal(five, 5)
    assert.equal(
      shouldOpenCollectionCase({ daysOverdue: four, isPaid: false, invoicePk: "1" }),
      false
    )
    assert.equal(
      shouldOpenCollectionCase({ daysOverdue: five, isPaid: false, invoicePk: "2" }),
      true
    )
    assert.equal(
      decideDiscoveryPersistAction({
        invoice: { ...invoice("3", 12), isPaid: true },
        existing: { id: "case-3", status: "open", invoicePk: "3" },
        now,
        minimumDaysOverdue: 5,
        collectionsEnabled: true,
      }),
      "skip"
    )
    assert.equal(
      collectionScanMayMutateCase({
        invoicePk: "absent",
        scannedInvoicePks: new Set(["seen"]),
      }),
      false
    )
    assert.equal(
      outstandingAmountFromInvoice({ invoiceAmountDocument: 180, invoiceAmountPaid: 20 }),
      160
    )
    assert.equal(COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION.includes("keyset"), true)
    assert.equal(COLLECTION_DISCOVERY_PAGE_SIZE, 15)
  })
})

describe("checkpoint incompatível não retoma em silêncio", () => {
  it("versão de contrato diferente permanece bloqueada", async () => {
    const seeded = {
      id: "11111111-1111-4111-8111-111111111111",
      queryContractVersion: "overdue-invoice-list.offset.v0",
      referenceInstant: now.toISOString(),
      referenceDate,
      discoveryTimezone: COLLECTION_DISCOVERY_TIMEZONE,
      paginationStrategy: COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
      cursorLastInvoicePk: "24",
      status: "paused" as const,
      leaseOwner: null,
      leaseUntil: null,
      leaseGeneration: 1,
      scannedPages: 1,
      scannedInvoices: 15,
      createdCount: 15,
      updatedCount: 0,
      skippedCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      errorCount: 0,
      reportedTotal: 40,
      lastErrorClass: null,
      coverageProven: false as const,
      uniqueOrderProven: false as const,
      phase: "discovery" as const,
      reconcileCursorInvoicePk: null,
      reconcileScannedCount: 0,
      reconcileClosedCount: 0,
      reconcileSkippedCount: 0,
    }
    const store = createMemoryDiscoveryStore([seeded])
    const repo = createMemoryDiscoveryCaseRepo()
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      runId: seeded.id,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      fetchPage: async () => ({
        ok: true,
        rows: [] as Array<{ invoicePk: string | null }>,
        total: 0,
      }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(result.ok, false)
    assert.equal(result.status, "incompatible_contract")
    assert.equal(result.resumable, false)
    const validated = validateDiscoveryCheckpoint(seeded)
    assert.equal(validated.ok, false)
    if (!validated.ok) assert.equal(validated.code, "incompatible_contract")
  })
})

describe("TEST I — segurança", () => {
  it("não persiste credenciais e preserva autorização da rota", () => {
    assert.equal(sanitizeDiscoveryErrorClass("cookie=abc; Authorization: Bearer x"), "sanitized_error")
    assert.equal(sanitizeDiscoveryErrorClass("page_error"), "page_error")
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")
    const sql = readFileSync(join(repoRoot, "supabase/patch-collection-discovery-checkpoint.sql"), "utf8")
    const reconSql = readFileSync(
      join(repoRoot, "supabase/patch-collection-discovery-reconciliation.sql"),
      "utf8"
    )
    assert.equal(sql.includes("cookie"), false)
    assert.equal(/password|authorization|bearer|secret/i.test(sql), false)
    assert.equal(reconSql.includes("cookie"), false)
    assert.equal(/password|authorization|bearer|secret/i.test(reconSql), false)
    const route = readFileSync(join(repoRoot, "app/api/admin/collections/sync/route.ts"), "utf8")
    assert.match(route, /authorizeOperationalRequest/)
    assert.match(route, /action: "sync"/)
    const sync = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    const logStart = sync.indexOf('scope: "discovery-page"')
    assert.equal(logStart > 0, true)
    assert.equal(sync.slice(logStart, logStart + 180).includes("cookie"), false)
    assert.equal(sync.includes("login.cookie"), true)
  })
})

describe("TEST J — regressões de probe, primeira fatura e contrato", () => {
  it("consumidores financeiros permanecem fora da consulta de atrasados", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")
    const invoiceList = readFileSync(join(repoRoot, "lib/brbyte/invoice-list.ts"), "utf8")
    const firstInvoice = readFileSync(join(repoRoot, "lib/brbyte/check-first-invoice.service.ts"), "utf8")
    const probe = readFileSync(join(repoRoot, "lib/brbyte/invoice-list-probe.ts"), "utf8")
    const contractFn = invoiceList.slice(invoiceList.indexOf("export async function listContractInvoices"))
    assert.match(contractFn, /where\[contract_pk\]/)
    assert.equal(contractFn.includes("invoice_date_credit"), false)
    assert.equal(firstInvoice.includes("listOverdueInvoices"), false)
    assert.equal(probe.includes("listOverdueInvoices"), false)
    assert.equal(probe.includes("runOverdueDiscoveryBatch"), false)
  })
})

describe("orçamento de duração com relógio controlado", () => {
  it("não inicia consulta quando a margem de persistência/release não cabe", async () => {
    assert.equal(
      collectionDiscoveryCappedTimeoutMs({
        remainingMs: 4_000,
        configuredTimeoutMs: 30_000,
      }),
      null
    )
    assert.equal(
      collectionDiscoveryCappedTimeoutMs({
        remainingMs: 20_000,
        configuredTimeoutMs: 30_000,
      }),
      15_000
    )
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    let fetches = 0
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => 44_500,
      budgetMs: 45_000,
      configuredTimeoutMs: 30_000,
      fetchPage: async () => {
        fetches += 1
        return { ok: true, rows: [{ invoicePk: "10" }], total: 1 }
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(fetches, 0)
    assert.equal(result.status, "paused")
    assert.equal(result.resumable, true)
    assert.equal(result.cursorLastInvoicePk, null)
  })

  it("pausa no meio da página sem avançar o cursor", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    let nowMs = 0
    const page = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"]
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => nowMs,
      budgetMs: 20_000,
      configuredTimeoutMs: 5_000,
      fetchPage: async ({ timeoutMs }) => {
        assert.equal(timeoutMs <= 5_000, true)
        nowMs += 12_000
        return {
          ok: true,
          rows: page.map((invoicePk) => ({ invoicePk })),
          total: 15,
        }
      },
      prepareInvoice: async (invoice) => {
        nowMs += 4_000
        return invoice
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(result.status, "paused")
    assert.equal(result.resumable, true)
    assert.equal(result.cursorLastInvoicePk, null)
    assert.equal(result.created >= 1, true)
    assert.equal(result.created < 15, true)
    assert.equal(result.coverageProven, false)
  })

  it("consulta recebe timeout capado ao restante menos margem", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    let seenTimeout = 0
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => 25_000,
      budgetMs: 45_000,
      configuredTimeoutMs: 30_000,
      fetchPage: async ({ timeoutMs }) => {
        seenTimeout = timeoutMs
        return { ok: true, rows: [] as Array<{ invoicePk: string | null }>, total: 0 }
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(seenTimeout, 15_000)
    assert.equal(result.status, "pagination_ended")
  })

  it("listagem ~11,2s pausa pelo orçamento sem exigir quatro páginas", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    let nowMs = 0
    let fetches = 0
    const pages: Record<string, string[]> = {
      "": ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"],
      "24": ["25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39"],
      "39": ["40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54"],
      "54": ["55", "56", "57", "58", "59", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69"],
    }
    const first = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => nowMs,
      budgetMs: 45_000,
      configuredTimeoutMs: 30_000,
      maxPages: 4,
      fetchPage: async ({ afterInvoicePk, timeoutMs }) => {
        assert.equal(timeoutMs <= 30_000, true)
        fetches += 1
        nowMs += 11_200
        const rows = pages[afterInvoicePk ?? ""] ?? []
        return {
          ok: true,
          rows: rows.map((invoicePk) => ({ invoicePk })),
          total: 60,
        }
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(fetches < 4, true)
    assert.equal(fetches >= 1, true)
    assert.equal(first.status, "paused")
    assert.equal(first.resumable, true)
    assert.equal(first.cursorLastInvoicePk, "54")
    assert.equal(first.coverageProven, false)

    nowMs = 0
    const second = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w2",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => nowMs,
      budgetMs: 45_000,
      configuredTimeoutMs: 30_000,
      maxPages: 1,
      fetchPage: async ({ afterInvoicePk }) => {
        nowMs += 11_200
        const rows = pages[afterInvoicePk ?? ""] ?? []
        return {
          ok: true,
          rows: rows.map((invoicePk) => ({ invoicePk })),
          total: 60,
        }
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(second.runId, first.runId)
    assert.equal(second.referenceDate, first.referenceDate)
    assert.equal(second.cursorLastInvoicePk, "69")
    assert.equal(second.created, first.created + 15)
  })

  it("página lenta impede a próxima e preserva o cursor confirmado", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    let nowMs = 0
    let fetches = 0
    const page = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"]
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => nowMs,
      budgetMs: 45_000,
      configuredTimeoutMs: 5_000,
      maxPages: 4,
      fetchPage: async () => {
        fetches += 1
        nowMs += 30_000
        return { ok: true, rows: page.map((invoicePk) => ({ invoicePk })), total: 30 }
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(fetches, 1)
    assert.equal(result.status, "paused")
    assert.equal(result.cursorLastInvoicePk, "24")
    assert.equal(result.resumable, true)
  })

  it("erro de persistência próximo da expiração não avança o cursor", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    repo.persistFencedInvoice = async () => {
      throw new Error("persist timeout")
    }
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "w1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => 20_000,
      budgetMs: 45_000,
      configuredTimeoutMs: 5_000,
      fetchPage: async () => ({
        ok: true,
        rows: [{ invoicePk: "10" }],
        total: 1,
      }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(result.ok, false)
    assert.equal(result.status, "failed")
    assert.equal(result.resumable, true)
    assert.equal(result.cursorLastInvoicePk, null)
  })

  it("lease stale no persist impede caso, evento e atribuição", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo({
      leaseGate: () => false,
    })
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "stale",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      fetchPage: async () => ({
        ok: true,
        rows: [{ invoicePk: "10" }],
        total: 1,
      }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
    })
    assert.equal(result.ok, false)
    assert.equal(result.status, "failed")
    assert.equal(repo.cases.size, 0)
    assert.equal(repo.createdEvents.length, 0)
    assert.equal(repo.assignments.length, 0)
    assert.equal(result.cursorLastInvoicePk, null)
  })
})

describe("reconciliação retomável no runner existente", () => {
  function paidDetail(invoicePk: string) {
    return {
      outcome: "close_paid" as const,
      requestedInvoicePk: invoicePk,
      returnedInvoicePk: invoicePk,
      errorClass: null,
      evidence: {
        isPaid: true,
        invoiceMsg: "paid",
        invoiceDateCredit: "2026-09-10",
        invoiceDeleted: false,
      },
    }
  }

  it("pausa a reconciliação e retoma sem duplicar fechamento", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    await repo.insertOpen({ invoice_pk: "81" })
    await repo.insertOpen({ invoice_pk: "82" })
    let details = 0
    let nowMs = 0
    const first = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "recon-1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => nowMs,
      budgetMs: 16_000,
      configuredTimeoutMs: 5_000,
      fetchPage: async () => ({ ok: true, rows: [] as Array<{ invoicePk: string | null }>, total: 0 }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
      fetchInvoiceDetail: async ({ invoicePk }) => {
        details += 1
        nowMs += 12_000
        return paidDetail(invoicePk)
      },
    })
    assert.equal(first.ok, true)
    assert.equal(first.resumable, true)
    assert.equal(first.status, "paused")
    assert.equal(first.phase, "reconciliation")
    assert.equal(first.closedPaid, 1)
    assert.equal(repo.paymentEvents.length, 1)
    const firstPk = repo.cases.get("81")?.status === "paid" ? "81" : "82"
    const secondPk = firstPk === "81" ? "82" : "81"
    assert.equal(repo.cases.get(firstPk)?.status, "paid")
    assert.equal(repo.cases.get(secondPk)?.status, "open")

    nowMs = 0
    const second = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "recon-2",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      startedAtMs: 0,
      clock: () => nowMs,
      budgetMs: 45_000,
      configuredTimeoutMs: 5_000,
      fetchPage: async () => {
        throw new Error("discovery should not run after phase change")
      },
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
      fetchInvoiceDetail: async ({ invoicePk }) => paidDetail(invoicePk),
    })
    assert.equal(second.runId, first.runId)
    assert.equal(second.referenceDate, first.referenceDate)
    assert.equal(second.referenceInstant, first.referenceInstant)
    assert.equal(second.status, "phases_completed")
    assert.equal(second.closedPaid, 2)
    assert.equal(repo.paymentEvents.length, 2)
    assert.equal(repo.cases.get("81")?.status, "paid")
    assert.equal(repo.cases.get("82")?.status, "paid")
    assert.equal(repo.assignments.length, 0)
    assert.equal(details >= 1, true)
  })

  it("timeout no detalhe não avança o cursor e retoma o mesmo caso", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo()
    await repo.insertOpen({ invoice_pk: "91" })
    const outcomes = ["timeout_or_error", "close_paid"] as const
    let calls = 0
    const first = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "timeout-1",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      fetchPage: async () => ({ ok: true, rows: [] as Array<{ invoicePk: string | null }>, total: 0 }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
      fetchInvoiceDetail: async ({ invoicePk }) => {
        const outcome = outcomes[Math.min(calls, outcomes.length - 1)]
        calls += 1
        if (outcome === "timeout_or_error") {
          return {
            outcome,
            requestedInvoicePk: invoicePk,
            returnedInvoicePk: null,
            errorClass: "detail_timeout",
            evidence: null,
          }
        }
        return paidDetail(invoicePk)
      },
    })
    assert.equal(first.status, "paused")
    assert.equal(first.reconcileCursorInvoicePk, null)
    assert.equal(repo.cases.get("91")?.status, "open")
    const second = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "timeout-2",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      fetchPage: async () => ({ ok: true, rows: [] as Array<{ invoicePk: string | null }>, total: 0 }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
      fetchInvoiceDetail: async ({ invoicePk }) => {
        const outcome = outcomes[Math.min(calls, outcomes.length - 1)]
        calls += 1
        if (outcome === "timeout_or_error") {
          return {
            outcome,
            requestedInvoicePk: invoicePk,
            returnedInvoicePk: null,
            errorClass: "detail_timeout",
            evidence: null,
          }
        }
        return paidDetail(invoicePk)
      },
    })
    assert.equal(second.status, "phases_completed")
    assert.equal(repo.cases.get("91")?.status, "paid")
    assert.equal(repo.paymentEvents.length, 1)
  })

  it("worker antigo com lease stale não fecha caso nem emite evento", async () => {
    const store = createMemoryDiscoveryStore()
    const repo = createMemoryDiscoveryCaseRepo({ leaseGate: () => false })
    await repo.insertOpen({ invoice_pk: "92" })
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "stale-recon",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      fetchPage: async () => ({ ok: true, rows: [] as Array<{ invoicePk: string | null }>, total: 0 }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
      fetchInvoiceDetail: async ({ invoicePk }) => paidDetail(invoicePk),
    })
    assert.equal(result.ok, false)
    assert.equal(repo.cases.get("92")?.status, "open")
    assert.equal(repo.paymentEvents.length, 0)
  })

  it("missing_migration falha de forma retomável e não marca fases concluídas", async () => {
    const base = createMemoryDiscoveryStore()
    const store = {
      ...base,
      enterReconciliation: async () => ({ ok: false as const, code: "missing_migration" as const }),
    }
    const repo = createMemoryDiscoveryCaseRepo()
    await repo.insertOpen({ invoice_pk: "93" })
    const result = await runOverdueDiscoveryBatch({
      store,
      repo,
      owner: "missing-sql",
      actorProfileId: "actor-1",
      now,
      referenceInstant: now,
      referenceDate,
      minimumDaysOverdue: 5,
      collectionsEnabled: true,
      fetchPage: async () => ({ ok: true, rows: [] as Array<{ invoicePk: string | null }>, total: 0 }),
      toInvoice: (row) => invoice(String(row.invoicePk), 12),
      fetchInvoiceDetail: async ({ invoicePk }) => paidDetail(invoicePk),
    })
    assert.equal(result.ok, false)
    assert.equal(result.status, "failed")
    assert.equal(result.resumable, true)
    assert.notEqual(result.status, "pagination_ended")
    assert.notEqual(result.status, "phases_completed")
    assert.match(result.message, /migration ausente/)
    assert.equal(repo.cases.get("93")?.status, "open")
    assert.equal(repo.paymentEvents.length, 0)
  })
})

