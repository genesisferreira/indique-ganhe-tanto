import "server-only"

import { randomUUID } from "node:crypto"
import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import { fetchInvoiceInfo } from "@/lib/brbyte/invoice-info"
import { listOverdueInvoicesPage } from "@/lib/brbyte/invoice-list"
import { freezeInvoiceListReferenceDate } from "@/lib/brbyte/overdue-invoice-list-query"
import {
  computeDaysOverdue,
  isControllrInvoicePaid,
} from "@/lib/collections/eligibility"
import {
  COLLECTION_DETAIL_CONCURRENCY_DEFAULT,
  COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS,
  COLLECTION_DISCOVERY_LIST_TIMEOUT_MS,
  COLLECTION_DISCOVERY_LOGIN_TIMEOUT_MS,
  COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS,
  COLLECTION_DISCOVERY_TIME_BUDGET_MS,
  collectionDiscoveryCappedTimeoutMs,
  collectionDiscoveryRemainingBudgetMs,
} from "@/lib/collections/discovery-contract"
import { createOpsDiscoveryCaseRepo } from "@/lib/collections/discovery-persist-ops"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { createOpsDiscoveryStore } from "@/lib/collections/discovery-store-ops"
import type { DiscoveryStore } from "@/lib/collections/discovery-store"
import { classifyInvoiceDetailForReconciliation } from "@/lib/collections/reconciliation"
import {
  emptyDiscoverySkipHistogram,
  sanitizeDiscoverySkipHistogram,
  type DiscoverySkipHistogram,
} from "@/lib/collections/skip-reason"
import {
  collectionInvoiceNeedsDetailFetch,
  collectionListRowFinancialProof,
  decideInvoiceDetailLookup,
  incrementFinancialProofReason,
  sumFinancialProofHistogram,
  type FinancialProofReasonHistogram,
  mergeInvoiceInfoIntoSyncInvoice,
  presentCollectionInvoiceFromListRow,
} from "@/lib/collections/invoice-from-controllr"
import type { CollectionSyncInvoice, ExistingCollectionCase } from "@/lib/collections/sync-decision"
import { loadCollectionOperationalSettings } from "@/lib/operational/settings.service"

const LOG_TAG = "[collections:sync]"

export type CollectionsSyncResult = {
  ok: boolean
  source: "controllr_invoice_list"
  fullBaseCoverage: boolean
  degraded: boolean
  scannedContracts: number
  scannedPages: number
  scannedInvoices: number
  created: number
  updated: number
  closedPaid: number
  skipped: number
  skippedThisBatch: number
  skipReasons: DiscoverySkipHistogram
  assigned: number
  unassigned: number
  truncated: boolean
  errors: number
  resumable: boolean
  runId: string | null
  discoveryStatus: string | null
  coverageProven: false
  uniqueOrderProven: false
  message?: string
  pauseStage?: string | null
  contractsAdmitted?: number
  capacityReached?: boolean
  /** Sprint 3.1E-BA: progresso e métricas sanitizadas do segmento (sem IDs/PII). */
  progressMade?: boolean
  segmentScannedInvoices?: number
  segmentCreated?: number
  segmentUpdated?: number
  stageTimings?: DiscoveryStageTimings
  /** 3.1E-BG: histograma agregado (allowlist) das razões de prova da listagem. */
  financialProofReasons?: FinancialProofReasonHistogram
}

/**
 * 3.1E-BG: métricas NÃO sobrepostas por caminho de código:
 * loginMs, listMs, classificationMs, detailWallMs (laço bloqueado aguardando
 * invoice_info), persistExclusiveMs (somente leituras/escritas de
 * persistência), checkpointMs, releaseMs ⊂ totalMs.
 * detailRequestSumMs = soma das durações individuais de invoice_info (pode
 * exceder detailWallMs com paralelismo 2; não entra na partição).
 * detailMs (BD) mantém a semântica de soma. persistMs (BD) fica null daqui em
 * diante: o histórico incluía preparação/detalhe e não é reescrito.
 */
