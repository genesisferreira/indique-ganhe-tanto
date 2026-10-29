import { decideConfirmedPrefixAdvance } from "@/lib/collections/discovery-prefix"
import { parseOverdueInvoicePk } from "@/lib/brbyte/overdue-invoice-list-query"
import {
  COLLECTION_DISCOVERY_LEASE_MS,
  COLLECTION_DISCOVERY_LIST_TIMEOUT_MS,
  COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS,
  COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH,
  COLLECTION_DISCOVERY_PAGE_SIZE,
  COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS,
  COLLECTION_DISCOVERY_RELEASE_SLACK_MS,
  COLLECTION_DISCOVERY_TIME_BUDGET_MS,
  collectionDiscoveryCappedTimeoutMs,
  collectionDiscoveryListTimeoutMs,
  collectionDiscoveryRemainingBudgetMs,
  collectionDiscoveryShouldStopForTime,
  formatDiscoveryPauseClass,
  readConsecutiveNoProgress,
  sanitizeDiscoveryErrorClass,
  type CollectionDiscoveryCounters,
  type CollectionDiscoveryPhase,
  type CollectionDiscoveryRun,
  type CollectionDiscoveryStatus,
  type DiscoveryPauseStage,
} from "@/lib/collections/discovery-contract"
import { validateDiscoveryPageProgression } from "@/lib/collections/discovery-page"
import {
  decideDiscoveryPersistAction,
  persistDiscoveredOverdueInvoice,
  type DiscoveryCaseRepo,
} from "@/lib/collections/discovery-persist"
import { parseProvenPk } from "@/lib/collections/operational-model"
import type { DiscoveryStore } from "@/lib/collections/discovery-store"
import {
  reconciliationAdvancesCursor,
  shouldWriteReconciliationClosePaid,
  type ReconciliationDetailResult,
} from "@/lib/collections/reconciliation"
import {
  classifyUnmappedDiscoveryRow,
  emptyDiscoverySkipHistogram,
  incrementDiscoverySkip,
  sanitizeDiscoverySkipHistogram,
  sumDiscoverySkipHistogram,
  type DiscoverySkipHistogram,
} from "@/lib/collections/skip-reason"
import type { CollectionSyncInvoice, ExistingCollectionCase } from "@/lib/collections/sync-decision"

export type DiscoveryFetchedPage<TRow extends { invoicePk: string | null } = { invoicePk: string | null }> = {
  ok: boolean
  rows: TRow[]
  total: number | null
  httpStatus?: number | null
  message?: string
  abortClass?: "timeout" | "external_abort" | "transport"
  bodyReadComplete?: boolean
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
    referenceInstant: string
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
  /**
   * Sprint 3.1E-AU: vagas de contratos novos neste lote ("Carregar próxima
   * leva"). Ausente = sem limite (compatibilidade com o Sync legado).
   * Fatura de contrato já ativo não consome vaga; contrato novo consome uma.
   */
  contractSlots?: number | null
  /** Sprint 3.1E-BA: contadores cumulativos da run no claim (delta por segmento). */
  onClaim?: (counters: CollectionDiscoveryCounters) => void
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
  pauseStage: DiscoveryPauseStage | null
  progressMade: boolean
  consecutiveNoProgress: number
  listDurationMs: number | null
  persistenceDurationMs: number | null
  remainingBeforeListMs: number | null
  remainingAfterListMs: number | null
  skippedThisBatch: number
  skipReasons: DiscoverySkipHistogram
  /** Sprint 3.1E-AU: contratos novos admitidos neste lote (agregado). */
  contractsAdmitted?: number
  capacityReached?: boolean
}

const LIST_WAIT_TIMEOUT = Symbol("list-wait-timeout")

