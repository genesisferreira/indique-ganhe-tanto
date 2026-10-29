/**
 * Sprint 3.1E-AU — lote operacional por CONTRATO (sem ERP, sem banco).
 * Cobre A–F, J–L, O–S, T–Z, AA–AF, AJ–AK, AN, AS–AZ (puros/memória).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
  COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
  COLLECTION_DISCOVERY_TIMEZONE,
} from "@/lib/collections/discovery-contract"
import { persistDiscoveredOverdueInvoice } from "@/lib/collections/discovery-persist"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { createMemoryDiscoveryStore } from "@/lib/collections/discovery-store"
import { createMemoryContractCaseRepo } from "@/lib/collections/contract-case-memory"
import {
  CUSTOMER_DEDUPLICATION_SCOPE,
  contractBlockIndicator,
  decideContractCaseClosure,
} from "@/lib/collections/operational-model"
import {
  decideNextBatch,
  nextBatchConfirmMessage,
  readNextBatchBody,
  sanitizeNextBatchResult,
} from "@/lib/collections/next-batch"
import {
  buildContractCardView,
  nextBatchButtonState,
  nextBatchToast,
} from "@/lib/collections/contract-card"
import { interpretContractLockResult } from "@/lib/collections/contract-lock"
import type { CollectionSyncInvoice } from "@/lib/collections/sync-decision"
import type { CollectionCaseListItem } from "@/types/collections"

const now = new Date("2026-09-16T12:00:00.000Z")
const referenceDate = "2026-09-16"
const lease = { runId: "r", owner: "o", generation: 1 }

function inv(pk: string, contractPk: string | null, opts: Partial<CollectionSyncInvoice> & { days?: number } = {}): CollectionSyncInvoice {
  const due = new Date(now)
  due.setUTCDate(due.getUTCDate() - (opts.days ?? 12))
  return {
    invoicePk: pk,
    contractPk,
    clientPk: null,
    customerName: "Cliente Fixture",
    customerDocument: "***0000",
    invoiceDueDate: due.toISOString(),
    invoiceMsg: "open",
    invoiceDateCredit: null,
    isPaid: false,
    invoiceAmountDocument: 100,
    invoiceAmountPaid: 0,
    contractStatus: 1,
    ...opts,
  }
}

async function persist(repo: ReturnType<typeof createMemoryContractCaseRepo>, invoice: CollectionSyncInvoice) {
  return persistDiscoveredOverdueInvoice({
    invoice,
    existing: await repo.findByInvoicePk(invoice.invoicePk),
    now,
    minimumDaysOverdue: 5,
    collectionsEnabled: true,
    actorProfileId: "actor",
    repo,
    lease,
  })
}

function keysetPages(rows: CollectionSyncInvoice[]) {
  const byPk = new Map(rows.map((r) => [r.invoicePk, r]))
  const sorted = rows.map((r) => r.invoicePk).sort((a, b) => Number(a) - Number(b))
  let calls = 0
  return {
    byPk,
    get calls() {
      return calls
    },
    fetchPage: async ({ afterInvoicePk }: { afterInvoicePk: string | null }) => {
      calls += 1
      const page = sorted.filter((pk) => afterInvoicePk == null || Number(pk) > Number(afterInvoicePk)).slice(0, 15)
      return { ok: true, rows: page.map((invoicePk) => ({ invoicePk })), total: sorted.length }
    },
  }
}

function runBatch(input: {
  store: ReturnType<typeof createMemoryDiscoveryStore>
  repo: ReturnType<typeof createMemoryContractCaseRepo>
  pages: ReturnType<typeof keysetPages>
  owner?: string
  contractSlots?: number | null
  runId?: string | null
}) {
  return runOverdueDiscoveryBatch({
    store: input.store,
    repo: input.repo,
    owner: input.owner ?? "w1",
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
    fetchPage: input.pages.fetchPage,
    toInvoice: (row) => input.pages.byPk.get(String(row.invoicePk)) ?? null,
    contractSlots: input.contractSlots ?? null,
    runId: input.runId ?? null,
  })
}

describe("3.1E-AU modelo por contrato", () => {
  it("A/B/C/D — 1ª fatura cria caso; 2ª e 3ª reutilizam; repetida não duplica", async () => {
    const repo = createMemoryContractCaseRepo()
    const a = await persist(repo, inv("1", "7"))
    assert.equal(a.outcome, "case_created")
    const b = await persist(repo, inv("2", "7"))
    assert.equal(b.outcome, "invoice_attached")
    const c = await persist(repo, inv("3", "7"))
    assert.equal(c.outcome, "invoice_attached")
    const d = await persist(repo, inv("3", "7"))
    assert.equal(d.outcome, "invoice_updated")
    assert.equal(repo.cases.size, 1)
    assert.equal(repo.links.size, 3)
    assert.equal(repo.createdEvents.length, 1)
    assert.equal(repo.assignments.length, 1)
    assert.equal([...repo.links.values()].every((l) => l.caseId === "case-1"), true)
  })

  it("E/F — contratos diferentes → blocos diferentes; mesmo cliente hipotético continua em dois blocos", async () => {
    const repo = createMemoryContractCaseRepo()
    await persist(repo, inv("1", "7", { customerName: "Mesmo Nome", customerDocument: "***1111" }))
    await persist(repo, inv("2", "8", { customerName: "Mesmo Nome", customerDocument: "***1111" }))
    assert.equal(repo.cases.size, 2)
    assert.equal(CUSTOMER_DEDUPLICATION_SCOPE, "contract_only")
  })

  it("O/P — contract_status 5 excluído; 4 (bloqueado) elegível", async () => {
    const repo = createMemoryContractCaseRepo()
    const cancelled = await persist(repo, inv("1", "7", { contractStatus: 5 }))
    assert.equal(cancelled.skipped, true)
    assert.equal(cancelled.skipReason, "cancelled_contract")
    assert.equal(repo.cases.size, 0)
    const blocked = await persist(repo, inv("2", "8", { contractStatus: 4 }))
    assert.equal(blocked.created, true)
  })

  it("Q/R/S — faixa ≥15 só visual; 3 faturas e client_status não inferem cancelamento", async () => {
    assert.equal(contractBlockIndicator({ contractStatus: 1, daysOverdue: 15 }), "Em faixa de bloqueio")
    assert.equal(decideContractCaseClosure([{ payment: "open" }, { payment: "open" }, { payment: "open" }]).action, "keep_open")
    const repo = createMemoryContractCaseRepo()
    const r = await persist(repo, inv("1", "7", { clientStatus: 1 }))
    assert.equal(r.created, true)
    const card = readFileSync("lib/collections/contract-card.ts", "utf8")
    assert.equal(/fetch\(|brbyte|controllr_write|invoice_update/i.test(card), false)
  })

  it("sem contract_pk → inconclusivo, sem caso e sem PII como chave", async () => {
    const repo = createMemoryContractCaseRepo()
    const r = await persist(repo, inv("1", null))
    assert.equal(r.skipped, true)
    assert.equal(repo.cases.size, 0)
  })
})

describe("3.1E-AU capacidade e próxima leva", () => {
  it("J — capacity_full/busy decididos antes do ERP", () => {
    assert.deepEqual(decideNextBatch({ summary: { available: 0, busy: false }, enabled: true, inFlight: false }).proceed, false)
    const full = decideNextBatch({ summary: { available: 0, busy: false }, enabled: true, inFlight: false })
    assert.equal(full.proceed === false && full.code, "capacity_full")
    const busy = decideNextBatch({ summary: { available: 5, busy: true }, enabled: true, inFlight: false })
    assert.equal(busy.proceed === false && busy.code, "busy")
    const dbl = decideNextBatch({ summary: { available: 5, busy: false }, enabled: true, inFlight: true })
    assert.equal(dbl.proceed === false && dbl.code, "in_flight")
    assert.deepEqual(decideNextBatch({ summary: { available: 5, busy: false }, enabled: true, inFlight: false }), { proceed: true, slots: 5 })
    // 3.1E-BB: o gate vive no fluxo durável (um segmento por requisição).
    const svc = readFileSync("lib/collections/next-batch.service.ts", "utf8")
    const flow = readFileSync("lib/collections/batch-operation-flow.ts", "utf8")
    const gateAt = flow.indexOf("decideNextBatch(")
    const syncAt = flow.indexOf("deps.runSegment(")
    assert.equal(gateAt > 0 && syncAt > gateAt, true)
    assert.match(flow, /if \(!decision\.proceed\)[\s\S]*?return[\s\S]*?deps\.runSegment\(/)
    assert.match(svc, /syncCollectionsFromControllr\(/)
    assert.equal(/brbyteAdminLogin|listOverdueInvoicesPage/.test(svc), false)
  })

  it("K/L/capacity_reached — ativo não consome; novo consome; para sem pular fatura", async () => {
    const repo = createMemoryContractCaseRepo()
    await persist(repo, inv("5", "7")) // contrato 7 já ativo
    const rows = [inv("10", "7"), inv("11", "8"), inv("12", "7"), inv("13", "9"), inv("14", "10"), inv("15", "11")]
    const pages = keysetPages(rows)
    const store = createMemoryDiscoveryStore()
    const first = await runBatch({ store, repo, pages, contractSlots: 2 })
    assert.equal(first.pauseStage, "capacity_reached")
    assert.equal(first.capacityReached, true)
    assert.equal(first.contractsAdmitted, 2)
    assert.equal(first.cursorLastInvoicePk, "13")
    assert.equal(repo.cases.size, 3)
    assert.equal(repo.links.get("12")?.caseId, repo.links.get("5")?.caseId)
    assert.equal(first.consecutiveNoProgress, 0)
    const second = await runBatch({ store, repo, pages, contractSlots: 1, owner: "w2" })
    assert.equal(second.contractsAdmitted, 1)
    assert.equal(second.cursorLastInvoicePk, "14")
    assert.equal(repo.links.has("14"), true)
    assert.equal(repo.links.has("15"), false)
  })

  it("multi-página — preenche vagas lendo páginas seguintes dentro do orçamento", async () => {
    const repo = createMemoryContractCaseRepo()
    const rows = Array.from({ length: 20 }, (_, i) => inv(String(i + 1), i < 15 ? "7" : String(100 + i)))
    const pages = keysetPages(rows)
    const store = createMemoryDiscoveryStore()
    const r = await runBatch({ store, repo, pages, contractSlots: 3 })
    assert.equal(pages.calls >= 2, true)
    assert.equal(r.contractsAdmitted, 3)
    assert.equal(repo.cases.size, 3)
    assert.equal([...repo.links.values()].filter((l) => l.contractPk === "7").length, 15)
  })

  it("corpo sem runId; confirmação obrigatória; resposta agregada sem IDs", () => {
    assert.equal(readNextBatchBody({ runId: "x", confirm: true }).ok, false)
    assert.equal(readNextBatchBody({}).ok, false)
    assert.equal(readNextBatchBody({ confirm: true }).ok, true)
    const out = sanitizeNextBatchResult({ ok: true, contractsAdmitted: 2, created: 2, updated: 3 })
    assert.equal("runId" in out, false)
    assert.equal(JSON.stringify(out).includes("case-"), false)
    assert.equal(nextBatchConfirmMessage(4), "Carregar até 4 novos contratos elegíveis?")
  })
})

describe("3.1E-AU prefixo confirmado integrado", () => {
  it("T — 15 itens completos → cursor no 15º", async () => {
    const repo = createMemoryContractCaseRepo()
    const rows = Array.from({ length: 15 }, (_, i) => inv(String(i + 1), "7"))
    const r = await runBatch({ store: createMemoryDiscoveryStore(), repo, pages: keysetPages(rows) })
    assert.equal(r.cursorLastInvoicePk, "15")
  })

  it("U/V — três confirmados, quarto falha → cursor no 3º e o 4º reaparece", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => inv(String(i + 1), String(10 + i)))
    const pages = keysetPages(rows)
    const store = createMemoryDiscoveryStore()
    const failing = createMemoryContractCaseRepo({ failOnInvoicePk: "4" })
    const first = await runBatch({ store, repo: failing, pages })
    assert.equal(first.status, "failed")
    assert.equal(first.pauseStage, "persist_error")
    assert.equal(first.cursorLastInvoicePk, "3")
    assert.equal(first.scannedInvoices, 3)
    assert.equal(failing.links.has("4"), false)
    const seen: Array<string | null> = []
    const healed = createMemoryContractCaseRepo()
    await runOverdueDiscoveryBatch({
      store, repo: healed, owner: "w2", actorProfileId: "actor", now, referenceInstant: now, referenceDate,
      minimumDaysOverdue: 5, collectionsEnabled: true, startedAtMs: 0, clock: () => 0, budgetMs: 100_000,
      configuredTimeoutMs: 5_000,
      fetchPage: async (q) => { seen.push(q.afterInvoicePk); return pages.fetchPage(q) },
      toInvoice: (row) => pages.byPk.get(String(row.invoicePk)) ?? null,
    })
    assert.equal(seen[0], "3")
    assert.equal(healed.links.has("4"), true)
  })

  it("W — primeira falha → sem cursor", async () => {
    const rows = [inv("1", "7"), inv("2", "8")]
    const r = await runBatch({
      store: createMemoryDiscoveryStore(),
      repo: createMemoryContractCaseRepo({ failOnInvoicePk: "1" }),
      pages: keysetPages(rows),
    })
    assert.equal(r.cursorLastInvoicePk, null)
  })

  it("X — worker com lease antiga é bloqueado e não grava", async () => {
    const repo = createMemoryContractCaseRepo({ leaseGate: () => false })
    const r = await runBatch({ store: createMemoryDiscoveryStore(), repo, pages: keysetPages([inv("1", "7")]) })
    assert.equal(r.ok, false)
    assert.equal(repo.cases.size, 0)
    assert.equal(r.cursorLastInvoicePk, null)
  })

  it("Y/Z/AN — run paused compatível retoma do cursor; cursor monotônico; avanço zera no-progress", async () => {
    const paused = {
      id: "22222222-2222-4222-8222-222222222222",
      queryContractVersion: COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
      referenceInstant: now.toISOString(),
      referenceDate,
      discoveryTimezone: COLLECTION_DISCOVERY_TIMEZONE,
      paginationStrategy: COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
      cursorLastInvoicePk: "5",
      status: "paused" as const,
      leaseOwner: null,
      leaseUntil: null,
      leaseGeneration: 3,
      scannedPages: 0,
      scannedInvoices: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      errorCount: 0,
      reportedTotal: null,
      lastErrorClass: "partial_page:1",
      consecutiveNoProgress: 1,
      coverageProven: false as const,
      uniqueOrderProven: false as const,
      phase: "discovery" as const,
      reconcileCursorInvoicePk: null,
      reconcileScannedCount: 0,
      reconcileClosedCount: 0,
      reconcileSkippedCount: 0,
    }
    const store = createMemoryDiscoveryStore([paused])
    const repo = createMemoryContractCaseRepo()
    const rows = [inv("3", "1"), inv("6", "7"), inv("7", "8")]
    const r = await runBatch({ store, repo, pages: keysetPages(rows), contractSlots: 1 })
    assert.equal(r.runId, paused.id)
    assert.equal(repo.links.has("3"), false)
    assert.equal(r.cursorLastInvoicePk, "6")
    assert.equal(r.consecutiveNoProgress, 0)
  })
})

describe("3.1E-AU pagamento parcial e idempotência", () => {
  it("AA/AB/AC/AF — 1 e 2 de 3 pagas mantêm aberto; todas fecham; evento por fatura idempotente", async () => {
    const repo = createMemoryContractCaseRepo()
    for (const pk of ["1", "2", "3"]) await persist(repo, inv(pk, "7"))
    const call = (invoicePk: string) =>
      repo.reconcilePaidFenced({ lease, caseId: "case-1", invoicePk, actorProfileId: "actor" })
    const a = await call("1")
    assert.equal(a.code, "partial_paid")
    assert.equal(repo.cases.get("case-1")?.status, "open")
    const again = await call("1")
    assert.equal(again.eventInserted, false)
    assert.equal((await call("2")).code, "partial_paid")
    const last = await call("3")
    assert.equal(last.code, "closed")
    assert.equal(repo.cases.get("case-1")?.status, "paid")
    assert.equal(repo.paymentEvents.length, 3)
    assert.equal(repo.assignments.length, 1)
  })

  it("AD/AE — ausência não fecha; cancelamento não é pagamento", () => {
    assert.equal(decideContractCaseClosure([{ payment: "paid" }, { payment: "absent" }]).action, "keep_open")
    assert.equal(decideContractCaseClosure([{ payment: "cancelled" }]).action, "route_cancellation_flow")
  })

  it("AJ/AK — reprocessamento não reatribui e round-robin não avança duas vezes", async () => {
    const repo = createMemoryContractCaseRepo()
    const rows = [inv("1", "7"), inv("2", "7"), inv("3", "8")]
    await runBatch({ store: createMemoryDiscoveryStore(), repo, pages: keysetPages(rows) })
    const ticks = repo.roundRobinTicks
    await runBatch({ store: createMemoryDiscoveryStore(), repo, pages: keysetPages(rows), owner: "w9" })
    assert.equal(repo.roundRobinTicks, ticks)
    assert.equal(repo.createdEvents.length, 2)
    assert.equal(repo.assignments.length, 2)
  })
})

describe("3.1E-AU trava de contato (interpretação)", () => {
  it("AG — outro atendente com trava ativa bloqueia; sucesso permite", () => {
    assert.equal(interpretContractLockResult({ ok: false, code: "locked_by_other" }, false).allowed, false)
    assert.equal(interpretContractLockResult({ ok: true, code: "acquired" }, false).allowed, true)
    assert.equal(interpretContractLockResult({ ok: true, code: "recovered_expired" }, false).allowed, true)
    const route = readFileSync("app/api/cobranca/cases/[id]/contact/route.ts", "utf8")
    assert.match(route, /acquireContractContactLock/)
    assert.equal(route.indexOf("acquireContractContactLock({") < route.indexOf("registerCollectionContact({"), true)
  })
})

describe("3.1E-AU UI por contrato", () => {
  const base: CollectionCaseListItem = {
    id: "c1", clientPk: null, contractPk: "77", invoicePk: "1", customerName: "X", customerDocument: null,
    daysOverdue: 20, overdueSince: "2026-08-01", outstandingAmount: 100, status: "open", sectorAssignmentId: null,
    erpSnapshot: {}, metadata: {}, createdAt: "", updatedAt: "", closedAt: null,
    assigneeEmployeeId: null, assigneeName: "Atendente", lastContactAt: null,
    contractStatus: 1, followUpDueAt: null,
    invoices: Array.from({ length: 5 }, (_, i) => ({
      invoicePk: String(i + 1), dueDate: `2026-08-0${i + 1}`, daysOverdue: 20 - i,
      paymentStatus: i === 0 ? ("paid" as const) : ("open" as const), resolvedAt: null,
    })),
  }
  it("AS/AT — um card por contrato com >3 faturas e pagamento parcial", () => {
    const card = buildContractCardView(base, now)
    assert.equal(card.invoices.length, 5)
    assert.equal(card.paidCount, 1)
    assert.equal(card.overdueCount, 4)
    assert.equal(card.states.includes("Pagamento parcial"), true)
    assert.equal(card.states.includes("Em faixa de bloqueio"), true)
  })
  it("AU/AV/AX — capacity_full, busy e clique em andamento desabilitam", () => {
    assert.equal(nextBatchButtonState({ summary: { available: 0, busy: false }, submitting: false }).disabled, true)
    assert.equal(nextBatchButtonState({ summary: { available: 3, busy: true }, submitting: false }).disabled, true)
    assert.equal(nextBatchButtonState({ summary: { available: 3, busy: false }, submitting: true }).disabled, true)
    assert.equal(nextBatchButtonState({ summary: { available: 3, busy: false }, submitting: false }).disabled, false)
  })
  it("AW/AY/AZ — confirmação mostra vagas; aviso contract-only; sem PII em toasts/logs", () => {
    const page = readFileSync("app/cobranca/page.tsx", "utf8")
    assert.match(page, /nextBatchConfirmMessage\(summary\.availableCapacity\)/)
    assert.match(page, /CONTRACT_SCOPE_NOTICE/)
    assert.match(page, /inFlight\.current/)
    assert.equal(/body: JSON\.stringify\(\{[^}]*runId/.test(page), false)
    const toastText = nextBatchToast({ ok: true, contractsAdmitted: 2, invoicesUpdatedOrAttached: 3, capacityReached: true })
    assert.equal(/\d{3}\.\d{3}|@|case-|Cliente/.test(toastText), false)
    const svc = readFileSync("lib/collections/next-batch.service.ts", "utf8")
    const logs = svc.match(/console\.log\([\s\S]*?\}\)/g) ?? []
    for (const log of logs) assert.equal(/customer|document|invoicePk|contractPk|caseId|runId/i.test(log), false)
  })
})
