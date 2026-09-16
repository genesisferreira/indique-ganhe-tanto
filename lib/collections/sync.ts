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
import { createOpsDiscoveryCaseRepo } from "@/lib/collections/discovery-persist-ops"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { createOpsDiscoveryStore } from "@/lib/collections/discovery-store-ops"
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

  const login = await brbyteAdminLogin(config)
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
    minimumDaysOverdue: settings.minimumDaysOverdue,
    collectionsEnabled: settings.isEnabled,
    fetchPage: async ({ referenceDate: frozenDate, afterInvoicePk }) => {
      const page = await listOverdueInvoicesPage({
        config,
        cookie: login.cookie,
        referenceDate: frozenDate,
        page: 1,
        afterInvoicePk,
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
    prepareInvoice: async (invoice, existing, frozenNow) =>
      hydrateInvoice({
        invoice,
        existing,
        minimumDaysOverdue: settings.minimumDaysOverdue,
        now: frozenNow,
        config,
        cookie: login.cookie,
      }),
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