async function awaitListPageOrTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | typeof LIST_WAIT_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof LIST_WAIT_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(LIST_WAIT_TIMEOUT), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  const skipReasons = sanitizeDiscoverySkipHistogram(
    extra.skipReasons ?? emptyDiscoverySkipHistogram()
  )
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
    pauseStage: extra.pauseStage ?? null,
    progressMade: extra.progressMade ?? false,
    consecutiveNoProgress: extra.consecutiveNoProgress ?? run.consecutiveNoProgress ?? 0,
    listDurationMs: extra.listDurationMs ?? null,
    persistenceDurationMs: extra.persistenceDurationMs ?? null,
    remainingBeforeListMs: extra.remainingBeforeListMs ?? null,
    remainingAfterListMs: extra.remainingAfterListMs ?? null,
    ...extra,
    skipReasons,
    skippedThisBatch: extra.skippedThisBatch ?? sumDiscoverySkipHistogram(skipReasons),
  }
}

export async function runOverdueDiscoveryBatch<
  TRow extends { invoicePk: string | null } = { invoicePk: string | null },
>(input: DiscoveryRunnerDeps<TRow>): Promise<DiscoveryBatchResult> {
  const clock = input.clock ?? Date.now
  const startedAtMs = input.startedAtMs ?? clock()
  const budgetMs = input.budgetMs ?? COLLECTION_DISCOVERY_TIME_BUDGET_MS
  const maxPages = input.maxPages ?? COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH
  const configuredTimeoutMs = input.configuredTimeoutMs ?? COLLECTION_DISCOVERY_LIST_TIMEOUT_MS
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
      pauseStage: null,
      progressMade: false,
      consecutiveNoProgress: 0,
      listDurationMs: null,
      persistenceDurationMs: null,
      remainingBeforeListMs: null,
      remainingAfterListMs: null,
      skippedThisBatch: 0,
      skipReasons: emptyDiscoverySkipHistogram(),
    }
  }

  const frozenNow = new Date(claim.run.referenceInstant)
  const owner = input.owner
  const generation = claim.run.leaseGeneration
  let run = claim.run
  let counters = countersFromRun(run)
  input.onClaim?.({ ...counters })
  let lastPageDurationMs = 8_000
  let pagesThisBatch = 0
  const skipReasons = emptyDiscoverySkipHistogram()
  const contractSlots =
    typeof input.contractSlots === "number" && Number.isFinite(input.contractSlots)
      ? Math.max(0, Math.floor(input.contractSlots))
      : null
  let contractsAdmitted = 0
  const admittedContracts = new Set<string>()

  const fail = async (
    errorClass: string,
    message: string,
    extra: Partial<DiscoveryBatchResult> = {}
  ) => {
    const sanitized = sanitizeDiscoveryErrorClass(errorClass)
    const consecutive =
      extra.consecutiveNoProgress ??
      (errorClass === "zero_progress_loop"
        ? COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS
        : readConsecutiveNoProgress(run))
    await input.store.release({
      runId: run.id,
      owner,
      generation,
      status: "failed",
      lastErrorClass: sanitized,
      consecutiveNoProgress: consecutive,
    })
    return resultFromRun(
      {
        ...run,
        status: "failed",
        lastErrorClass: sanitized,
        consecutiveNoProgress: consecutive,
      },
      {
        ok: false,
        resumable: errorClass !== "zero_progress_loop",
        message,
        pauseStage: errorClass === "zero_progress_loop" ? "zero_progress_loop" : extra.pauseStage ?? null,
        consecutiveNoProgress: consecutive,
        contractsAdmitted,
        ...extra,
        skipReasons,
        skippedThisBatch: sumDiscoverySkipHistogram(skipReasons),
      },
      counters
    )
  }

  const pause = async (
    message: string,
    extra: Partial<DiscoveryBatchResult> & {
      lastErrorClass?: string | null
      consecutiveNoProgress?: number
    } = {}
  ) => {
    const consecutive = extra.consecutiveNoProgress ?? readConsecutiveNoProgress(run)
    const released = await input.store.release({
      runId: run.id,
      owner,
      generation,
      status: "paused",
      lastErrorClass: extra.lastErrorClass,
      consecutiveNoProgress: consecutive,
    })
    const paused = released.ok ? released.run : { ...run, status: "paused" as const, consecutiveNoProgress: consecutive }
    return resultFromRun(
      paused,
      {
        ok: true,
        resumable: true,
        message,
        consecutiveNoProgress: consecutive,
        contractsAdmitted,
        ...extra,
        skipReasons,
        skippedThisBatch: sumDiscoverySkipHistogram(skipReasons),
      },
      counters
    )
  }

  const pauseNoProgress = async (
    stage: DiscoveryPauseStage,
    message: string,
    extra: Partial<DiscoveryBatchResult> = {}
  ) => {
    const consecutive = readConsecutiveNoProgress(run) + 1
    if (consecutive >= COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS) {
      return fail(
        "zero_progress_loop",
        "Dois lotes seguidos sem progresso. Não retomar em silêncio. Não criar outra run; confirme o orçamento da função antes de retomar a mesma execução.",
        {
          pauseStage: "zero_progress_loop",
          progressMade: false,
          consecutiveNoProgress: consecutive,
          ...extra,
        }
      )
    }
    return pause(message, {
      lastErrorClass: formatDiscoveryPauseClass(stage, consecutive),
      pauseStage: stage,
      progressMade: false,
      consecutiveNoProgress: consecutive,
      ...extra,
    })
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
      contractsAdmitted,
      ok: true,
      resumable: false,
      truncated: false,
      message,
      skipReasons,
      skippedThisBatch: sumDiscoverySkipHistogram(skipReasons),
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
            skipReasons,
            skippedThisBatch: sumDiscoverySkipHistogram(skipReasons),
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

  if (readConsecutiveNoProgress(run) >= COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS) {
    return fail(
      "zero_progress_loop",
      "Dois lotes seguidos sem progresso. Não retomar em silêncio. Não criar outra run; confirme o orçamento da função antes de retomar a mesma execução.",
      {
        pauseStage: "zero_progress_loop",
        progressMade: false,
        consecutiveNoProgress: COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS,
      }
    )
  }

  if (run.phase === "reconciliation") {
    return runReconciliation()
  }

  const cursorAtClaim = run.cursorLastInvoicePk
  const pagesAtClaim = counters.scannedPages
  const invoicesAtClaim = counters.scannedInvoices

  while (pagesThisBatch < maxPages) {
    const remainingBeforeFetch = collectionDiscoveryRemainingBudgetMs({
      startedAtMs,
      nowMs: clock(),
      budgetMs,
    })
    const remainingBeforeListMs = remainingBeforeFetch
    if (
      collectionDiscoveryShouldStopForTime({
        remainingMs: remainingBeforeFetch,
        lastPageDurationMs,
      })
    ) {
      if (pagesThisBatch === 0 && counters.scannedInvoices === invoicesAtClaim) {
        return pauseNoProgress(
          "pre_list_budget",
          "Lote pausado por orçamento de duração. Consulta ERP não iniciada.",
          { remainingBeforeListMs }
        )
      }
      return pause(
        "Lote pausado por orçamento de duração. Retome a mesma execução; cobertura global não comprovada.",
        { pauseStage: "page_confirmed_budget", progressMade: true, remainingBeforeListMs }
      )
    }

    const queryTimeoutMs = collectionDiscoveryListTimeoutMs({
      remainingMs: remainingBeforeFetch,
      configuredTimeoutMs,
    })
    if (queryTimeoutMs == null) {
      if (pagesThisBatch === 0 && counters.scannedInvoices === invoicesAtClaim) {
        return pauseNoProgress(
          "pre_list_budget",
          "Lote pausado: orçamento restante insuficiente para consulta com reserva de persistência/release.",
          { remainingBeforeListMs }
        )
      }
      return pause(
        "Lote pausado: orçamento restante insuficiente para consulta com reserva de persistência/release.",
        { pauseStage: "page_confirmed_budget", progressMade: true, remainingBeforeListMs }
      )
    }

    const pageStarted = clock()
    const fetchedOrTimeout = await awaitListPageOrTimeout(
      input.fetchPage({
        referenceDate: run.referenceDate,
        referenceInstant: run.referenceInstant,
        afterInvoicePk: run.cursorLastInvoicePk,
        timeoutMs: queryTimeoutMs,
      }),
      queryTimeoutMs
    )
    const listDurationMs = Math.max(1, clock() - pageStarted)
    lastPageDurationMs = listDurationMs
    const remainingAfterListMs = collectionDiscoveryRemainingBudgetMs({
      startedAtMs,
      nowMs: clock(),
      budgetMs,
    })

    if (fetchedOrTimeout === LIST_WAIT_TIMEOUT) {
      return pauseNoProgress(
        "list_timeout_headers",
        "Timeout aguardando a listagem. Nenhuma resposta HTTP atribuída ao ERP. Sem persistência.",
        { remainingBeforeListMs, remainingAfterListMs, listDurationMs }
      )
    }
    const fetched = fetchedOrTimeout

    if (!fetched.ok) {
      if (fetched.abortClass === "timeout" || fetched.abortClass === "external_abort") {
        const stage: DiscoveryPauseStage = fetched.bodyReadComplete
          ? "list_timeout_body"
          : "list_timeout_headers"
        return pauseNoProgress(
          stage,
          fetched.bodyReadComplete
            ? "Timeout durante o corpo da listagem. Nenhuma persistência."
            : "Timeout aguardando a listagem. Nenhuma resposta HTTP atribuída ao ERP. Sem persistência.",
          { remainingBeforeListMs, remainingAfterListMs, listDurationMs }
        )
      }
      return fail(
        "page_error",
        "Falha na página da descoberta. Cursor não avançou. Sem retry automático.",
        { remainingBeforeListMs, remainingAfterListMs, listDurationMs }
      )
    }

    if (listDurationMs > queryTimeoutMs) {
      return pauseNoProgress(
        "list_timeout_body",
        "Timeout durante o corpo da listagem. Nenhuma persistência.",
        { remainingBeforeListMs, remainingAfterListMs, listDurationMs }
      )
    }

    const progression = validateDiscoveryPageProgression({
      invoicePks: fetched.rows.map((row) => row.invoicePk),
      afterInvoicePk: run.cursorLastInvoicePk,
    })
    if (!progression.ok) {
      return fail(
        progression.code,
        "Página inválida ou sem progressão de invoice_pk. Não marca encerramento da paginação.",
        { remainingBeforeListMs, remainingAfterListMs, listDurationMs }
      )
    }

    if (progression.invoicePks.length === 0) {
      if (input.fetchInvoiceDetail) return runReconciliation()
      return endPaginationWithoutRecon(
        "Paginação da descoberta encerrou neste recorte. Encerramento da paginação não prova cobertura global."
      )
    }

    if (remainingAfterListMs < COLLECTION_DISCOVERY_RELEASE_SLACK_MS) {
      return pauseNoProgress(
        "post_list_no_reserve",
        "Listagem válida sem reserva restante para persistir. Página não gravada; cursor não avançou.",
        { remainingBeforeListMs, remainingAfterListMs, listDurationMs }
      )
    }

    const lease = { runId: run.id, owner, generation }
    let processedAll = true
    // Sprint 3.1E-AR: prefixo contíguo confirmado. Só avança até o último
    // invoice_pk consecutivo cujo efeito (persistência ou skip de negócio)
    // foi confirmado. Nunca pula fatura; erro técnico não vira skip.
    let confirmedPrefixPk: string | null = null
    let confirmedPrefixRows = 0
    let stopReason: "budget" | "capacity_reached" | "persist_error" | null = null
    const persistStarted = clock()
    for (const row of fetched.rows) {
      const remainingForPersist = collectionDiscoveryRemainingBudgetMs({
        startedAtMs,
        nowMs: clock(),
        budgetMs,
      })
      if (remainingForPersist < COLLECTION_DISCOVERY_RELEASE_SLACK_MS) {
        processedAll = false
        stopReason = "budget"
        break
      }
      const invoice = input.toInvoice(row)
      const pk = invoice ? parseOverdueInvoicePk(invoice.invoicePk) : null
      if (!invoice || !pk) {
        incrementDiscoverySkip(skipReasons, classifyUnmappedDiscoveryRow(row))
        counters.skippedCount += 1
        confirmedPrefixPk = row.invoicePk ?? confirmedPrefixPk
        confirmedPrefixRows += 1
        continue
      }
      const existing = await input.repo.findByInvoicePk(pk)
      // Sprint 3.1E-AU: capacidade por contrato distinto. Só contrato novo
      // (sem caso ativo) consome vaga. Sem vaga → para ANTES de persistir;
      // a fatura reaparece na próxima leva (nunca é pulada).
      if (contractSlots != null && !existing) {
        const contractKey = parseProvenPk(invoice.contractPk)
        const wouldCreate =
          decideDiscoveryPersistAction({
            invoice,
            existing: null,
            now: frozenNow,
            minimumDaysOverdue: input.minimumDaysOverdue,
            collectionsEnabled: input.collectionsEnabled,
          }) === "create"
        if (wouldCreate && contractKey && !admittedContracts.has(contractKey)) {
          const active = input.repo.isContractActive
            ? await input.repo.isContractActive(contractKey)
            : false
          if (!active && contractsAdmitted >= contractSlots) {
            processedAll = false
            stopReason = "capacity_reached"
            break
          }
        }
      }
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
            remainingForPersist - COLLECTION_DISCOVERY_RELEASE_SLACK_MS
          ),
        })
        if (persisted.staleLease) {
          return fail("stale_lease", "Lease perdida. Worker antigo não gravou o restante da página.")
        }
        if (persisted.created) counters.createdCount += 1
        if (persisted.updated) counters.updatedCount += 1
        if (persisted.skipped) {
          incrementDiscoverySkip(skipReasons, persisted.skipReason)
          counters.skippedCount += 1
        }
        if (persisted.newlyAssigned) counters.assignedCount += 1
        if (persisted.created && persisted.unassigned) counters.unassignedCount += 1
        if (persisted.created) {
          const contractKey = parseProvenPk(prepared.contractPk)
          if (contractKey && !admittedContracts.has(contractKey)) {
            admittedContracts.add(contractKey)
            contractsAdmitted += 1
          }
        }
        if (persisted.technicalError) {
          // erro técnico não vira skip: interrompe e preserva só o prefixo.
          counters.errorCount += 1
          processedAll = false
          stopReason = "persist_error"
          break
        }
        counters.scannedInvoices += 1
        confirmedPrefixPk = invoice.invoicePk
        confirmedPrefixRows += 1
      } catch {
        counters.errorCount += 1
        processedAll = false
        stopReason = "persist_error"
        break
      }
    }
    const persistenceDurationMs = Math.max(0, clock() - persistStarted)

    if (!processedAll) {
      const prefixAdvance = decideConfirmedPrefixAdvance({
        cursorBefore: run.cursorLastInvoicePk,
        confirmedPrefixPk,
        confirmedPrefixRows,
      })
      if (stopReason === "persist_error") {
        if (prefixAdvance.advance) {
          const advancedBeforeError = await input.store.advance({
            runId: run.id,
            owner,
            generation,
            now: new Date(input.now.getTime() + Math.max(0, clock() - startedAtMs)),
            cursorLastInvoicePk: prefixAdvance.cursor,
            counters,
          })
          if (!advancedBeforeError.ok) {
            return fail("stale_lease", "Lease perdida. Worker antigo não avançou o prefixo confirmado.")
          }
          run = advancedBeforeError.run
          counters = { ...countersFromRun(run), errorCount: counters.errorCount }
        }
        return fail(
          "persist_error",
          "Falha ao persistir fatura. Cursor permanece no último identificador consecutivo confirmado; a fatura com falha reaparece.",
          { pauseStage: "persist_error", contractsAdmitted, capacityReached: false }
        )
      }
      if (stopReason === "capacity_reached") {
        if (prefixAdvance.advance) {
          const advancedCap = await input.store.advance({
            runId: run.id,
            owner,
            generation,
            now: new Date(input.now.getTime() + Math.max(0, clock() - startedAtMs)),
            cursorLastInvoicePk: prefixAdvance.cursor,
            counters,
          })
          if (!advancedCap.ok) {
            return fail("stale_lease", "Lease perdida. Worker antigo não avançou o prefixo confirmado.")
          }
          run = advancedCap.run
          counters = countersFromRun(run)
        }
        return pause(
          "Capacidade de contratos atingida. Cursor avançou só até a última fatura consecutiva confirmada; as demais reaparecem na próxima leva.",
          {
            lastErrorClass: formatDiscoveryPauseClass("capacity_reached", 0),
            pauseStage: "capacity_reached",
            progressMade: prefixAdvance.advance,
            consecutiveNoProgress: prefixAdvance.advance ? 0 : readConsecutiveNoProgress(run),
            remainingBeforeListMs,
            remainingAfterListMs,
            listDurationMs,
            persistenceDurationMs,
            contractsAdmitted,
            capacityReached: true,
          }
        )
      }
      if (prefixAdvance.advance) {
        const advancedPrefix = await input.store.advance({
          runId: run.id,
          owner,
          generation,
          now: new Date(input.now.getTime() + Math.max(0, clock() - startedAtMs)),
          cursorLastInvoicePk: prefixAdvance.cursor,
          counters,
        })
        if (!advancedPrefix.ok) {
          return fail("stale_lease", "Lease perdida. Worker antigo não avançou o prefixo confirmado.")
        }
        run = advancedPrefix.run
        counters = countersFromRun(run)
        return pause(
          "Lote pausado por orçamento após prefixo confirmado. Cursor avançou só até a última fatura consecutiva confirmada; as demais reaparecem na próxima consulta.",
          {
            lastErrorClass: formatDiscoveryPauseClass("confirmed_prefix_budget", 0),
            pauseStage: "confirmed_prefix_budget",
            progressMade: true,
            consecutiveNoProgress: 0,
            remainingBeforeListMs,
            remainingAfterListMs,
            listDurationMs,
            persistenceDurationMs,
          }
        )
      }
      const progressMade = false
      if (!progressMade) {
        return pauseNoProgress(
          "partial_page",
          "Lote pausado no meio da página. Cursor não avançou; reprocessamento da página é idempotente.",
          {
            remainingBeforeListMs,
            remainingAfterListMs,
            listDurationMs,
            persistenceDurationMs,
          }
        )
      }
      return pause(
        "Lote pausado no meio da página. Cursor não avançou; reprocessamento da página é idempotente.",
        {
          lastErrorClass: formatDiscoveryPauseClass("partial_page", 0),
          pauseStage: "partial_page",
          progressMade: true,
          remainingBeforeListMs,
          remainingAfterListMs,
          listDurationMs,
          persistenceDurationMs,
        }
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

    if (contractSlots != null && contractsAdmitted >= contractSlots) {
      return pause(
        "Capacidade de contratos atingida ao fim de página confirmada. Nenhuma nova consulta ao ERP neste lote.",
        {
          lastErrorClass: formatDiscoveryPauseClass("capacity_reached", 0),
          pauseStage: "capacity_reached",
          progressMade: true,
          consecutiveNoProgress: 0,
          capacityReached: true,
        }
      )
    }
  }

  return pause(
    "Lote pausado no limite de páginas. Retome a mesma execução; cobertura global não comprovada.",
    {
      lastErrorClass: formatDiscoveryPauseClass("page_limit", 0),
      pauseStage: "page_limit",
      progressMade:
        run.cursorLastInvoicePk !== cursorAtClaim || counters.scannedPages > pagesAtClaim,
    }
  )
}
