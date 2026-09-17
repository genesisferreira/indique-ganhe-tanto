import { parseOverdueInvoicePk } from "@/lib/brbyte/overdue-invoice-list-query"
import {
  COLLECTION_DISCOVERY_LEASE_MS,
  COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH,
  COLLECTION_DISCOVERY_PAGE_SIZE,
  COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS,
  COLLECTION_DISCOVERY_TIME_BUDGET_MS,
  collectionDiscoveryCappedTimeoutMs,
  collectionDiscoveryRemainingBudgetMs,
  collectionDiscoveryShouldStopForTime,
  sanitizeDiscoveryErrorClass,
  type CollectionDiscoveryCounters,
  type CollectionDiscoveryPhase,
  type CollectionDiscoveryRun,
  type CollectionDiscoveryStatus,
} from "@/lib/collections/discovery-contract"
import { validateDiscoveryPageProgression } from "@/lib/collections/discovery-page"
import {
  persistDiscoveredOverdueInvoice,
  type DiscoveryCaseRepo,
} from "@/lib/collections/discovery-persist"
import type { DiscoveryStore } from "@/lib/collections/discovery-store"
import {
  reconciliationAdvancesCursor,
  shouldWriteReconciliationClosePaid,
  type ReconciliationDetailResult,
} from "@/lib/collections/reconciliation"
import type { CollectionSyncInvoice, ExistingCollectionCase } from "@/lib/collections/sync-decision"

export type DiscoveryFetchedPage<TRow extends { invoicePk: string | null } = { invoicePk: string | null }> = {
  ok: boolean
  rows: TRow[]
  total: number | null
  httpStatus?: number | null
  message?: string
}

export type DiscoveryRunnerDeps<TRow extends { invoicePk: string | null } = { invoicePk: string | null }> = {
  store: DiscoveryStore
  repo: DiscoveryCaseRepo
  owner: string
  actorProfileId: string
  now: Date
  referenceInstant: Date
  referenceDate: string
  clock?: () => number
  startedAtMs?: number
  configuredTimeoutMs?: number
  leaseMs?: number
  budgetMs?: number
  maxPages?: number
  fetchPage: (input: {
    referenceDate: string
    afterInvoicePk: string | null
    timeoutMs: number
  }) => Promise<DiscoveryFetchedPage<TRow>>
  toInvoice: (row: TRow) => CollectionSyncInvoice | null
  prepareInvoice?: (
    invoice: CollectionSyncInvoice,
    existing: ExistingCollectionCase | null,
    frozenNow: Date
  ) => Promise<CollectionSyncInvoice>
  fetchInvoiceDetail?: (input: {
    invoicePk: string
    timeoutMs: number
    referenceDate: string
  }) => Promise<ReconciliationDetailResult>
  minimumDaysOverdue: number
  collectionsEnabled: boolean
  runId?: string | null
}

export type DiscoveryBatchResult = {
  ok: boolean
  resumable: boolean
  status: CollectionDiscoveryStatus | "busy" | "incompatible_contract"
  runId: string | null
  referenceInstant: string | null
  referenceDate: string | null
  cursorLastInvoicePk: string | null
  scannedPages: number
  scannedInvoices: number
  created: number
  updated: number
  skipped: number
  assigned: number
  unassigned: number
  errors: number
  truncated: boolean
  coverageProven: false
  uniqueOrderProven: false
  phase: CollectionDiscoveryPhase | null
  reconcileCursorInvoicePk: string | null
  closedPaid: number
  message: string
}

function countersFromRun(run: CollectionDiscoveryRun): CollectionDiscoveryCounters {
  return {
    scannedPages: run.scannedPages,
    scannedInvoices: run.scannedInvoices,
    createdCount: run.createdCount,
    updatedCount: run.updatedCount,
    skippedCount: run.skippedCount,
    assignedCount: run.assignedCount,
    unassignedCount: run.unassignedCount,
    errorCount: run.errorCount,
    reportedTotal: run.reportedTotal,
  }
}