export type DiscoveryStageTimings = {
  loginMs: number
  listMs: number
  listRequests: number
  classificationMs: number
  detailLookups: number
  detailSkippedByList: number
  detailMs: number | null
  persistMs: number | null
  detailWallMs: number
  detailRequestSumMs: number
  detailMaxConcurrency: number
  persistExclusiveMs: number
  checkpointMs: number
  checkpoints: number
  releaseMs: number
  totalMs: number
}

type DetailStats = { lookups: number; skippedByList: number; durationMs: number }

type HydrateOutcome =
  | { ok: true; invoice: CollectionSyncInvoice }
  | { ok: false; failure: "timeout" | "error" }

async function hydrateInvoice(input: {
  invoice: CollectionSyncInvoice
  existing: ExistingCollectionCase | null
  minimumDaysOverdue: number
  now: Date
  config: NonNullable<ReturnType<typeof getBrbyteOperationalConfig>>
  cookie: string
  listFinancialProven?: boolean
  stats?: DetailStats
  signal?: AbortSignal
}): Promise<HydrateOutcome> {
  const daysOverdue = computeDaysOverdue({
    invoiceDueDate: input.invoice.invoiceDueDate,
    now: input.now,
  })
  if (
    !collectionInvoiceNeedsDetailFetch({
      invoice: input.invoice,
      daysOverdue,
      minimumDaysOverdue: input.minimumDaysOverdue,
      hasExistingCase: Boolean(input.existing),
    })
  ) {
    return { ok: true, invoice: input.invoice }
  }

  // Sprint 3.1E-BA: listagem já comprova os campos => sem invoice_info.
  if (
    decideInvoiceDetailLookup({
      needsDetailByRule: true,
      listFinancialProven: input.listFinancialProven === true,
    }) === "skip_list_sufficient"
  ) {
    if (input.stats) input.stats.skippedByList += 1
    return { ok: true, invoice: input.invoice }
  }
  const detailStarted = Date.now()
  if (input.stats) input.stats.lookups += 1
  const info = await fetchInvoiceInfo({
    config: input.config,
    cookie: input.cookie,
    invoicePk: input.invoice.invoicePk,
    signal: input.signal,
  })
  if (input.stats) input.stats.durationMs += Math.max(0, Date.now() - detailStarted)
  // 3.1E-BG: detalhe necessário e indisponível => fail-closed. Sem retry; a
  // fatura não é persistida e a posição seguinte não passa à frente.
  if (!info.ok || !info.info) {
    return {
      ok: false,
      failure: info.abortClass === "timeout" || info.abortClass === "external_abort" ? "timeout" : "error",
    }
  }
  const merged = mergeInvoiceInfoIntoSyncInvoice({
    invoice: input.invoice,
    info: {
      invoiceMsg: info.info.invoiceMsg,
      invoiceDateCredit: info.info.invoiceDateCredit,
      invoiceAmountDocument: info.info.invoiceAmountDocument,
      invoiceAmountPaid: info.info.invoiceAmountPaid,
      isPaid: isControllrInvoicePaid(info.info),
    },
  })
  return { ok: true, invoice: merged }
}

