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
  COLLECTION_DISCOVERY_TIME_BUDGET_MS,
  collectionDiscoveryCappedTimeoutMs,
  collectionDiscoveryRemainingBudgetMs,
} from "@/lib/collections/discovery-contract"
import { createOpsDiscoveryCaseRepo } from "@/lib/collections/discovery-persist-ops"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { createOpsDiscoveryStore } from "@/lib/collections/discovery-store-ops"
import { classifyInvoiceDetailForReconciliation } from "@/lib/collections/reconciliation"
import {
  collectionInvoiceNeedsDetailFetch,
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
}

async function hydrateInvoice(input: {
  invoice: CollectionSyncInvoice
  existing: ExistingCollectionCase | null
  minimumDaysOverdue: number
  now: Date
  config: NonNullable<ReturnType<typeof getBrbyteOperationalConfig>>
  cookie: string
}): Promise<CollectionSyncInvoice> {
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
    return input.invoice
  }

  const info = await fetchInvoiceInfo({
    config: input.config,
    cookie: input.cookie,
    invoicePk: input.invoice.invoicePk,
  })
  if (!info.ok || !info.info) return input.invoice
  return mergeInvoiceInfoIntoSyncInvoice({
    invoice: input.invoice,
    info: {
      invoiceMsg: info.info.invoiceMsg,
      invoiceDateCredit: info.info.invoiceDateCredit,
      invoiceAmountDocument: info.info.invoiceAmountDocument,
      invoiceAmountPaid: info.info.invoiceAmountPaid,
      isPaid: isControllrInvoicePaid(info.info),
    },
  })
}

export async function syncCollectionsFromControllr(input: {
  actorProfileId: string
  now?: Date
  runId?: string | null
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
    configuredTimeoutMs: config.timeoutMs,
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

  const login = await brbyteAdminLogin({ ...config, timeoutMs: loginTimeout })
  if ("error" in login) {
    return { ...empty, ok: false, degraded: true, message: login.error }
  }

  const settings = await loadCollectionOperationalSettings()
  const now = input.now ?? new Date()
  const referenceDate = freezeInvoiceListReferenceDate(now)
  const batch = await runOverdueDiscoveryBatch({
    store: createOpsDiscoveryStore(),
    repo: createOpsDiscoveryCaseRepo(),
    owner: `discovery:${randomUUID()}`,
    actorProfileId: input.actorProfileId,
    now,
    referenceInstant: now,
    referenceDate,
    runId: input.runId,
    clock,
    startedAtMs,
    budgetMs,
    configuredTimeoutMs: config.timeoutMs,
    minimumDaysOverdue: settings.minimumDaysOverdue,
    collectionsEnabled: settings.isEnabled,
    fetchPage: async ({ referenceDate: frozenDate, afterInvoicePk, timeoutMs }) => {
      const page = await listOverdueInvoicesPage({
        config,
        cookie: login.cookie,
        referenceDate: frozenDate,
        page: 1,
        afterInvoicePk,
        timeoutMs,
      })
      console.log(LOG_TAG, {
        scope: "discovery-page",
        httpStatus: page.httpStatus,
        count: page.rows.length,
        total: page.total,
      })
      return {
        ok: page.ok,
        rows: page.rows,
        total: page.total,
        httpStatus: page.httpStatus,
        message: page.message,
      }
    },
    toInvoice: (row) => presentCollectionInvoiceFromListRow(row),
    prepareInvoice: async (invoice, existing, frozenNow) => {
      const remaining = collectionDiscoveryRemainingBudgetMs({
        startedAtMs,
        nowMs: clock(),
        budgetMs,
      })
      const hydrateTimeout = collectionDiscoveryCappedTimeoutMs({
        remainingMs: remaining,
        configuredTimeoutMs: config.timeoutMs,
      })
      if (hydrateTimeout == null) return invoice
      return hydrateInvoice({
        invoice,
        existing,
        minimumDaysOverdue: settings.minimumDaysOverdue,
        now: frozenNow,
        config: { ...config, timeoutMs: hydrateTimeout },
        cookie: login.cookie,
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

  return {
    ...empty,
    ok: batch.ok,
    degraded: batch.status === "failed",
    scannedPages: batch.scannedPages,
    scannedInvoices: batch.scannedInvoices,
    created: batch.created,
    updated: batch.updated,
    skipped: batch.skipped,
    assigned: batch.assigned,
    unassigned: batch.unassigned,
    closedPaid: batch.closedPaid,
    truncated: batch.truncated,
    errors: batch.errors,
    resumable: batch.resumable,
    runId: batch.runId,
    discoveryStatus: batch.status,
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
