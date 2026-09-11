import "server-only"

import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import { fetchInvoiceInfo } from "@/lib/brbyte/invoice-info"
import { listContractInvoices } from "@/lib/brbyte/invoice-list"
import { isControllrInvoicePaid } from "@/lib/collections/eligibility"
import {
  closeCollectionCasePaid,
  ensureCollectionAssignment,
  insertCollectionCaseEvent,
} from "@/lib/collections/cases.service"
import { asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import {
  buildCollectionCaseWriteModel,
  decideCollectionSyncAction,
  type CollectionSyncInvoice,
  type ExistingCollectionCase,
} from "@/lib/collections/sync-decision"
import { sanitizeCustomerDocument, sanitizeCustomerName } from "@/lib/collections/sanitize"
import type { CollectionCaseStatus } from "@/types/collections"

const LOG_TAG = "[collections:sync]"
const SYSTEM_ACTOR_NOTE = "collections_controllr_sync"

export type CollectionsSyncResult = {
  ok: boolean
  scannedContracts: number
  scannedInvoices: number
  created: number
  updated: number
  closedPaid: number
  skipped: number
  assigned: number
  errors: number
  message?: string
}

type ContractRow = {
  brbyte_contract_pk: string | null
  brbyte_client_pk: string | null
  referred_name: string | null
  referred_document: string | null
}

export async function syncCollectionsFromControllr(input: {
  actorProfileId: string
  now?: Date
}): Promise<CollectionsSyncResult> {
  const result: CollectionsSyncResult = {
    ok: true,
    scannedContracts: 0,
    scannedInvoices: 0,
    created: 0,
    updated: 0,
    closedPaid: 0,
    skipped: 0,
    assigned: 0,
    errors: 0,
  }

  const config = getBrbyteOperationalConfig()
  if (!config) {
    return {
      ...result,
      ok: false,
      message: "Credenciais operacionais do Controllr ausentes.",
    }
  }

  const login = await brbyteAdminLogin(config)
  if ("error" in login) {
    return { ...result, ok: false, message: login.error }
  }

  const db = getOpsDb()
  const contractsRes = await awaitQuery<ContractRow>(
    db
      .from("referrals")
      .select("brbyte_contract_pk, brbyte_client_pk, referred_name, referred_document")
      .not("brbyte_contract_pk", "is", null)
      .limit(200)
  )
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

    for (const invoice of list.rows) {
      const invoicePk = invoice.invoicePk?.trim()
      if (!invoicePk || invoice.invoiceDeleted) {
        result.skipped += 1
        continue
      }
      result.scannedInvoices += 1

      const info = await fetchInvoiceInfo({
        config,
        cookie: login.cookie,
        invoicePk,
      })
      const isPaid = info.ok && info.info
        ? isControllrInvoicePaid(info.info)
        : false

      const syncInvoice: CollectionSyncInvoice = {
        invoicePk,
        contractPk: invoice.contractPk ?? contractPk,
        clientPk: asString(referral.brbyte_client_pk),
        customerName: sanitizeCustomerName(referral.referred_name),
        customerDocument: sanitizeCustomerDocument(referral.referred_document),
        invoiceDueDate: invoice.invoiceDueDate,
        invoiceMsg: info.info?.invoiceMsg ?? null,
        invoiceDateCredit: info.info?.invoiceDateCredit ?? null,
        isPaid,
        invoiceAmountDocument: info.info?.invoiceAmountDocument ?? null,
        invoiceAmountPaid: info.info?.invoiceAmountPaid ?? null,
      }

      const { data: existingRow } = await db
        .from("collection_cases")
        .select("id, status, invoice_pk")
        .eq("invoice_pk", invoicePk)
        .maybeSingle()

      const existing: ExistingCollectionCase | null = existingRow?.id
        ? {
            id: String(existingRow.id),
            status: existingRow.status as CollectionCaseStatus,
            invoicePk: asString(existingRow.invoice_pk),
          }
        : null

      const decision = decideCollectionSyncAction({
        invoice: syncInvoice,
        existing,
        now: input.now,
      })
      const writeModel = buildCollectionCaseWriteModel({
        invoice: syncInvoice,
        now: input.now,
      })

      try {
        if (decision.action === "skip") {
          result.skipped += 1
          continue
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
              .eq("invoice_pk", invoicePk)
              .maybeSingle()
            caseId = again.data?.id ? String(again.data.id) : null
          }
          if (!caseId) {
            result.errors += 1
            continue
          }
          await insertCollectionCaseEvent({
            caseId,
            eventType: "created",
            actorProfileId: input.actorProfileId,
            newValue: { invoice_pk: invoicePk, status: "open" },
            metadata: { source: SYSTEM_ACTOR_NOTE },
          })
          const assigned = await ensureCollectionAssignment({
            caseId,
            actorProfileId: input.actorProfileId,
          })
          if (assigned.assignmentId) result.assigned += 1
          result.created += 1
          continue
        }

        if (decision.action === "update_open" && existing) {
          await db.from("collection_cases").update(writeModel).eq("id", existing.id)
          if (existing.status !== "escalated_retention") {
            const assigned = await ensureCollectionAssignment({
              caseId: existing.id,
              actorProfileId: input.actorProfileId,
            })
            if (assigned.code === "assigned") result.assigned += 1
          }
          result.updated += 1
          continue
        }

        if (decision.action === "reopen" && existing) {
          await db
            .from("collection_cases")
            .update({ ...writeModel, status: "open", closed_at: null })
            .eq("id", existing.id)
          await insertCollectionCaseEvent({
            caseId: existing.id,
            eventType: "status_changed",
            actorProfileId: input.actorProfileId,
            oldValue: { status: existing.status },
            newValue: { status: "open" },
            metadata: { source: SYSTEM_ACTOR_NOTE },
          })
          const assigned = await ensureCollectionAssignment({
            caseId: existing.id,
            actorProfileId: input.actorProfileId,
          })
          if (assigned.assignmentId) result.assigned += 1
          result.updated += 1
          continue
        }

        if (decision.action === "close_paid" && existing) {
          await closeCollectionCasePaid({
            caseId: existing.id,
            actorProfileId: input.actorProfileId,
            snapshot: writeModel.erp_snapshot,
          })
          result.closedPaid += 1
        }
      } catch (error) {
        result.errors += 1
        const message = error instanceof Error ? error.message : String(error)
        console.error(LOG_TAG, { invoicePk, message })
      }
    }
  }

  result.ok = result.errors === 0
  return result
}
