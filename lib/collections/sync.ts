import "server-only"

import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import { fetchInvoiceInfo } from "@/lib/brbyte/invoice-info"
import { listContractInvoices, listOverdueInvoices } from "@/lib/brbyte/invoice-list"
import { freezeInvoiceListReferenceDate } from "@/lib/brbyte/overdue-invoice-list-query"
import {
  computeDaysOverdue,
  isControllrInvoicePaid,
} from "@/lib/collections/eligibility"
import {
  closeCollectionCasePaid,
  ensureCollectionAssignment,
  insertCollectionCaseEvent,
} from "@/lib/collections/cases.service"
import { asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import {
  collectionInvoiceNeedsDetailFetch,
  mergeInvoiceInfoIntoSyncInvoice,
  presentCollectionInvoiceFromListRow,
  shouldInspectCollectionInvoice,
} from "@/lib/collections/invoice-from-controllr"
import {
  buildCollectionCaseWriteModel,
  decideCollectionSyncAction,
  type CollectionSyncInvoice,
  type ExistingCollectionCase,
} from "@/lib/collections/sync-decision"
import { sanitizeCustomerDocument, sanitizeCustomerName } from "@/lib/collections/sanitize"
import {
  collectionsFallbackCoverageMessage,
  resolveCollectionsInvoiceSource,
} from "@/lib/collections/sync-source"
import { loadCollectionOperationalSettings } from "@/lib/operational/settings.service"
import type { CollectionCaseStatus } from "@/types/collections"
import type { BrbyteInvoiceListRow } from "@/types/brbyte"

const LOG_TAG = "[collections:sync]"
const SYSTEM_ACTOR_NOTE = "collections_controllr_sync"
const REFERRAL_FALLBACK_LIMIT = 2000

export type CollectionsSyncResult = {
  ok: boolean
  source: "controllr_invoice_list" | "referrals_fallback"
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
  message?: string
}

type ContractRow = {
  brbyte_contract_pk: string | null
  brbyte_client_pk: string | null
  referred_name: string | null
  referred_document: string | null
}

async function loadExistingCases(): Promise<
  | { ok: true; map: Map<string, ExistingCollectionCase> }
  | { ok: false; message: string }
> {
  const db = getOpsDb()
  const res = await awaitQuery<{
    id: string
    status: string
    invoice_pk: string | null
  }>(
    db
      .from("collection_cases")
      .select("id, status, invoice_pk")
      .limit(20000)
  )
  if (res.error) {
    return {
      ok: false,
      message: "Falha ao ler collection_cases. Sync abortado para não criar duplicatas.",
    }
  }
  const map = new Map<string, ExistingCollectionCase>()
  for (const row of res.data ?? []) {
    const invoicePk = asString(row.invoice_pk)
    if (!invoicePk) continue
    map.set(invoicePk, {
      id: String(row.id),
      status: row.status as CollectionCaseStatus,
      invoicePk,
    })
  }
  return { ok: true, map }
}

async function persistCollectionInvoice(input: {
  invoice: CollectionSyncInvoice
  existing: ExistingCollectionCase | null
  actorProfileId: string
  now?: Date
  minimumDaysOverdue: number
  collectionsEnabled: boolean
  result: CollectionsSyncResult
}): Promise<void> {
  const decision = decideCollectionSyncAction({
    invoice: input.invoice,
    existing: input.existing,
    now: input.now,
    minimumDaysOverdue: input.minimumDaysOverdue,
    collectionsEnabled: input.collectionsEnabled,
  })
  const writeModel = buildCollectionCaseWriteModel({
    invoice: input.invoice,
    now: input.now,
  })
  const db = getOpsDb()

  if (decision.action === "skip") {
    input.result.skipped += 1
    return
  }

  if (decision.action === "create") {
    const inserted = await db
      .from("collection_cases")
      .insert({
        ...writeModel,
        status: "open",
      })
      .select("id")
      .maybeSingle()

    let caseId = inserted.data?.id ? String(inserted.data.id) : null
    if (!caseId) {
      const again = await db
        .from("collection_cases")
        .select("id")
        .eq("invoice_pk", input.invoice.invoicePk)
        .maybeSingle()
      caseId = again.data?.id ? String(again.data.id) : null
    }
    if (!caseId) {
      input.result.errors += 1
      return
    }
    await insertCollectionCaseEvent({
      caseId,
      eventType: "created",
      actorProfileId: input.actorProfileId,
      newValue: { invoice_pk: input.invoice.invoicePk, status: "open" },
      metadata: { source: SYSTEM_ACTOR_NOTE },
    })
    const assigned = await ensureCollectionAssignment({
      caseId,
      actorProfileId: input.actorProfileId,
    })
    if (assigned.assignmentId) input.result.assigned += 1
    else input.result.unassigned += 1
    input.result.created += 1
    return
  }

  if (decision.action === "update_open" && input.existing) {
    await db.from("collection_cases").update(writeModel).eq("id", input.existing.id)
    if (input.existing.status !== "escalated_retention") {
      const assigned = await ensureCollectionAssignment({
        caseId: input.existing.id,
        actorProfileId: input.actorProfileId,
      })
      if (assigned.code === "assigned") input.result.assigned += 1
      if (!assigned.assignmentId) input.result.unassigned += 1
    }
    input.result.updated += 1
    return
  }

  if (decision.action === "reopen" && input.existing) {
    await db
      .from("collection_cases")
      .update({ ...writeModel, status: "open", closed_at: null })
      .eq("id", input.existing.id)
    await insertCollectionCaseEvent({
      caseId: input.existing.id,
      eventType: "status_changed",
      actorProfileId: input.actorProfileId,
      oldValue: { status: input.existing.status },
      newValue: { status: "open" },
      metadata: { source: SYSTEM_ACTOR_NOTE },
    })
    const assigned = await ensureCollectionAssignment({
      caseId: input.existing.id,
      actorProfileId: input.actorProfileId,
    })
    if (assigned.assignmentId) input.result.assigned += 1
    else input.result.unassigned += 1
    input.result.updated += 1
    return
  }

  if (decision.action === "close_paid" && input.existing) {
    await closeCollectionCasePaid({
      caseId: input.existing.id,
      actorProfileId: input.actorProfileId,
      snapshot: writeModel.erp_snapshot,
    })
    input.result.closedPaid += 1
  }
}

async function hydrateInvoice(input: {
  invoice: CollectionSyncInvoice
  existing: ExistingCollectionCase | null
  minimumDaysOverdue: number
  now?: Date
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

async function processInvoiceRow(input: {
  row: BrbyteInvoiceListRow
  overlay?: Partial<CollectionSyncInvoice>
  existingByInvoice: Map<string, ExistingCollectionCase>
  actorProfileId: string
  now?: Date
  minimumDaysOverdue: number
  collectionsEnabled: boolean
  config: NonNullable<ReturnType<typeof getBrbyteOperationalConfig>>
  cookie: string
  result: CollectionsSyncResult
}): Promise<void> {
  const presented = presentCollectionInvoiceFromListRow(input.row)
  if (!presented) {
    input.result.skipped += 1
    return
  }
  const invoice: CollectionSyncInvoice = {
    ...presented,
    ...input.overlay,
    invoicePk: presented.invoicePk,
    clientPk: input.overlay?.clientPk ?? presented.clientPk,
    customerName: input.overlay?.customerName ?? presented.customerName,
    customerDocument: input.overlay?.customerDocument ?? presented.customerDocument,
  }
  input.result.scannedInvoices += 1
  const existing = input.existingByInvoice.get(invoice.invoicePk) ?? null
  if (
    !shouldInspectCollectionInvoice({
      invoice,
      now: input.now,
      minimumDaysOverdue: input.minimumDaysOverdue,
      hasExistingCase: Boolean(existing),
    })
  ) {
    input.result.skipped += 1
    return
  }

  try {
    const hydrated = await hydrateInvoice({
      invoice,
      existing,
      minimumDaysOverdue: input.minimumDaysOverdue,
      now: input.now,
      config: input.config,
      cookie: input.cookie,
    })
    await persistCollectionInvoice({
      invoice: hydrated,
      existing,
      actorProfileId: input.actorProfileId,
      now: input.now,
      minimumDaysOverdue: input.minimumDaysOverdue,
      collectionsEnabled: input.collectionsEnabled,
      result: input.result,
    })
  } catch (error) {
    input.result.errors += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(LOG_TAG, { invoicePk: invoice.invoicePk, message })
  }
}

export async function syncCollectionsFromControllr(input: {
  actorProfileId: string
  now?: Date
}): Promise<CollectionsSyncResult> {
  const result: CollectionsSyncResult = {
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
  }

  const config = getBrbyteOperationalConfig()
  if (!config) {
    return {
      ...result,
      ok: false,
      degraded: true,
      message: "Credenciais operacionais do Controllr ausentes.",
    }
  }

  const login = await brbyteAdminLogin(config)
  if ("error" in login) {
    return { ...result, ok: false, degraded: true, message: login.error }
  }

  const settings = await loadCollectionOperationalSettings()
  const existing = await loadExistingCases()
  if (!existing.ok) {
    return { ...result, ok: false, degraded: true, message: existing.message }
  }
  const existingByInvoice = existing.map

  const now = input.now ?? new Date()
  const referenceDate = freezeInvoiceListReferenceDate(now)
  const globalList = await listOverdueInvoices({
    config,
    cookie: login.cookie,
    referenceDate,
  })
  const source = resolveCollectionsInvoiceSource({
    globalOk: globalList.ok,
    globalRowCount: globalList.rows.length,
    globalIncomplete: globalList.incomplete === true || globalList.truncated === true,
    coverageProven: false,
  })

  result.scannedPages = globalList.scannedPages

  if (source.use === "empty") {
    result.fullBaseCoverage = false
    result.degraded = false
    result.ok = true
    result.message = "Consulta de atrasados válida e vazia. Nenhum candidato neste recorte."
    return result
  }

  if (source.use === "global") {
    result.fullBaseCoverage = source.fullBaseCoverage
    result.degraded = source.degraded
    result.truncated = globalList.truncated
    for (const row of globalList.rows) {
      await processInvoiceRow({
        row,
        existingByInvoice,
        actorProfileId: input.actorProfileId,
        now,
        minimumDaysOverdue: settings.minimumDaysOverdue,
        collectionsEnabled: settings.isEnabled,
        config,
        cookie: login.cookie,
        result,
      })
    }
    result.ok = result.errors === 0 && !result.degraded
    if (!source.fullBaseCoverage && !source.degraded) {
      result.message = [
        result.message,
        "Ordenação por invoice_pk ASC não prova cobertura única do recorte nem ausência de deriva entre páginas. Processamento retomável continua necessário.",
      ]
        .filter(Boolean)
        .join(" ")
    }
    if (source.degraded) {
      result.message = [
        globalList.message,
        `Itens processados nesta varredura: ${result.scannedInvoices}. Páginas lidas: ${globalList.scannedPages}. Cobertura total da base: não.`,
      ]
        .filter(Boolean)
        .join(" ")
    }
    if (result.unassigned > 0) {
      result.message = [
        result.message,
        `${result.unassigned} caso(s) sem dono: fila 2.2 sem funcionário elegível de Cobrança.`,
      ]
        .filter(Boolean)
        .join(" ")
    }
    return result
  }

  result.source = "referrals_fallback"
  result.fullBaseCoverage = false
  result.degraded = true
  console.error(LOG_TAG, {
    step: "invoice_list_global",
    message: globalList.message,
  })

  const db = getOpsDb()
  const contractsRes = await awaitQuery<ContractRow>(
    db
      .from("referrals")
      .select("brbyte_contract_pk, brbyte_client_pk, referred_name, referred_document")
      .not("brbyte_contract_pk", "is", null)
      .limit(REFERRAL_FALLBACK_LIMIT)
  )
  if (contractsRes.error) {
    return {
      ...result,
      ok: false,
      message: collectionsFallbackCoverageMessage({
        fallbackContractsScanned: 0,
        fallbackLimit: REFERRAL_FALLBACK_LIMIT,
        globalError: globalList.message,
      }) + " Falha ao ler contratos de indicação.",
    }
  }
  const contracts = (contractsRes.data ?? []).filter((row) =>
    Boolean(row.brbyte_contract_pk?.trim())
  )
  const uniqueContracts = new Map<string, ContractRow>()
  for (const row of contracts) {
    const pk = row.brbyte_contract_pk!.trim()
    if (!uniqueContracts.has(pk)) uniqueContracts.set(pk, row)
  }

  for (const [contractPk, referral] of uniqueContracts) {
    result.scannedContracts += 1
    const list = await listContractInvoices({
      config,
      cookie: login.cookie,
      contractPk,
    })
    if (!list.ok) {
      result.errors += 1
      continue
    }
    for (const row of list.rows) {
      await processInvoiceRow({
        row,
        overlay: {
          contractPk,
          clientPk: asString(referral.brbyte_client_pk),
          customerName: sanitizeCustomerName(referral.referred_name),
          customerDocument: sanitizeCustomerDocument(referral.referred_document),
        },
        existingByInvoice,
        actorProfileId: input.actorProfileId,
        now,
        minimumDaysOverdue: settings.minimumDaysOverdue,
        collectionsEnabled: settings.isEnabled,
        config,
        cookie: login.cookie,
        result,
      })
    }
  }

  result.ok = false
  result.message = collectionsFallbackCoverageMessage({
    fallbackContractsScanned: result.scannedContracts,
    fallbackLimit: REFERRAL_FALLBACK_LIMIT,
    globalError: globalList.message,
  })
  if (result.unassigned > 0) {
    result.message += ` ${result.unassigned} caso(s) sem dono: fila 2.2 sem funcionário elegível de Cobrança.`
  }
  return result
}