function resultFromRun(
  run: CollectionDiscoveryRun,
  extra: Partial<DiscoveryBatchResult> & { ok: boolean; resumable: boolean; message: string },
  liveCounters?: CollectionDiscoveryCounters
): DiscoveryBatchResult {
  const source = liveCounters ?? countersFromRun(run)
  return {
    status: run.status,
    runId: run.id,
    referenceInstant: run.referenceInstant,
    referenceDate: run.referenceDate,
    cursorLastInvoicePk: run.cursorLastInvoicePk,
    scannedPages: source.scannedPages,
    scannedInvoices: source.scannedInvoices,
    created: source.createdCount,
    updated: source.updatedCount,
    skipped: source.skippedCount,
    assigned: source.assignedCount,
    unassigned: source.unassignedCount,
    errors: source.errorCount,
    truncated: run.status === "paused" || run.status === "failed",
    coverageProven: false,
    uniqueOrderProven: false,
    phase: run.phase,
    reconcileCursorInvoicePk: run.reconcileCursorInvoicePk,
    closedPaid: run.reconcileClosedCount,
    ...extra,
  }
}

export async function runOverdueDiscoveryBatch<
  TRow extends { invoicePk: string | null } = { invoicePk: string | null },
>(input: DiscoveryRunnerDeps<TRow>): Promise<DiscoveryBatchResult> {
  const clock = input.clock ?? Date.now
  const startedAtMs = input.startedAtMs ?? clock()
  const budgetMs = input.budgetMs ?? COLLECTION_DISCOVERY_TIME_BUDGET_MS
  const maxPages = input.maxPages ?? COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH
  const configuredTimeoutMs = input.configuredTimeoutMs ?? 30_000
  const claim = await input.store.claimOrStart({
    owner: input.owner,
    now: input.now,
    leaseMs: input.leaseMs ?? COLLECTION_DISCOVERY_LEASE_MS,
    referenceInstant: input.referenceInstant,
    referenceDate: input.referenceDate,
    runId: input.runId,
  })

  if (!claim.ok) {
    const message =
      claim.code === "busy"
        ? "Descoberta de atrasados já em execução."
        : claim.code === "incompatible_contract"
          ? "Checkpoint incompatível com o contrato atual. Não retomado."
          : "Não foi possível iniciar a descoberta retomável."
    return {
      ok: false,
      resumable: claim.code === "busy",
      status: claim.code === "busy" ? "busy" : claim.code === "incompatible_contract" ? "incompatible_contract" : "failed",
      runId: input.runId ?? null,
      referenceInstant: null,
      referenceDate: null,
      cursorLastInvoicePk: null,
      scannedPages: 0,
      scannedInvoices: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      assigned: 0,
      unassigned: 0,
      errors: 0,
      truncated: false,
      coverageProven: false,
      uniqueOrderProven: false,
      phase: null,
      reconcileCursorInvoicePk: null,
      closedPaid: 0,
      message,
    }
  }

  const frozenNow = new Date(claim.run.referenceInstant)
  const owner = input.owner
  const generation = claim.run.leaseGeneration
  let run = claim.run
  let counters = countersFromRun(run)
  let lastPageDurationMs = 8_000
  let pagesThisBatch = 0

  const fail = async (errorClass: string, message: string) => {
    const sanitized = sanitizeDiscoveryErrorClass(errorClass)
    await input.store.release({
      runId: run.id,
      owner,
      generation,
      status: "failed",
      lastErrorClass: sanitized,
    })
    return resultFromRun(
      { ...run, status: "failed", lastErrorClass: sanitized },
      { ok: false, resumable: true, message },
      counters
    )
  }

  const pause = async (message: string) => {
    const released = await input.store.release({
      runId: run.id,
      owner,
      generation,
      status: "paused",
    })
    const paused = released.ok ? released.run : { ...run, status: "paused" as const }
    return resultFromRun(paused, { ok: true, resumable: true, message }, counters)
  }

  const endPaginationWithoutRecon = async (message: string) => {
    const released = await input.store.release({
      runId: run.id,
      owner,
      generation,
      status: "pagination_ended",
    })
    const ended = released.ok ? released.run : { ...run, status: "pagination_ended" as const }
    return resultFromRun(ended, {
      ok: true,
      resumable: false,
      truncated: false,
      message,
    })
  }

  const runReconciliation = async (): Promise<DiscoveryBatchResult> => {
    if (run.phase !== "reconciliation") {
      const entered = await input.store.enterReconciliation({
        runId: run.id,
        owner,
        generation,
        now: input.now,
      })
      if (!entered.ok) {
        if (entered.code === "missing_migration") {
          return fail(
            "missing_migration",
            "Reconciliação indisponível: migration ausente. Não marca conclusão das fases. Aplique o patch e retome a mesma execução."
          )
        }
        return fail("stale_lease", "Lease perdida ao entrar na reconciliação.")
      }
      run = entered.run
    }

    const fetchDetail = input.fetchInvoiceDetail
    if (!fetchDetail) {
      return endPaginationWithoutRecon(
        "Paginação da descoberta encerrou neste recorte. Encerramento da paginação não prova cobertura global."
      )
    }

    const lease = { runId: run.id, owner, generation }
    let reconScanned = run.reconcileScannedCount
    let reconClosed = run.reconcileClosedCount
    let reconSkipped = run.reconcileSkippedCount
    let reconCursor = run.reconcileCursorInvoicePk
    let reconPages = 0
    let lastDetailDurationMs = 8_000

    while (reconPages < maxPages) {
      const remaining = collectionDiscoveryRemainingBudgetMs({
        startedAtMs,
        nowMs: clock(),
        budgetMs,
      })
      if (
        collectionDiscoveryShouldStopForTime({
          remainingMs: remaining,
          lastPageDurationMs: lastDetailDurationMs,
        })
      ) {
        return pause(
          "Lote pausado por orçamento na reconciliação. Cursor permanece no último identificador confirmado. Conclusão operacional não comprovada."
        )
      }
      const queryTimeoutMs = collectionDiscoveryCappedTimeoutMs({
        remainingMs: remaining,
        configuredTimeoutMs,
      })
      if (queryTimeoutMs == null) {
        return pause(
          "Lote pausado: orçamento restante insuficiente para detalhe com margem de persistência/release."
        )
      }

      const listed = await input.repo.listOpenAfter({
        lease,
        afterInvoicePk: reconCursor,
        limit: COLLECTION_DISCOVERY_PAGE_SIZE,
      })
      if (!listed.ok) {
        if (listed.code === "missing_migration") {
          return fail(
            "missing_migration",
            "Reconciliação indisponível: migration ausente. Não marca conclusão das fases. Aplique o patch e retome a mesma execução."
          )
        }
        if (listed.code === "stale_lease") {
          return fail("stale_lease", "Lease perdida. Worker antigo não listou casos para reconciliação.")
        }
        return fail("persist_error", "Falha ao listar casos abertos para reconciliação. Cursor não avançou.")
      }

      if (listed.cases.length === 0) {
        const released = await input.store.release({
          runId: run.id,
          owner,
          generation,
          status: "phases_completed",
        })
        const ended = released.ok
          ? released.run
          : { ...run, status: "phases_completed" as const, phase: "reconciliation" as const }
        return resultFromRun(
          ended,
          {
            ok: true,
            resumable: false,
            truncated: false,
            message:
              "Fases operacionais desta execução encerraram neste recorte. Conclusão operacional não prova cobertura global.",
          },
          counters
        )
      }

      let processedAll = true
      for (const existing of listed.cases) {
        const invoicePk = parseOverdueInvoicePk(existing.invoicePk)
        if (!invoicePk) continue
        const remainingForDetail = collectionDiscoveryRemainingBudgetMs({
          startedAtMs,
          nowMs: clock(),
          budgetMs,
        })
        if (remainingForDetail < COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS) {
          processedAll = false
          break
        }
        const detailTimeout = collectionDiscoveryCappedTimeoutMs({
          remainingMs: remainingForDetail,
          configuredTimeoutMs,
        })
        if (detailTimeout == null) {
          processedAll = false
          break
        }

        const detailStarted = clock()
        const classified = await fetchDetail({
          invoicePk,
          timeoutMs: detailTimeout,
          referenceDate: run.referenceDate,
        })
        lastDetailDurationMs = Math.max(1, clock() - detailStarted)

        if (!reconciliationAdvancesCursor(classified.outcome)) {
          processedAll = false
          break
        }

        reconScanned += 1
        if (
          shouldWriteReconciliationClosePaid({
            outcome: classified.outcome,
            currentStatus: existing.status,
          })
        ) {
          const remainingForPersist = collectionDiscoveryRemainingBudgetMs({
            startedAtMs,
            nowMs: clock(),
            budgetMs,
          })
          const closed = await input.repo.reconcilePaidFenced({
            lease,
            caseId: existing.id,
            invoicePk,
            actorProfileId: input.actorProfileId,
            evidence: classified.evidence
              ? {
                  source: "collections_controllr_reconciliation",
                  invoice_msg: classified.evidence.invoiceMsg,
                  invoice_date_credit: classified.evidence.invoiceDateCredit,
                  isPaid: classified.evidence.isPaid,
                }
              : { source: "collections_controllr_reconciliation" },
            statementTimeoutMs: Math.max(
              1,
              remainingForPersist - COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS
            ),
          })
          if (!closed.ok) {
            if (closed.code === "stale_lease") {
              return fail("stale_lease", "Lease perdida. Worker antigo não fechou o caso.")
            }
            if (closed.code === "identity_mismatch") {
              reconSkipped += 1
            } else {
              return fail(
                "persist_error",
                "Falha ao persistir fechamento. Cursor de reconciliação não avançou."
              )
            }
          } else if (closed.closed) {
            reconClosed += 1
          } else {
            reconSkipped += 1
          }
        } else {
          reconSkipped += 1
        }

        const advanced = await input.store.advanceReconciliation({
          runId: run.id,
          owner,
          generation,
          now: new Date(input.now.getTime() + Math.max(0, clock() - startedAtMs)),
          reconcileCursorInvoicePk: invoicePk,
          reconcileScannedCount: reconScanned,
          reconcileClosedCount: reconClosed,
          reconcileSkippedCount: reconSkipped,
        })
        if (!advanced.ok) {
          if (advanced.code === "missing_migration") {
            return fail(
              "missing_migration",
              "Reconciliação indisponível: migration ausente. Não marca conclusão das fases. Aplique o patch e retome a mesma execução."
            )
          }
          return fail("stale_lease", "Lease perdida. Worker antigo não avançou o checkpoint de reconciliação.")
        }
        run = advanced.run
        reconCursor = run.reconcileCursorInvoicePk
      }

      reconPages += 1
      if (!processedAll) {
        return pause(
          "Lote pausado no meio da reconciliação. Cursor permanece no último identificador confirmado; reprocessamento é idempotente."
        )
      }
    }

    return pause(
      "Lote pausado no limite de páginas da reconciliação. Retome a mesma execução; cobertura global não comprovada."
    )
  }

  if (run.phase === "reconciliation") {
    return runReconciliation()
  }

  while (pagesThisBatch < maxPages) {
    const remainingBeforeFetch = collectionDiscoveryRemainingBudgetMs({
      startedAtMs,
      nowMs: clock(),
      budgetMs,
    })
    if (
      collectionDiscoveryShouldStopForTime({
        remainingMs: remainingBeforeFetch,
        lastPageDurationMs,
      })
    ) {
      const released = await input.store.release({
        runId: run.id,
        owner,
        generation,
        status: "paused",
      })
      const paused = released.ok ? released.run : { ...run, status: "paused" as const }
      return resultFromRun(
        paused,
        {
          ok: true,
          resumable: true,
          message:
            "Lote pausado por orçamento de duração. Retome a mesma execução; cobertura global não comprovada.",
        },
        counters
      )
    }

    const queryTimeoutMs = collectionDiscoveryCappedTimeoutMs({
      remainingMs: remainingBeforeFetch,
      configuredTimeoutMs,
    })
    if (queryTimeoutMs == null) {
      const released = await input.store.release({
        runId: run.id,
        owner,
        generation,
        status: "paused",
      })
      const paused = released.ok ? released.run : { ...run, status: "paused" as const }
      return resultFromRun(
        paused,
        {
          ok: true,
          resumable: true,
          message:
            "Lote pausado: orçamento restante insuficiente para consulta com margem de persistência/release.",
        },
        counters
      )
    }

    const pageStarted = clock()
    const fetched = await input.fetchPage({
      referenceDate: run.referenceDate,
      afterInvoicePk: run.cursorLastInvoicePk,
      timeoutMs: queryTimeoutMs,
    })
    lastPageDurationMs = Math.max(1, clock() - pageStarted)

    if (!fetched.ok) {
      return fail(
        "page_error",
        "Falha na página da descoberta. Cursor não avançou. Sem retry automático."
      )
    }

    const progression = validateDiscoveryPageProgression({
      invoicePks: fetched.rows.map((row) => row.invoicePk),
      afterInvoicePk: run.cursorLastInvoicePk,
    })
    if (!progression.ok) {
      return fail(
        progression.code,
        "Página inválida ou sem progressão de invoice_pk. Não marca encerramento da paginação."
      )
    }

    if (progression.invoicePks.length === 0) {
      if (input.fetchInvoiceDetail) return runReconciliation()
      return endPaginationWithoutRecon(
        "Paginação da descoberta encerrou neste recorte. Encerramento da paginação não prova cobertura global."
      )
    }

    const lease = { runId: run.id, owner, generation }
    let processedAll = true
    for (const row of fetched.rows) {
      const remainingForPersist = collectionDiscoveryRemainingBudgetMs({
        startedAtMs,
        nowMs: clock(),
        budgetMs,
      })
      if (remainingForPersist < COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS) {
        processedAll = false
        break
      }
      const invoice = input.toInvoice(row)
      const pk = invoice ? parseOverdueInvoicePk(invoice.invoicePk) : null
      if (!invoice || !pk) {
        counters.skippedCount += 1
        continue
      }
      counters.scannedInvoices += 1
      const existing = await input.repo.findByInvoicePk(pk)
      try {
        const hydrateTimeout = collectionDiscoveryCappedTimeoutMs({
          remainingMs: remainingForPersist,
          configuredTimeoutMs,
        })
        if (input.prepareInvoice && hydrateTimeout == null) {
          processedAll = false
          break
        }
        const prepared = input.prepareInvoice
          ? await input.prepareInvoice(invoice, existing, frozenNow)
          : invoice
        const persisted = await persistDiscoveredOverdueInvoice({
          invoice: prepared,
          existing,
          now: frozenNow,
          minimumDaysOverdue: input.minimumDaysOverdue,
          collectionsEnabled: input.collectionsEnabled,
          actorProfileId: input.actorProfileId,
          repo: input.repo,
          lease,
          statementTimeoutMs: Math.max(
            1,
            remainingForPersist - COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS
          ),
        })
        if (persisted.staleLease) {
          return fail("stale_lease", "Lease perdida. Worker antigo não gravou o restante da página.")
        }
        if (persisted.created) counters.createdCount += 1
        if (persisted.updated) counters.updatedCount += 1
        if (persisted.skipped) counters.skippedCount += 1
        if (persisted.newlyAssigned) counters.assignedCount += 1
        if (persisted.created && persisted.unassigned) counters.unassignedCount += 1
      } catch {
        counters.errorCount += 1
        return fail(
          "persist_error",
          "Falha ao persistir página. Cursor permanece no último identificador confirmado."
        )
      }
    }

    if (!processedAll) {
      const released = await input.store.release({
        runId: run.id,
        owner,
        generation,
        status: "paused",
      })
      const paused = released.ok ? released.run : { ...run, status: "paused" as const }
      return resultFromRun(
        paused,
        {
          ok: true,
          resumable: true,
          message:
            "Lote pausado no meio da página. Cursor não avançou; reprocessamento da página é idempotente.",
        },
        counters
      )
    }

    counters.scannedPages += 1
    counters.reportedTotal = fetched.total
    pagesThisBatch += 1
    const advanced = await input.store.advance({
      runId: run.id,
      owner,
      generation,
      now: new Date(input.now.getTime() + Math.max(0, clock() - startedAtMs)),
      cursorLastInvoicePk: progression.lastInvoicePk,
      counters,
    })
    if (!advanced.ok) {
      return fail("stale_lease", "Lease perdida. Worker antigo não avançou o checkpoint.")
    }
    run = advanced.run
    counters = countersFromRun(run)

    if (progression.invoicePks.length < COLLECTION_DISCOVERY_PAGE_SIZE) {
      if (input.fetchInvoiceDetail) return runReconciliation()
      return endPaginationWithoutRecon(
        "Paginação da descoberta encerrou neste recorte. Encerramento da paginação não prova cobertura global."
      )
    }
  }

  const released = await input.store.release({
    runId: run.id,
    owner,
    generation,
    status: "paused",
  })
  const paused = released.ok ? released.run : { ...run, status: "paused" as const }
  return resultFromRun(paused, {
    ok: true,
    resumable: true,
    message:
      "Lote pausado no limite de páginas. Retome a mesma execução; cobertura global não comprovada.",
  })
}