export async function syncCollectionsFromControllr(input: {
  actorProfileId: string
  now?: Date
  runId?: string | null
  /** Sprint 3.1E-AU: vagas de contratos novos ("Carregar próxima leva"). */
  contractSlots?: number | null
}): Promise<CollectionsSyncResult> {
  const empty: CollectionsSyncResult = {
    ok: true,
    source: "controllr_invoice_list",
    fullBaseCoverage: false,
    degraded: false,
    scannedContracts: 0,
    scannedPages: 0,
    scannedInvoices: 0,
    created: 0,
    updated: 0,
    closedPaid: 0,
    skipped: 0,
    skippedThisBatch: 0,
    skipReasons: emptyDiscoverySkipHistogram(),
    assigned: 0,
    unassigned: 0,
    truncated: false,
    errors: 0,
    resumable: false,
    runId: null,
    discoveryStatus: null,
    coverageProven: false,
    uniqueOrderProven: false,
  }

  const settings = await loadCollectionOperationalSettings()
  if (settings.isEnabled === false) {
    return {
      ...empty,
      ok: false,
      degraded: true,
      discoveryStatus: "disabled",
      message:
        "Fila de Cobrança desligada nas configurações. Nenhuma descoberta, reconciliação ou escrita foi executada.",
    }
  }

  const config = getBrbyteOperationalConfig()
  if (!config) {
    return {
      ...empty,
      ok: false,
      degraded: true,
      message: "Credenciais operacionais do Controllr ausentes.",
    }
  }

  const clock = Date.now
  const startedAtMs = clock()
  const budgetMs = COLLECTION_DISCOVERY_TIME_BUDGET_MS
  const loginTimeout = collectionDiscoveryCappedTimeoutMs({
    remainingMs: collectionDiscoveryRemainingBudgetMs({
      startedAtMs,
      nowMs: clock(),
      budgetMs,
    }),
    configuredTimeoutMs: Math.min(config.timeoutMs, COLLECTION_DISCOVERY_LOGIN_TIMEOUT_MS),
    persistReleaseMarginMs:
      COLLECTION_DISCOVERY_LIST_TIMEOUT_MS + COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS,
  })
  if (loginTimeout == null) {
    return {
      ...empty,
      ok: true,
      resumable: true,
      discoveryStatus: "paused",
      truncated: true,
      message:
        "Orçamento insuficiente para login operacional com margem de persistência. Sem claim.",
    }
  }

  const loginStarted = clock()
  const login = await brbyteAdminLogin({ ...config, timeoutMs: loginTimeout })
  const loginDurationMs = Math.max(0, clock() - loginStarted)
  if ("error" in login) {
    console.log(LOG_TAG, {
      scope: "discovery-login",
      loginDurationMs,
      remainingAfterLoginMs: collectionDiscoveryRemainingBudgetMs({
        startedAtMs,
        nowMs: clock(),
        budgetMs,
      }),
    })
    return { ...empty, ok: false, degraded: true, message: login.error }
  }
  console.log(LOG_TAG, {
    scope: "discovery-login",
    loginDurationMs,
    remainingAfterLoginMs: collectionDiscoveryRemainingBudgetMs({
      startedAtMs,
      nowMs: clock(),
      budgetMs,
    }),
  })

  const now = input.now ?? new Date()
  const referenceDate = freezeInvoiceListReferenceDate(now)
  const detailStats: DetailStats = { lookups: 0, skippedByList: 0, durationMs: 0 }
  const stage = { listMs: 0, listRequests: 0, classificationMs: 0, checkpointMs: 0, checkpoints: 0, releaseMs: 0 }
  const provenInvoicePks = new Set<string>()
  const financialProofReasons: FinancialProofReasonHistogram = {}
  let countersAtClaim: { scannedInvoices: number; createdCount: number; updatedCount: number } | null = null
  const baseStore = createOpsDiscoveryStore()
  const timedStore: DiscoveryStore = Object.assign(Object.create(baseStore) as DiscoveryStore, {
    advance: async (args: Parameters<DiscoveryStore["advance"]>[0]) => {
      const t = clock()
      try {
        return await baseStore.advance(args)
      } finally {
        stage.checkpointMs += Math.max(0, clock() - t)
        stage.checkpoints += 1
      }
    },
    release: async (args: Parameters<DiscoveryStore["release"]>[0]) => {
      const t = clock()
      try {
        return await baseStore.release(args)
      } finally {
        stage.releaseMs += Math.max(0, clock() - t)
      }
    },
  })
  const batch = await runOverdueDiscoveryBatch({
    store: timedStore,
    onClaim: (c) => {
      countersAtClaim = { scannedInvoices: c.scannedInvoices, createdCount: c.createdCount, updatedCount: c.updatedCount }
    },
    repo: createOpsDiscoveryCaseRepo(),
    owner: `discovery:${randomUUID()}`,
    actorProfileId: input.actorProfileId,
    now,
    referenceInstant: now,
    referenceDate,
    runId: input.runId,
    contractSlots: input.contractSlots ?? null,
    clock,
    startedAtMs,
    budgetMs,
    configuredTimeoutMs: COLLECTION_DISCOVERY_LIST_TIMEOUT_MS,
    minimumDaysOverdue: settings.minimumDaysOverdue,
    collectionsEnabled: settings.isEnabled,
    fetchPage: async ({ referenceDate: frozenDate, referenceInstant, afterInvoicePk, timeoutMs }) => {
      const listStarted = clock()
      const page = await listOverdueInvoicesPage({
        config,
        cookie: login.cookie,
        referenceDate: frozenDate,
        referenceInstant,
        page: 1,
        afterInvoicePk,
        timeoutMs,
        minimumDaysOverdue: settings.minimumDaysOverdue,
      })
      stage.listMs += Math.max(0, clock() - listStarted)
      stage.listRequests += 1
      console.log(LOG_TAG, {
        scope: "discovery-page",
        httpStatus: page.httpStatus,
        count: page.rows.length,
        total: page.total,
        abortClass: page.abortClass ?? null,
        bodyReadComplete: page.bodyReadComplete ?? null,
      })
      return {
        ok: page.ok,
        rows: page.rows,
        total: page.total,
        httpStatus: page.httpStatus,
        message: page.message,
        abortClass: page.abortClass,
        bodyReadComplete: page.bodyReadComplete,
      }
    },
    toInvoice: (row) => {
      const t = clock()
      const presented = presentCollectionInvoiceFromListRow(row)
      if (presented) {
        const proof = collectionListRowFinancialProof(row)
        incrementFinancialProofReason(financialProofReasons, proof.reason)
        if (proof.proven) provenInvoicePks.add(presented.invoicePk)
      }
      stage.classificationMs += Math.max(0, clock() - t)
      return presented
    },
    // 3.1E-BG: concorrência fixa no servidor (teto absoluto 2); nunca do body.
    detailConcurrency: COLLECTION_DETAIL_CONCURRENCY_DEFAULT,
    detailTimeoutMs: COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS,
    prepareInvoice: async (invoice, existing, frozenNow, ctx) => {
      const remaining = collectionDiscoveryRemainingBudgetMs({
        startedAtMs,
        nowMs: clock(),
        budgetMs,
      })
      // 3.1E-BJ: invoice_info com timeout proprio de 60s (antes config.timeoutMs ~30s).
      const capped = collectionDiscoveryCappedTimeoutMs({
        remainingMs: remaining,
        configuredTimeoutMs: COLLECTION_DISCOVERY_DETAIL_TIMEOUT_MS,
        persistReleaseMarginMs: COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS,
      })
      if (capped == null) return { ok: false as const, failure: "timeout" as const }
      const hydrateTimeout = ctx ? Math.min(capped, ctx.timeoutMs) : capped
      return hydrateInvoice({
        signal: ctx?.signal,
        invoice,
        existing,
        minimumDaysOverdue: settings.minimumDaysOverdue,
        now: frozenNow,
        config: { ...config, timeoutMs: hydrateTimeout },
        cookie: login.cookie,
        listFinancialProven: provenInvoicePks.has(invoice.invoicePk),
        stats: detailStats,
      })
    },
    fetchInvoiceDetail: async ({ invoicePk, timeoutMs }) => {
      const remaining = collectionDiscoveryRemainingBudgetMs({
        startedAtMs,
        nowMs: clock(),
        budgetMs,
      })
      const detailTimeout = collectionDiscoveryCappedTimeoutMs({
        remainingMs: remaining,
        configuredTimeoutMs: config.timeoutMs,
      })
      const usedTimeout = detailTimeout == null ? timeoutMs : Math.min(timeoutMs, detailTimeout)
      const info = await fetchInvoiceInfo({
        config: { ...config, timeoutMs: usedTimeout },
        cookie: login.cookie,
        invoicePk,
      })
      return classifyInvoiceDetailForReconciliation({
        requestedInvoicePk: invoicePk,
        ok: info.ok,
        httpStatus: info.httpStatus,
        message: info.message,
        abortClass: info.abortClass,
        info: info.info,
        payload: info.payload,
      })
    },
  })

  const skipReasons = sanitizeDiscoverySkipHistogram(batch.skipReasons)
  const claimBase = countersAtClaim as { scannedInvoices: number; createdCount: number; updatedCount: number } | null
  const segmentScannedInvoices = claimBase ? Math.max(0, batch.scannedInvoices - claimBase.scannedInvoices) : 0
  const segmentCreated = claimBase ? Math.max(0, batch.created - claimBase.createdCount) : 0
  const segmentUpdated = claimBase ? Math.max(0, batch.updated - claimBase.updatedCount) : 0
  const stageTimings: DiscoveryStageTimings = {
    loginMs: loginDurationMs,
    listMs: stage.listMs,
    listRequests: stage.listRequests,
    classificationMs: stage.classificationMs,
    detailLookups: detailStats.lookups,
    detailSkippedByList: detailStats.skippedByList,
    // BD: detailMs sempre foi soma de durações; mantém a mesma semântica.
    detailMs: detailStats.durationMs,
    persistMs: null,
    detailWallMs: batch.pipelineMetrics?.detailWaitMs ?? 0,
    detailRequestSumMs: detailStats.durationMs,
    detailMaxConcurrency: batch.pipelineMetrics?.detailMaxConcurrency ?? 0,
    persistExclusiveMs: batch.pipelineMetrics?.persistExclusiveMs ?? 0,
    checkpointMs: stage.checkpointMs,
    checkpoints: stage.checkpoints,
    releaseMs: stage.releaseMs,
    totalMs: Math.max(0, clock() - startedAtMs),
  }
  console.log(LOG_TAG, {
    scope: "discovery-stage-timings",
    ...stageTimings,
    segmentScannedInvoices,
    segmentCreated,
    segmentUpdated,
    financialProofReasons,
    financialProofClassified: sumFinancialProofHistogram(financialProofReasons),
  })
  console.log(LOG_TAG, {
    scope: "discovery-batch",
    pauseStage: batch.pauseStage,
    progressMade: batch.progressMade,
    consecutiveNoProgress: batch.consecutiveNoProgress,
    loginDurationMs,
    listDurationMs: batch.listDurationMs,
    persistenceDurationMs: batch.persistenceDurationMs,
    remainingBeforeListMs: batch.remainingBeforeListMs,
    remainingAfterListMs: batch.remainingAfterListMs,
    errorClass: batch.status === "failed" ? "failed" : batch.pauseStage,
    discoveryStatus: batch.status,
    skippedThisBatch: batch.skippedThisBatch,
    skipReasons,
    contractsAdmitted: batch.contractsAdmitted ?? 0,
    capacityReached: batch.capacityReached === true,
  })

  return {
    ...empty,
    ok: batch.ok,
    degraded: batch.status === "failed",
    scannedPages: batch.scannedPages,
    scannedInvoices: batch.scannedInvoices,
    created: batch.created,
    updated: batch.updated,
    skipped: batch.skipped,
    skippedThisBatch: batch.skippedThisBatch,
    skipReasons,
    assigned: batch.assigned,
    unassigned: batch.unassigned,
    closedPaid: batch.closedPaid,
    truncated: batch.truncated,
    errors: batch.errors,
    resumable: batch.resumable,
    runId: batch.runId,
    discoveryStatus: batch.status,
    pauseStage: batch.pauseStage,
    contractsAdmitted: batch.contractsAdmitted ?? 0,
    capacityReached: batch.capacityReached === true,
    progressMade: batch.progressMade || segmentScannedInvoices > 0,
    segmentScannedInvoices,
    segmentCreated,
    segmentUpdated,
    stageTimings,
    financialProofReasons,
    message: [
      batch.message,
      batch.unassigned > 0
        ? `${batch.unassigned} caso(s) sem dono: fila 2.2 sem funcionário elegível de Cobrança.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
  }
}
